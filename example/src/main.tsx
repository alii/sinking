import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Sinking, type DatabaseSchema } from 'sinking/core';
import { useLiveQuery } from 'sinking/react';

interface Todo {
	id: string;
	text: string;
}

const schema: DatabaseSchema = {
	name: 'example',
	version: 1,
	stores: {
		todos: {},
	},
};

const client = new Sinking({
	workerUrl: '/worker.js',
	schema,
});

function TodoList() {
	const todos = useLiveQuery(client, () => client.getAll<Todo>('todos'), []);

	async function deleteTodo(id: string) {
		await client.delete('todos', id);
	}

	return (
		<ul>
			{todos.map(todo => (
				<li key={todo.id}>
					<span>{todo.text}</span>
					<span className="delete" onClick={() => deleteTodo(todo.id)}>
						&times;
					</span>
				</li>
			))}
		</ul>
	);
}

function AddTodo() {
	const [text, setText] = useState('');

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!text.trim()) return;
		const id = crypto.randomUUID();
		await client.put('todos', id, { id, text });
		setText('');
	}

	return (
		<form onSubmit={handleSubmit}>
			<input
				type="text"
				value={text}
				onChange={e => setText(e.target.value)}
				placeholder="Add todo..."
				required
			/>
			<button type="submit">Add</button>
		</form>
	);
}

function App() {
	return (
		<>
			<h1>Sinking Todo Example</h1>
			<p>Open this page in multiple tabs to see cross-tab sync.</p>
			<AddTodo />
			<TodoList />
		</>
	);
}

createRoot(document.getElementById('root')!).render(<App />);
