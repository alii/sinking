import type { SWWClient } from '@sww/core';
import { useEffect, useEffectEvent, useState } from 'react';

export function useLiveQuery<T>(
	client: SWWClient,
	queryFn: () => Promise<T>,
	defaultValue?: T,
): T | undefined;
export function useLiveQuery<T>(client: SWWClient, queryFn: () => Promise<T>, defaultValue: T): T;
export function useLiveQuery<T>(
	client: SWWClient,
	queryFn: () => Promise<T>,
	defaultValue?: T,
): T | undefined {
	const [result, setResult] = useState<T | undefined>(defaultValue);
	const query = useEffectEvent(queryFn);

	useEffect(() => {
		let cancelled = false;

		const runQuery = async () => {
			const data = await query();
			if (!cancelled) setResult(data);
		};

		runQuery();

		const unsubscribe = client.onChange(() => {
			runQuery();
		});

		return () => {
			cancelled = true;
			unsubscribe();
		};
	}, [client]);

	return result;
}
