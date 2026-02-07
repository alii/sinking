import type { WorkerMessage } from './types.ts';

export function reply(port: MessagePort, id: string, value: unknown): void {
	port.postMessage({ type: 'result', id, value } satisfies WorkerMessage);
}

export function replyError(port: MessagePort, id: string, error: unknown): void {
	port.postMessage({
		type: 'error',
		id,
		error: error instanceof Error ? error.message : 'Unknown error',
	} satisfies WorkerMessage);
}

export function emit(ports: Set<MessagePort>, message: WorkerMessage): void {
	for (const port of ports) {
		port.postMessage(message);
	}
}
