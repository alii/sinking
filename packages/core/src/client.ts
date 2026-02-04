import type { ClientMessage, WorkerMessage } from '@sww/worker';
import type { DistributedOmit } from './types';

export type ChangeListener = (store: string, key: IDBValidKey, value: unknown) => void;

export class SWWClient {
	private worker: SharedWorker;
	private port: MessagePort;
	private pending = new Map<
		string,
		{ resolve: (value: any) => void; reject: (error: Error) => void }
	>();
	private listeners = new Set<ChangeListener>();
	private idCounter = 0;

	constructor(workerUrl: string | URL) {
		this.worker = new SharedWorker(workerUrl, { type: 'module' });
		this.port = this.worker.port;

		this.port.onmessage = (e: MessageEvent<WorkerMessage>) => {
			const message = e.data;

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
	}

	private nextId(): string {
		return String(++this.idCounter);
	}

	private send<T>(message: DistributedOmit<ClientMessage, 'id'>): Promise<T> {
		const id = this.nextId();

		return new Promise((resolve, reject) => {
			this.pending.set(id, {
				resolve,
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

	onChange(listener: ChangeListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	close(): void {
		this.port.close();
	}
}
