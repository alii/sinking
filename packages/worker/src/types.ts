// Message types from client -> worker
export type ClientMessage =
	| { type: 'get'; id: string; store: string; key: IDBValidKey }
	| { type: 'put'; id: string; store: string; key: IDBValidKey; value: unknown }
	| { type: 'delete'; id: string; store: string; key: IDBValidKey }
	| { type: 'getAll'; id: string; store: string }
	| { type: 'subscribe'; id: string; store: string };

// Message types from worker -> client
export type WorkerMessage =
	| { type: 'result'; id: string; value: unknown }
	| { type: 'error'; id: string; error: string }
	| { type: 'change'; store: string; key: IDBValidKey; value: unknown | undefined };
