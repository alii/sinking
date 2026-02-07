export type {
	BatchOperation,
	BulkItem,
	DatabaseSchema,
	IndexSchema,
	StoreSchema,
} from '@sinking/worker/types';
export {
	Sinking,
	descriptionKey,
	hashKey,
	keysEqual,
	type KeyRange,
	type LazyQuery,
	type QueryDescription,
	type SinkingOptions,
	type SubscriptionListener,
} from './client.ts';
