import { expect, test } from 'bun:test';
import { example } from '@sww/worker';

test('example', () => {
	expect(example).toBeFunction();
});
