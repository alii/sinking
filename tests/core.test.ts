import { descriptionKey, hashKey, keysEqual } from '@sinking/core';
import { describe, expect, test } from 'bun:test';

describe('hashKey', () => {
	test('hashes string keys', () => {
		expect(hashKey('test')).toBe('s:test');
		expect(hashKey('')).toBe('s:');
	});

	test('hashes number keys', () => {
		expect(hashKey(42)).toBe('n:42');
		expect(hashKey(0)).toBe('n:0');
		expect(hashKey(-1)).toBe('n:-1');
	});

	test('hashes date keys', () => {
		const date = new Date(1234567890000);
		expect(hashKey(date)).toBe('d:1234567890000');
	});

	test('hashes array keys', () => {
		expect(hashKey(['a', 'b'])).toBe('a:[s:a,s:b]');
		expect(hashKey([1, 2, 3])).toBe('a:[n:1,n:2,n:3]');
		expect(hashKey([])).toBe('a:[]');
	});
});

describe('keysEqual', () => {
	test('compares primitives', () => {
		expect(keysEqual('a', 'a')).toBe(true);
		expect(keysEqual('a', 'b')).toBe(false);
		expect(keysEqual(1, 1)).toBe(true);
		expect(keysEqual(1, 2)).toBe(false);
	});

	test('compares dates', () => {
		const d1 = new Date(1000);
		const d2 = new Date(1000);
		const d3 = new Date(2000);
		expect(keysEqual(d1, d2)).toBe(true);
		expect(keysEqual(d1, d3)).toBe(false);
	});

	test('compares arrays', () => {
		expect(keysEqual([1, 2], [1, 2])).toBe(true);
		expect(keysEqual([1, 2], [1, 3])).toBe(false);
		expect(keysEqual([1], [1, 2])).toBe(false);
	});
});

describe('descriptionKey', () => {
	test('generates key for get query', () => {
		expect(descriptionKey({ type: 'get', store: 'todos', key: 'abc' })).toBe('get:todos:s:abc');
	});

	test('generates key for getAll query', () => {
		expect(descriptionKey({ type: 'getAll', store: 'todos' })).toBe('getAll:todos');
	});

	test('generates key for getByIndex query', () => {
		expect(
			descriptionKey({ type: 'getByIndex', store: 'todos', indexName: 'byUser', key: 'user1' }),
		).toBe('getByIndex:todos:byUser:s:user1');
	});

	test('generates key for getAllByIndex query', () => {
		expect(
			descriptionKey({ type: 'getAllByIndex', store: 'todos', indexName: 'byStatus', key: 'done' }),
		).toBe('getAllByIndex:todos:byStatus:s:done');
	});
});
