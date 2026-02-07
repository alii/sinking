import { openDB, request, transaction } from './idb.ts';
import { emit, reply, replyError } from './messages.ts';
import { applySchema } from './schema.ts';
import type { BatchOperation, ClientMessage, KeyRange, OperationMessage, WorkerMessage } from './types.ts';

declare const self: SharedWorkerGlobalScope;

const ports = new Set<MessagePort>();
let db: IDBDatabase | null = null;

function read<T>(db: IDBDatabase, store: string, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	return request(fn(db.transaction(store, 'readonly').objectStore(store)));
}

async function write(db: IDBDatabase, store: string, fn: (s: IDBObjectStore) => IDBRequest): Promise<void> {
	const tx = db.transaction(store, 'readwrite');
	await request(fn(tx.objectStore(store)));
}

function toIDBKeyRange(key: IDBValidKey | KeyRange): IDBValidKey | IDBKeyRange {
	if (
		typeof key === 'object' &&
		key !== null &&
		!Array.isArray(key) &&
		!(key instanceof Date) &&
		!(key instanceof ArrayBuffer) &&
		!ArrayBuffer.isView(key) &&
		('lower' in key || 'upper' in key)
	) {
		if (key.lower !== undefined && key.upper !== undefined)
			return IDBKeyRange.bound(key.lower, key.upper, key.lowerOpen, key.upperOpen);
		if (key.lower !== undefined) return IDBKeyRange.lowerBound(key.lower, key.lowerOpen);
		return IDBKeyRange.upperBound(key.upper!, key.upperOpen);
	}
	return key as IDBValidKey;
}

async function executeBatch(db: IDBDatabase, operations: BatchOperation[]) {
	const stores = [...new Set(operations.map(op => op.store))];
	const tx = db.transaction(stores, 'readwrite');
	const clearedStores = new Set<string>();
	for (const op of operations) {
		const s = tx.objectStore(op.store);
		switch (op.type) {
			case 'put':
				s.put(op.value, op.key);
				break;
			case 'delete':
				s.delete(op.key);
				break;
			case 'clear':
				s.clear();
				clearedStores.add(op.store);
				break;
		}
	}
	await transaction(tx);
	for (const store of clearedStores) {
		emit(ports, { type: 'store-change', store });
	}
	const changes = [];
	for (const op of operations) {
		if (op.type === 'clear' || clearedStores.has(op.store)) continue;
		changes.push({ store: op.store, key: op.key, value: op.type === 'put' ? op.value : undefined });
	}
	if (changes.length > 0) emit(ports, { type: 'batch-change', changes });
}

async function handleOperation(db: IDBDatabase, msg: OperationMessage): Promise<unknown> {
	switch (msg.type) {
		case 'get':
			return read(db, msg.store, s => s.get(msg.key));
		case 'getAll':
			return read(db, msg.store, s => s.getAll());
		case 'getByIndex':
			return read(db, msg.store, s => s.index(msg.indexName).get(toIDBKeyRange(msg.key)));
		case 'getAllByIndex':
			return read(db, msg.store, s => s.index(msg.indexName).getAll(toIDBKeyRange(msg.key)));
		case 'count':
			return read(db, msg.store, s => s.count());
		case 'countByIndex':
			return read(db, msg.store, s => s.index(msg.indexName).count(toIDBKeyRange(msg.key)));
		case 'put':
			await write(db, msg.store, s => s.put(msg.value, msg.key));
			emit(ports, { type: 'change', store: msg.store, key: msg.key, value: msg.value });
			return;
		case 'delete':
			await write(db, msg.store, s => s.delete(msg.key));
			emit(ports, { type: 'change', store: msg.store, key: msg.key, value: undefined });
			return;
		case 'clear':
			await write(db, msg.store, s => s.clear());
			emit(ports, { type: 'store-change', store: msg.store });
			return;
		case 'bulkPut':
			return executeBatch(
				db,
				msg.items.map(i => ({ type: 'put' as const, store: msg.store, key: i.key, value: i.value })),
			);
		case 'bulkDelete':
			return executeBatch(
				db,
				msg.keys.map(k => ({ type: 'delete' as const, store: msg.store, key: k })),
			);
		case 'batch':
			return executeBatch(db, msg.operations);
	}
}

async function handleMessage(message: ClientMessage, port: MessagePort) {
	if (message.type === 'init') {
		db = await openDB(message.schema.name, message.schema.version, (database, tx) => {
			applySchema(database, tx, message.schema);
		});
		port.postMessage({ type: 'ready' } satisfies WorkerMessage);
		return;
	}
	if (!db) return replyError(port, message.id, new Error('Worker not initialized'));
	try {
		reply(port, message.id, await handleOperation(db, message));
	} catch (err) {
		replyError(port, message.id, err);
	}
}

self.onconnect = (event: MessageEvent) => {
	const port = event.ports[0];
	if (!port) return;
	ports.add(port);
	port.onmessage = (e: MessageEvent<ClientMessage>) => handleMessage(e.data, port);
	port.onmessageerror = () => ports.delete(port);
	port.start();
};
