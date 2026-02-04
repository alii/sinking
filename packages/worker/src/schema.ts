import type { DatabaseSchema } from './types.ts';

export function applySchema(db: IDBDatabase, tx: IDBTransaction, schema: DatabaseSchema): void {
	for (const [storeName, storeSchema] of Object.entries(schema.stores)) {
		const exists = db.objectStoreNames.contains(storeName);
		const store = exists
			? tx.objectStore(storeName)
			: db.createObjectStore(storeName, {
					keyPath: storeSchema.keyPath,
					autoIncrement: storeSchema.autoIncrement,
				});

		if (storeSchema.indexes) {
			for (const [indexName, indexSchema] of Object.entries(storeSchema.indexes)) {
				if (!store.indexNames.contains(indexName)) {
					store.createIndex(indexName, indexSchema.keyPath, {
						unique: indexSchema.unique,
						multiEntry: indexSchema.multiEntry,
					});
				}
			}
		}
	}
}
