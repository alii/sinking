import type { ClientMessage, WorkerMessage } from '@sinking/worker/types';
import { expect, test } from 'bun:test';

test('message types are defined', () => {
	const clientMsg: ClientMessage = { type: 'get', id: '1', store: 'data', key: 'test' };
	const workerMsg: WorkerMessage = { type: 'result', id: '1', value: null };

	expect(clientMsg.type).toBe('get');
	expect(workerMsg.type).toBe('result');
});
