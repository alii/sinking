import { expect, test } from 'bun:test';
import { hello } from '@sww/core';

test('hello', () => {
	expect(hello()).toBe('hello from core');
});
