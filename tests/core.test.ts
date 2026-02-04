import { expect, test } from 'bun:test';
import { SWWClient } from '@sww/core';

test('SWWClient is exported', () => {
	expect(SWWClient).toBeFunction();
});
