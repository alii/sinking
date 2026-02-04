import { openDB, request, transaction } from './idb.ts';
import { broadcast, reply, replyError } from './messages.ts';
import { applySchema } from './schema.ts';
import type { ClientMessage, DatabaseSchema, WorkerMessage } from './types.ts';

declare const self: SharedWorkerGlobalScope;

const ports = new Set<MessagePort>();
let db: IDBDatabase | null = null;
let schema: DatabaseSchema | null = null;

async function init(s: DatabaseSchema): Promise<void> {
	schema = s;
	db = await openDB(schema.name, schema.version, (database, tx) => {
		applySchema(database, tx, schema!);
	});
}

async function handleMessage(message: ClientMessage, port: MessagePort): Promise<void> {
	if (message.type === 'init') {
		await init(message.schema);
		port.postMessage({ type: 'ready' } satisfies WorkerMessage);
		return;
	}

	if (!db) {
		replyError(port, message.id, new Error('Worker not initialized'));
		return;
	}

	try {
		const readonly =
			message.type === 'get' || message.type === 'getAll' || message.type === 'subscribe';
		const tx = db.transaction(message.store, readonly ? 'readonly' : 'readwrite');
		const objectStore = tx.objectStore(message.store);

		switch (message.type) {
			case 'get': {
				reply(port, message.id, await request(objectStore.get(message.key)));
				break;
			}

			case 'put': {
				await request(objectStore.put(message.value, message.key));
				reply(port, message.id, undefined);
				broadcast(ports, message.store, message.key, message.value, port);
				break;
			}

			case 'delete': {
				await request(objectStore.delete(message.key));
				reply(port, message.id, undefined);
				broadcast(ports, message.store, message.key, undefined, port);
				break;
			}

			case 'getAll': {
				reply(port, message.id, await request(objectStore.getAll()));
				break;
			}

			case 'bulkPut': {
				for (const item of message.items) {
					objectStore.put(item.value, item.key);
				}
				await transaction(tx);
				reply(port, message.id, undefined);
				for (const item of message.items) {
					broadcast(ports, message.store, item.key, item.value, port);
				}
				break;
			}

			case 'bulkDelete': {
				for (const key of message.keys) {
					objectStore.delete(key);
				}
				await transaction(tx);
				reply(port, message.id, undefined);
				for (const key of message.keys) {
					broadcast(ports, message.store, key, undefined, port);
				}
				break;
			}

			case 'subscribe': {
				reply(port, message.id, undefined);
				break;
			}
		}
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
