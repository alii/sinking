import { openDB, request } from './idb.ts';
import { broadcast, reply, replyError } from './messages.ts';
import type { ClientMessage } from './types.ts';

declare const self: SharedWorkerGlobalScope;

const DB_NAME = 'sww';
const DB_VERSION = 1;

const ports = new Set<MessagePort>();
let db: IDBDatabase | null = null;

async function getDB(): Promise<IDBDatabase> {
	if (db) return db;
	db = await openDB(DB_NAME, DB_VERSION, database => {
		if (!database.objectStoreNames.contains('data')) {
			database.createObjectStore('data');
		}
	});
	return db;
}

async function handleMessage(message: ClientMessage, port: MessagePort): Promise<void> {
	try {
		const database = await getDB();
		const readonly =
			message.type === 'get' || message.type === 'getAll' || message.type === 'subscribe';
		const tx = database.transaction(message.store, readonly ? 'readonly' : 'readwrite');
		const store = tx.objectStore(message.store);

		switch (message.type) {
			case 'get': {
				reply(port, message.id, await request(store.get(message.key)));
				break;
			}

			case 'put': {
				await request(store.put(message.value, message.key));
				reply(port, message.id, undefined);
				broadcast(ports, message.store, message.key, message.value, port);
				break;
			}

			case 'delete': {
				await request(store.delete(message.key));
				reply(port, message.id, undefined);
				broadcast(ports, message.store, message.key, undefined, port);
				break;
			}

			case 'getAll': {
				reply(port, message.id, await request(store.getAll()));
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
