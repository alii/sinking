# sinking

Cross-tab IndexedDB sync via SharedWorker.

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

// CRUD operations
await client.get<Todo>('todos', id);
await client.getAll<Todo>('todos');
await client.put('todos', id, { id, text: 'Hello' });
await client.delete('todos', id);

// Subscribe to changes (cross-tab)
const unsubscribe = client.onChange((store, key, value) => {
	console.log('Changed:', store, key, value);
});
```

### React

```ts
import { useLiveQuery } from 'sinking/react';

function Todos() {
  const todos = useLiveQuery(
    client,
    () => client.getAll<Todo>('todos'),
    []
  );

  const todo = useLiveQuery(
    client,
    () => client.get<Todo>('todos', id),
    [id]  // re-fetches when id changes
  );

  return <ul>{todos?.map(t => <li key={t.id}>{t.text}</li>)}</ul>;
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
4. `useLiveQuery` re-runs queries on any change

## License

MIT
