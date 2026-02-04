# sinking

Cross-tab IndexedDB sync via SharedWorker.

> **Note:** This library is experimental. The API may change.

## Install

```bash
bun add sinking
```

## Setup

### 1. Create your worker file

```ts
// worker.ts
import 'sinking/worker';
```

### 2. Create your client

```ts
import { SWWClient, type DatabaseSchema } from 'sinking/core';

const schema: DatabaseSchema = {
	name: 'myapp',
	version: 1,
	stores: {
		todos: { keyPath: 'id' },
		settings: {},
	},
};

const client = new SWWClient({
	workerUrl: new URL('./worker.ts', import.meta.url),
	schema,
});
```

## API

### Core

```ts
import { SWWClient, type DatabaseSchema } from 'sinking/core';

// Read (returns lazy thenable)
const todo = await client.get<Todo>('todos', id);
const todos = await client.getAll<Todo>('todos');

// Write
await client.put('todos', id, { id, text: 'Hello' });
await client.delete('todos', id);

// Bulk operations
await client.bulkPut('todos', [
  { key: 'id1', value: todo1 },
  { key: 'id2', value: todo2 },
]);
await client.bulkDelete('todos', ['id1', 'id2']);

// Atomic transactions across stores
await client.batch([
  { type: 'put', store: 'todos', key: id, value: todo },
  { type: 'put', store: 'queue', key: queueId, value: queueItem },
]);

// Subscribe to a specific query
const query = client.getAll<Todo>('todos');
const unsubscribe = client.subscribe(query.description, () => {
	const todos = client.getCached<Todo[]>(query.description);
	console.log('Todos updated:', todos);
});
```

### React

```ts
import { useLiveQuery } from 'sinking/react';

function Todos() {
  const todos = useLiveQuery(client, () => client.getAll<Todo>('todos'), []);

  return <ul>{todos?.map(t => <li key={t.id}>{t.text}</li>)}</ul>;
}

function Todo({ id }: { id: string }) {
  const todo = useLiveQuery(client, () => client.get<Todo>('todos', id));

  return <div>{todo?.text}</div>;
}
```

### Schema

```ts
const schema: DatabaseSchema = {
	name: 'myapp',
	version: 1, // bump to trigger migration
	stores: {
		todos: {
			keyPath: 'id', // optional: auto-extract key from value
			autoIncrement: true, // optional: auto-generate keys
			indexes: {
				// optional
				byDate: { keyPath: 'createdAt' },
				byUser: { keyPath: 'userId', unique: false },
			},
		},
	},
};
```

## How it works

1. `sinking/worker` starts a SharedWorker that manages IndexedDB
2. All tabs connect to the same worker instance
3. When one tab writes, the worker broadcasts to all other tabs
4. Client caches query results and invalidates on changes
5. `useLiveQuery` uses `useSyncExternalStore` for efficient React integration

## License

Apache-2.0
