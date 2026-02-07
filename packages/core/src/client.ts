import type {
	BatchOperation,
	BulkItem,
	ClientMessage,
	DatabaseSchema,
	KeyRange,
	OperationMessage,
	WorkerMessage,
} from '@sinking/worker/types';
import type { DistributedOmit } from './types.ts';

export type { KeyRange } from '@sinking/worker/types';

export type QueryDescription =
	| { type: 'get'; store: string; key: IDBValidKey }
	| { type: 'getAll'; store: string }
	| { type: 'getByIndex'; store: string; indexName: string; key: IDBValidKey | KeyRange }
	| { type: 'getAllByIndex'; store: string; indexName: string; key: IDBValidKey | KeyRange }
	| { type: 'count'; store: string }
	| { type: 'countByIndex'; store: string; indexName: string; key: IDBValidKey | KeyRange };

export interface LazyQuery<T> {
	description: QueryDescription;
	then<TResult1 = T, TResult2 = never>(
		onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null,
		onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
	): Promise<TResult1 | TResult2>;
	catch<TResult = never>(
		onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
	): Promise<T | TResult>;
}

interface CacheEntry<T = unknown> {
	value: T;
	description: QueryDescription;
}

export type SubscriptionListener = () => void;

export interface SinkingOptions {
	workerUrl: string | URL;
	schema: DatabaseSchema;
}

export function hashKey(key: IDBValidKey | KeyRange): string {
	if (typeof key === 'string') return `s:${key}`;
	if (typeof key === 'number') return `n:${key}`;
	if (key instanceof Date) return `d:${key.getTime()}`;
	if (Array.isArray(key)) return `a:[${key.map(k => hashKey(k as IDBValidKey)).join(',')}]`;
	if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) {
		const buffer = key instanceof ArrayBuffer ? key : key.buffer;
		const bytes = new Uint8Array(buffer);
		let hash = 'b:';
		for (const byte of bytes) hash += byte.toString(16).padStart(2, '0');
		return hash;
	}
	let h = 'kr:';
	if (key.lower !== undefined) h += hashKey(key.lower);
	h += ':';
	if (key.upper !== undefined) h += hashKey(key.upper);
	return h + `:${key.lowerOpen ?? false}:${key.upperOpen ?? false}`;
}

export function descriptionKey(desc: QueryDescription): string {
	switch (desc.type) {
		case 'get':
			return `get:${desc.store}:${hashKey(desc.key)}`;
		case 'getAll':
			return `getAll:${desc.store}`;
		case 'getByIndex':
			return `getByIndex:${desc.store}:${desc.indexName}:${hashKey(desc.key)}`;
		case 'getAllByIndex':
			return `getAllByIndex:${desc.store}:${desc.indexName}:${hashKey(desc.key)}`;
		case 'count':
			return `count:${desc.store}`;
		case 'countByIndex':
			return `countByIndex:${desc.store}:${desc.indexName}:${hashKey(desc.key)}`;
	}
}

export function keysEqual(a: IDBValidKey, b: IDBValidKey): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++) {
			if (!keysEqual(a[i] as IDBValidKey, b[i] as IDBValidKey)) return false;
		}
		return true;
	}
	if (a instanceof ArrayBuffer || ArrayBuffer.isView(a)) {
		if (!(b instanceof ArrayBuffer || ArrayBuffer.isView(b))) return false;
		const bufA = a instanceof ArrayBuffer ? a : a.buffer;
		const bufB = b instanceof ArrayBuffer ? b : b.buffer;
		if (bufA.byteLength !== bufB.byteLength) return false;
		const viewA = new Uint8Array(bufA);
		const viewB = new Uint8Array(bufB);
		for (let i = 0; i < viewA.length; i++) {
			if (viewA[i] !== viewB[i]) return false;
		}
		return true;
	}
	return false;
}

function isAffected(desc: QueryDescription, store: string, key: IDBValidKey): boolean {
	return desc.store === store && (desc.type !== 'get' || keysEqual(desc.key, key));
}

export class Sinking {
	private worker: SharedWorker;
	private port: MessagePort;
	private idCounter = 0;
	private pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	private ready: Promise<void>;
	private closed = false;

	private cache = new Map<string, CacheEntry>();
	private inFlight = new Map<string, Promise<unknown>>();
	private subscribers = new Map<string, Set<SubscriptionListener>>();

	public constructor(options: SinkingOptions) {
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
				this.invalidate(d => isAffected(d, message.store, message.key));
				return;
			}

			if (message.type === 'batch-change') {
				this.invalidate(d => message.changes.some(c => isAffected(d, c.store, c.key)));
				return;
			}

			if (message.type === 'store-change') {
				this.invalidate(d => d.store === message.store);
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

		this.worker.onerror = (event: ErrorEvent) => {
			const error =
				event.error instanceof Error
					? event.error
					: new Error(`Worker error: ${event.message}`, {
							cause: event.error,
						});

			for (const [id, pending] of this.pending) {
				pending.reject(error);
				this.pending.delete(id);
			}
		};

		this.port.start();
		this.port.postMessage({ type: 'init', schema: options.schema } satisfies ClientMessage);
	}

