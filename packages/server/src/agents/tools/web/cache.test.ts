import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebCache } from "./cache";

describe("WebCache", () => {
	let cache: WebCache;

	beforeEach(() => {
		cache = new WebCache();
	});

	afterEach(() => {
		cache.clear();
	});

	it("returns undefined for missing keys", () => {
		expect(cache.get("missing")).toBeUndefined();
	});

	it("stores and retrieves values", () => {
		cache.set("k1", "hello", 60_000);
		expect(cache.get("k1")).toBe("hello");
	});

	it("expires entries after TTL", async () => {
		cache.set("k1", "hello", 10); // 10ms TTL
		await new Promise((r) => setTimeout(r, 20));
		expect(cache.get("k1")).toBeUndefined();
	});

	it("evicts oldest entry when exceeding max size", () => {
		// WebCache has MAX_CACHE_ENTRIES = 200
		for (let i = 0; i < 201; i++) {
			cache.set(`key-${i}`, `val-${i}`, 60_000);
		}
		// The first entry should have been evicted
		expect(cache.get("key-0")).toBeUndefined();
		// Latest entries should exist
		expect(cache.get("key-200")).toBe("val-200");
	});

	it("clear() removes all entries", () => {
		cache.set("a", "1", 60_000);
		cache.set("b", "2", 60_000);
		cache.clear();
		expect(cache.get("a")).toBeUndefined();
		expect(cache.get("b")).toBeUndefined();
	});

	it("overwrites existing key and refreshes TTL", async () => {
		cache.set("k1", "old", 10); // 10ms
		cache.set("k1", "new", 60_000); // long TTL
		await new Promise((r) => setTimeout(r, 20));
		expect(cache.get("k1")).toBe("new");
	});
});
