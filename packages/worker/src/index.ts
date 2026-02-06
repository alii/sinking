import { openDB, request, transaction } from './idb.ts';
import { broadcast, broadcastBatch, reply, replyError } from './messages.ts';
import { applySchema } from './schema.ts';
import type { BatchOperation, ClientMessage, DatabaseSchema, OperationMessage, WorkerMessage } from './types.ts';

declare const self: SharedWorkerGlobalScope;

const ports = new Set<MessagePort>();
let db: IDBDatabase | null = null;

async function init(schema: DatabaseSchema): Promise<void> {
	db = await openDB(schema.name, schema.version, (database, tx) => {
		applySchema(database, tx, schema);
	});
}

async function get(db: IDBDatabase, store: string, key: IDBValidKey) {
	const tx = db.transaction(store, 'readonly');
	return request(tx.objectStore(store).get(key));
}

async function put(db: IDBDatabase, store: string, key: IDBValidKey, value: unknown) {
	const tx = db.transaction(store, 'readwrite');
	await request(tx.objectStore(store).put(value, key));
	broadcast(ports, store, key, value);
}

async function del(db: IDBDatabase, store: string, key: IDBValidKey) {
	const tx = db.transaction(store, 'readwrite');
	await request(tx.objectStore(store).delete(key));
	broadcast(ports, store, key, undefined);
}

async function getAll(db: IDBDatabase, store: string) {
	const tx = db.transaction(store, 'readonly');
	return request(tx.objectStore(store).getAll());
}

async function getByIndex(db: IDBDatabase, store: string, indexName: string, key: IDBValidKey) {
	const tx = db.transaction(store, 'readonly');
	return request(tx.objectStore(store).index(indexName).get(key));
}

async function getAllByIndex(db: IDBDatabase, store: string, indexName: string, key: IDBValidKey) {
	const tx = db.transaction(store, 'readonly');
	return request(tx.objectStore(store).index(indexName).getAll(key));
}

async function bulkPut(db: IDBDatabase, store: string, items: { key: IDBValidKey; value: unknown }[]) {
	const tx = db.transaction(store, 'readwrite');
	const objectStore = tx.objectStore(store);
	for (const item of items) {
		objectStore.put(item.value, item.key);
	}
	await transaction(tx);
	broadcastBatch(
		ports,
		items.map(item => ({ store, key: item.key, value: item.value })),
	);
}

async function bulkDelete(db: IDBDatabase, store: string, keys: IDBValidKey[]) {
	const tx = db.transaction(store, 'readwrite');
	const objectStore = tx.objectStore(store);
	for (const key of keys) {
		objectStore.delete(key);
	}
	await transaction(tx);
	broadcastBatch(
		ports,
		keys.map(key => ({ store, key, value: undefined })),
	);
}

async function batch(db: IDBDatabase, operations: BatchOperation[]) {
	const stores = [...new Set(operations.map(op => op.store))];
	const tx = db.transaction(stores, 'readwrite');
	for (const op of operations) {
		const objectStore = tx.objectStore(op.store);
		if (op.type === 'put') {
			objectStore.put(op.value, op.key);
		} else {
			objectStore.delete(op.key);
		}
	}
	await transaction(tx);
	broadcastBatch(
		ports,
		operations.map(op => ({
			store: op.store,
			key: op.key,
			value: op.type === 'put' ? op.value : undefined,
		})),
	);
}

async function handleOperation(db: IDBDatabase, message: OperationMessage, port: MessagePort) {
	switch (message.type) {
		case 'get':
			return reply(port, message.id, await get(db, message.store, message.key));
		case 'put':
			await put(db, message.store, message.key, message.value);
			return reply(port, message.id, undefined);
		case 'delete':
			await del(db, message.store, message.key);
			return reply(port, message.id, undefined);
		case 'getAll':
			return reply(port, message.id, await getAll(db, message.store));
		case 'getByIndex':
			return reply(port, message.id, await getByIndex(db, message.store, message.indexName, message.key));
		case 'getAllByIndex':
			return reply(port, message.id, await getAllByIndex(db, message.store, message.indexName, message.key));
		case 'bulkPut':
			await bulkPut(db, message.store, message.items);
			return reply(port, message.id, undefined);
		case 'bulkDelete':
			await bulkDelete(db, message.store, message.keys);
			return reply(port, message.id, undefined);
		case 'batch':
			await batch(db, message.operations);
			return reply(port, message.id, undefined);
	}
}

async function handleMessage(message: ClientMessage, port: MessagePort) {
	if (message.type === 'init') {
		await init(message.schema);
		port.postMessage({ type: 'ready' } satisfies WorkerMessage);
		return;
	}

	if (!db) {
		return replyError(port, message.id, new Error('Worker not initialized'));
	}

	try {
		await handleOperation(db, message, port);
	} catch (err) {
		replyError(port, message.id, err);
	}
}

self.onconnect = (event: MessageEvent) => {
	const port = event.ports[0];
	if (!port) return;

	ports.add(port);

	port.onmessage = (e: MessageEvent<ClientMessage>) => {
		handleMessage(e.data, port);
	};

	port.onmessageerror = () => {
		ports.delete(port);
	};

	port.start();
};
