import type { DatabaseSchema } from './schema.ts';

export type InitMessage = { type: 'init'; schema: DatabaseSchema };

export type OperationMessage =
	| { type: 'get'; id: string; store: string; key: IDBValidKey }
	| { type: 'put'; id: string; store: string; key: IDBValidKey; value: unknown }
	| { type: 'delete'; id: string; store: string; key: IDBValidKey }
	| { type: 'getAll'; id: string; store: string }
	| { type: 'subscribe'; id: string; store: string };

export type ClientMessage = InitMessage | OperationMessage;

export type WorkerMessage =
	| { type: 'ready' }
	| { type: 'result'; id: string; value: unknown }
	| { type: 'error'; id: string; error: string }
	| { type: 'change'; store: string; key: IDBValidKey; value: unknown | undefined };
