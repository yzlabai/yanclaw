import { describe, expect, it, vi } from "vitest";
import { preheatPim } from "./preheat";
import type { PimStore } from "./store";

function mockStore(overrides: Partial<PimStore> = {}): PimStore {
	return {
		matchByKeywords: vi.fn().mockResolvedValue([]),
		getLinks: vi.fn().mockResolvedValue([]),
		query: vi.fn().mockResolvedValue([]),
		...overrides,
	} as unknown as PimStore;
}

describe("preheatPim", () => {
	it("returns empty string for very short messages", async () => {
		const store = mockStore();
		const result = await preheatPim("嗯", store);
		expect(result).toBe("");
	});

	it("returns empty string when no keywords extracted", async () => {
		const store = mockStore();
		// All stop words
		const result = await preheatPim("是 的 了 在 有", store);
		expect(result).toBe("");
	});

	it("returns empty string when no matches found", async () => {
		const store = mockStore();
		const result = await preheatPim("这个产品需要重新设计一下界面", store);
		expect(result).toBe("");
	});

	it("includes person context when matched", async () => {
		const store = mockStore({
			matchByKeywords: vi.fn().mockImplementation((_kw: string[], category?: string) => {
				if (category === "person") {
					return [
						{
							id: "p1",
							category: "person",
							title: "张总",
							properties: { role: "CEO", relation: "客户" },
							subtype: "client",
							content: null,
							tags: [],
							status: null,
							datetime: null,
							confidence: 1.0,
							sourceIds: [],
							agentId: null,
							reminded: false,
							createdAt: 1000,
							updatedAt: 2000,
						},
					];
				}
				return [];
			}),
		});

		const result = await preheatPim("张总那边怎么样了，有什么新的进展吗", store);
		expect(result).toContain("张总");
		expect(result).toContain("个人信息系统");
	});

	it("includes pending tasks when time reference detected", async () => {
		const store = mockStore({
			query: vi.fn().mockImplementation((opts: { subtype?: string }) => {
				if (opts.subtype === "task") {
					return [
						{
							id: "t1",
							category: "event",
							subtype: "task",
							title: "写报告",
							status: "pending",
							datetime: "2026-03-20",
							properties: {},
							tags: [],
							content: null,
							confidence: 1.0,
							sourceIds: [],
							agentId: null,
							reminded: false,
							createdAt: 1000,
							updatedAt: 2000,
						},
					];
				}
				return [];
			}),
		});

		const result = await preheatPim("这周有什么安排吗？有哪些待办事项需要处理", store);
		expect(result).toContain("待办");
		expect(result).toContain("写报告");
	});
});
