import index from './index.html';

let workerBundle: string | null = null;

async function buildWorker(): Promise<string> {
	if (workerBundle) return workerBundle;
	const result = await Bun.build({
		entrypoints: ['./src/worker.ts'],
		format: 'esm',
		target: 'browser',
	});
	if (!result.success) {
		throw new Error(result.logs.join('\n'));
	}
	workerBundle = await result.outputs[0]!.text();
	return workerBundle;
}

Bun.serve({
	port: 3000,
	routes: {
		'/': index,
	},
	async fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === '/worker.js') {
			const code = await buildWorker();
			return new Response(code, {
				headers: { 'Content-Type': 'application/javascript' },
			});
		}
		return new Response('Not found', { status: 404 });
	},
	development: true,
});

console.log('http://localhost:3000');
