export function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export function openDB(
	name: string,
	version: number,
	onUpgrade: (db: IDBDatabase, event: IDBVersionChangeEvent) => void,
): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(name, version);
		req.onerror = () => reject(req.error);
		req.onsuccess = () => resolve(req.result);
		req.onupgradeneeded = event => onUpgrade(req.result, event);
	});
}
