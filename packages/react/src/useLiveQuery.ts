import { descriptionKey, type LazyQuery, type SWWClient } from '@sinking/core';
import { useCallback, useSyncExternalStore } from 'react';

export function useLiveQuery<T>(
	client: SWWClient,
	queryFn: () => LazyQuery<T>,
	defaultValue: T,
): T;
export function useLiveQuery<T>(
	client: SWWClient,
	queryFn: () => LazyQuery<T>,
	defaultValue?: T,
): T | undefined;
export function useLiveQuery<T>(
	client: SWWClient,
	queryFn: () => LazyQuery<T>,
	defaultValue?: T,
): T | undefined {
	const query = queryFn();
	const key = descriptionKey(query.description);

	const subscribe = useCallback(
		(onStoreChange: () => void) => client.subscribe(query.description, onStoreChange),
		[client, key],
	);

	const getSnapshot = useCallback(
		() => client.getCached<T>(query.description) ?? defaultValue,
		[client, key, defaultValue],
	);

	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
