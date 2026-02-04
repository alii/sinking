import { expect, test } from 'bun:test';
import { SWWClient } from '@sinking/core';

test('SWWClient is exported', () => {
	expect(SWWClient).toBeFunction();
});
