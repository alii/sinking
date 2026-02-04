import type { BulkItem, ClientMessage, DatabaseSchema, OperationMessage, WorkerMessage } from '@sinking/worker/types';
import type { DistributedOmit } from './types.ts';

export type ChangeListener = (store: string, key: IDBValidKey, value: unknown) => void;

export interface SWWClientOptions {
	workerUrl: string | URL;
	schema: DatabaseSchema;
}

export class SWWClient {
	private worker: SharedWorker;
	private port: MessagePort;
	private listeners = new Set<ChangeListener>();
	private idCounter = 0;
	private pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	private ready: Promise<void>;

	constructor(options: SWWClientOptions) {
		this.worker = new SharedWorker(options.workerUrl, { type: 'module' });
		this.port = this.worker.port;

		this.ready = new Promise<void>(resolve => {
			const onReady = (e: MessageEvent<WorkerMessage>) => {
				if (e.data.type === 'ready') {
					this.port.removeEventListener('message', onReady);
					resolve();
				}
			};
			this.port.addEventListener('message', onReady);
		});

		this.port.onmessage = (e: MessageEvent<WorkerMessage>) => {
			const message = e.data;

			if (message.type === 'ready') return;

			if (message.type === 'change') {
				for (const listener of this.listeners) {
					listener(message.store, message.key, message.value);
				}
				return;
			}

			const pending = this.pending.get(message.id);
			if (!pending) return;

			this.pending.delete(message.id);

			if (message.type === 'error') {
				pending.reject(new Error(message.error));
			} else {
				pending.resolve(message.value);
			}
		};

		this.port.start();
		this.port.postMessage({ type: 'init', schema: options.schema } satisfies ClientMessage);
	}

	private nextId(): string {
		return String(++this.idCounter);
	}

	private async send<T>(message: DistributedOmit<OperationMessage, 'id'>): Promise<T> {
		await this.ready;
		const id = this.nextId();

		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve: resolve as (value: unknown) => void,
				reject,
			});
			this.port.postMessage({ ...message, id });
		});
	}

	async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
		return this.send<T | undefined>({ type: 'get', store, key });
	}

	async put(store: string, key: IDBValidKey, value: unknown): Promise<void> {
		await this.send({ type: 'put', store, key, value });
	}

	async delete(store: string, key: IDBValidKey): Promise<void> {
		await this.send({ type: 'delete', store, key });
	}

	async getAll<T>(store: string): Promise<T[]> {
		return this.send<T[]>({ type: 'getAll', store });
	}

	async bulkPut(store: string, items: BulkItem[]): Promise<void> {
		await this.send({ type: 'bulkPut', store, items });
	}

	async bulkDelete(store: string, keys: IDBValidKey[]): Promise<void> {
		await this.send({ type: 'bulkDelete', store, keys });
	}

	onChange(listener: ChangeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	close(): void {
		this.port.close();
	}
}
