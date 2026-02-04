import type { BatchOperation, BulkItem, ClientMessage, DatabaseSchema, OperationMessage, WorkerMessage } from '@sinking/worker/types';
import type { DistributedOmit } from './types.ts';

export type QueryDescription =
	| { type: 'get'; store: string; key: IDBValidKey }
	| { type: 'getAll'; store: string };

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

export interface SWWClientOptions {
	workerUrl: string | URL;
	schema: DatabaseSchema;
}

export function hashKey(key: IDBValidKey): string {
	if (typeof key === 'string') return `s:${key}`;
	if (typeof key === 'number') return `n:${key}`;
	if (key instanceof Date) return `d:${key.getTime()}`;
	if (Array.isArray(key)) return `a:[${key.map(k => hashKey(k as IDBValidKey)).join(',')}]`;
	const buffer = key instanceof ArrayBuffer ? key : key.buffer;
	const bytes = new Uint8Array(buffer);
	let hash = 'b:';
	for (const byte of bytes) {
		hash += byte.toString(16).padStart(2, '0');
	}
	return hash;
}

export function descriptionKey(desc: QueryDescription): string {
	if (desc.type === 'get') {
		return `get:${desc.store}:${hashKey(desc.key)}`;
	}
	return `getAll:${desc.store}`;
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
	if (desc.store !== store) return false;
	if (desc.type === 'getAll') return true;
	return keysEqual(desc.key, key);
}

export class SWWClient {
	private worker: SharedWorker;
	private port: MessagePort;
	private idCounter = 0;
	private pending = new Map<
		string,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void }
	>();
	private ready: Promise<void>;

	private cache = new Map<string, CacheEntry>();
	private inFlight = new Map<string, Promise<unknown>>();
	private subscribers = new Map<string, Set<SubscriptionListener>>();

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
				this.invalidate(message.store, message.key);
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

	private async invalidate(store: string, key: IDBValidKey): Promise<void> {
		const affected: QueryDescription[] = [];
		for (const [, entry] of this.cache) {
			if (isAffected(entry.description, store, key)) {
				affected.push(entry.description);
			}
		}

		await Promise.all(affected.map(desc => this.refetch(desc)));

		for (const desc of affected) {
			this.notify(descriptionKey(desc));
		}
	}

	private async refetch(description: QueryDescription): Promise<void> {
		const key = descriptionKey(description);
		this.cache.delete(key);
		this.inFlight.delete(key);

		const value =
			description.type === 'get'
				? await this.send({ type: 'get', store: description.store, key: description.key })
				: await this.send({ type: 'getAll', store: description.store });

		this.cache.set(key, { value, description });
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

	private notify(cacheKey: string): void {
		const listeners = this.subscribers.get(cacheKey);
		if (listeners) {
			for (const listener of listeners) {
				listener();
			}
		}
	}

	private executeQuery<T>(description: QueryDescription): Promise<T> {
		const key = descriptionKey(description);

		const cached = this.cache.get(key);
		if (cached) return Promise.resolve(cached.value as T);

		const existing = this.inFlight.get(key);
		if (existing) return existing as Promise<T>;

		const promise = (
			description.type === 'get'
				? this.send<T>({ type: 'get', store: description.store, key: description.key })
				: this.send<T>({ type: 'getAll', store: description.store })
		).then(value => {
			this.inFlight.delete(key);
			this.cache.set(key, { value, description });
			this.notify(key);
			return value;
		});

		this.inFlight.set(key, promise);
		return promise;
	}

	get<T>(store: string, key: IDBValidKey): LazyQuery<T | undefined> {
		const description: QueryDescription = { type: 'get', store, key };
		this.executeQuery<T | undefined>(description);
		return {
			description,
			then: (onfulfilled, onrejected) =>
				this.executeQuery<T | undefined>(description).then(onfulfilled, onrejected),
			catch: onrejected =>
				this.executeQuery<T | undefined>(description).catch(onrejected),
		};
	}

	getAll<T>(store: string): LazyQuery<T[]> {
		const description: QueryDescription = { type: 'getAll', store };
		this.executeQuery<T[]>(description);
		return {
			description,
			then: (onfulfilled, onrejected) =>
				this.executeQuery<T[]>(description).then(onfulfilled, onrejected),
			catch: onrejected =>
				this.executeQuery<T[]>(description).catch(onrejected),
		};
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
		this.port.close();
	}
}
