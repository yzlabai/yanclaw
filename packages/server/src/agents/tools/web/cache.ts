/**
 * Web Cache — TTL-based in-memory LRU cache for fetch/search results.
 */

const MAX_CACHE_ENTRIES = 200;

interface CacheEntry {
	data: string;
	expires: number;
}

export class WebCache {
	private cache = new Map<string, CacheEntry>();

	get(key: string): string | undefined {
		const entry = this.cache.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expires) {
			this.cache.delete(key);
			return undefined;
		}
		// Move to end (LRU refresh)
		this.cache.delete(key);
		this.cache.set(key, entry);
		return entry.data;
	}

	set(key: string, data: string, ttlMs: number): void {
		if (this.cache.size >= MAX_CACHE_ENTRIES) {
			const oldest = this.cache.keys().next().value;
			if (oldest !== undefined) this.cache.delete(oldest);
		}
		this.cache.set(key, { data, expires: Date.now() + ttlMs });
	}

	clear(): void {
		this.cache.clear();
	}
}

/** Shared cache instance (lives for the process lifetime). */
export const webCache = new WebCache();

export function clearWebCache(): void {
	webCache.clear();
}
