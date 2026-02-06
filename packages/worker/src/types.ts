export interface IndexSchema {
	keyPath: string | string[];
	unique?: boolean;
	multiEntry?: boolean;
}

export interface StoreSchema {
	keyPath?: string | string[];
	autoIncrement?: boolean;
	indexes?: Record<string, IndexSchema>;
}

export interface DatabaseSchema {
	name: string;
	version: number;
	stores: Record<string, StoreSchema>;
}

export type InitMessage = { type: 'init'; schema: DatabaseSchema };

export interface BulkItem {
	key: IDBValidKey;
	value: unknown;
}

export type BatchOperation =
	| { type: 'put'; store: string; key: IDBValidKey; value: unknown }
	| { type: 'delete'; store: string; key: IDBValidKey };

export type OperationMessage =
	| { type: 'get'; id: string; store: string; key: IDBValidKey }
	| { type: 'put'; id: string; store: string; key: IDBValidKey; value: unknown }
	| { type: 'delete'; id: string; store: string; key: IDBValidKey }
	| { type: 'getAll'; id: string; store: string }
	| { type: 'getByIndex'; id: string; store: string; indexName: string; key: IDBValidKey }
	| { type: 'getAllByIndex'; id: string; store: string; indexName: string; key: IDBValidKey }
	| { type: 'bulkPut'; id: string; store: string; items: BulkItem[] }
	| { type: 'bulkDelete'; id: string; store: string; keys: IDBValidKey[] }
	| { type: 'batch'; id: string; operations: BatchOperation[] };

export type ClientMessage = InitMessage | OperationMessage;

export interface BatchChangeItem {
	store: string;
	key: IDBValidKey;
	value: unknown | undefined;
}

export type WorkerMessage =
	| { type: 'ready' }
	| { type: 'result'; id: string; value: unknown }
	| { type: 'error'; id: string; error: string }
	| { type: 'change'; store: string; key: IDBValidKey; value: unknown | undefined }
	| { type: 'batch-change'; changes: BatchChangeItem[] };
