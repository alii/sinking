import { SWWClient } from '@sww/core';
import type { DatabaseSchema } from '@sww/worker';

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

const client = new SWWClient({
	workerUrl: '/worker.js',
	schema,
});

const form = document.getElementById('form') as HTMLFormElement;
const input = document.getElementById('input') as HTMLInputElement;
const list = document.getElementById('list') as HTMLUListElement;

async function render() {
	const todos = await client.getAll<Todo>('todos');
	list.innerHTML = '';
	for (const todo of todos) {
		const li = document.createElement('li');
		li.innerHTML = `
			<span>${todo.text}</span>
			<span class="delete" data-id="${todo.id}">&times;</span>
		`;
		list.appendChild(li);
	}
}

form.addEventListener('submit', async e => {
	e.preventDefault();
	const id = crypto.randomUUID();
	await client.put('todos', id, { id, text: input.value });
	input.value = '';
	await render();
});

list.addEventListener('click', async e => {
	const target = e.target as HTMLElement;
	if (target.classList.contains('delete')) {
		const id = target.dataset.id!;
		await client.delete('todos', id);
		await render();
	}
});

client.onChange(() => {
	render();
});

render();