	private async invalidate(predicate: (desc: QueryDescription) => boolean): Promise<void> {
		const affected: QueryDescription[] = [];
		for (const entry of this.cache.values()) {
			if (predicate(entry.description)) affected.push(entry.description);
		}
		await Promise.allSettled(affected.map(desc => this.refetch(desc)));
		for (const desc of affected) this.notify(descriptionKey(desc));
	}

	private async refetch(description: QueryDescription): Promise<void> {
		const key = descriptionKey(description);
		this.cache.delete(key);
		this.inFlight.delete(key);

		const value = await this.send(description);
		this.cache.set(key, { value, description });
	}

	private nextId(): string {
		return String(++this.idCounter);
	}

	private async send<T>(message: DistributedOmit<OperationMessage, 'id'>): Promise<T> {
		if (this.closed) {
			return Promise.reject(new Error('Client is closed'));
		}

		await this.ready;
		const id = this.nextId();

		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.port.postMessage({ ...message, id });
		});
	}

	private notify(cacheKey: string): void {
		const listeners = this.subscribers.get(cacheKey);
		if (listeners) {
			for (const listener of listeners) {
				listener();
			}
		}
	}

	private query<T>(description: QueryDescription): LazyQuery<T> {
		const key = descriptionKey(description);

		const execute = (): Promise<T> => {
			const cached = this.cache.get(key);
			if (cached) return Promise.resolve(cached.value as T);

			const existing = this.inFlight.get(key);
			if (existing) return existing as Promise<T>;

			const promise = this.send<T>(description)
				.then(value => {
					this.cache.set(key, { value, description });
					this.notify(key);
					return value;
				})
				.finally(() => {
					this.inFlight.delete(key);
				});

			this.inFlight.set(key, promise);
			return promise;
		};

		execute();

		return {
			description,
			then: (onfulfilled, onrejected) => execute().then(onfulfilled, onrejected),
			catch: onrejected => execute().catch(onrejected),
		};
	}

	get<T>(store: string, key: IDBValidKey): LazyQuery<T | undefined> {
		return this.query({ type: 'get', store, key });
	}

	getAll<T>(store: string): LazyQuery<T[]> {
		return this.query({ type: 'getAll', store });
	}

	getByIndex<T>(
		store: string,
		indexName: string,
		key: IDBValidKey | KeyRange,
	): LazyQuery<T | undefined> {
		return this.query({ type: 'getByIndex', store, indexName, key });
	}

	getAllByIndex<T>(store: string, indexName: string, key: IDBValidKey | KeyRange): LazyQuery<T[]> {
		return this.query({ type: 'getAllByIndex', store, indexName, key });
	}

	count(store: string): LazyQuery<number>;
	count(store: string, indexName: string, key: IDBValidKey | KeyRange): LazyQuery<number>;
	count(store: string, indexName?: string, key?: IDBValidKey | KeyRange): LazyQuery<number> {
		if (indexName !== undefined && key !== undefined) {
			return this.query({ type: 'countByIndex', store, indexName, key });
		}
		return this.query({ type: 'count', store });
	}

	getCached<T>(description: QueryDescription): T | undefined {
		const key = descriptionKey(description);
		return this.cache.get(key)?.value as T | undefined;
	}

	async put(store: string, key: IDBValidKey, value: unknown): Promise<void> {
		await this.send({ type: 'put', store, key, value });
	}

	async delete(store: string, key: IDBValidKey): Promise<void> {
		await this.send({ type: 'delete', store, key });
	}

	async bulkPut(store: string, items: BulkItem[]): Promise<void> {
		await this.send({ type: 'bulkPut', store, items });
	}

	async bulkDelete(store: string, keys: IDBValidKey[]): Promise<void> {
		await this.send({ type: 'bulkDelete', store, keys });
	}

	async batch(operations: BatchOperation[]): Promise<void> {
		await this.send({ type: 'batch', operations });
	}

	async clear(store: string): Promise<void> {
		await this.send({ type: 'clear', store });
	}

	subscribe(description: QueryDescription, listener: SubscriptionListener): () => void {
		const cacheKey = descriptionKey(description);

		let listeners = this.subscribers.get(cacheKey);
		if (!listeners) {
			listeners = new Set();
			this.subscribers.set(cacheKey, listeners);
		}
		listeners.add(listener);

		return () => {
			listeners!.delete(listener);
			if (listeners!.size === 0) {
				this.subscribers.delete(cacheKey);
			}
		};
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;

		const error = new Error('Client is closed');
		for (const [id, pending] of this.pending) {
			pending.reject(error);
			this.pending.delete(id);
		}

		this.port.close();
	}
}
