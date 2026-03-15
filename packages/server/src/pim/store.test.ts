import { describe, expect, it } from "vitest";
import { shouldExtract } from "./extractor";

// ── Test PIM types (pure, no DB) ──

describe("PIM types", () => {
	it("PIM_CATEGORIES contains all 8 types", async () => {
		const { PIM_CATEGORIES } = await import("./types");
		expect(PIM_CATEGORIES).toHaveLength(8);
		expect(PIM_CATEGORIES).toContain("person");
		expect(PIM_CATEGORIES).toContain("event");
		expect(PIM_CATEGORIES).toContain("thing");
		expect(PIM_CATEGORIES).toContain("place");
		expect(PIM_CATEGORIES).toContain("time");
		expect(PIM_CATEGORIES).toContain("info");
		expect(PIM_CATEGORIES).toContain("org");
		expect(PIM_CATEGORIES).toContain("ledger");
	});

	it("PIM_SUBTYPES has entries for each category", async () => {
		const { PIM_CATEGORIES, PIM_SUBTYPES } = await import("./types");
		for (const cat of PIM_CATEGORIES) {
			expect(PIM_SUBTYPES[cat]).toBeDefined();
			expect(PIM_SUBTYPES[cat].length).toBeGreaterThan(0);
			expect(PIM_SUBTYPES[cat]).toContain("other");
		}
	});

	it("COMMON_LINK_TYPES is non-empty", async () => {
		const { COMMON_LINK_TYPES } = await import("./types");
		expect(COMMON_LINK_TYPES.length).toBeGreaterThan(10);
	});
});

// ── Test shouldExtract (pure function, no DB) ──

describe("shouldExtract", () => {
	it("rejects empty string", () => {
		expect(shouldExtract("")).toBe(false);
	});

	it("rejects short messages", () => {
		expect(shouldExtract("嗯")).toBe(false);
		expect(shouldExtract("好的")).toBe(false);
		expect(shouldExtract("ok got it")).toBe(false);
	});

	it("rejects pure emoji", () => {
		expect(shouldExtract("\uD83D\uDC4D\uD83D\uDC4D\uD83D\uDC4D")).toBe(false);
	});

	it("rejects slash commands", () => {
		expect(shouldExtract("/help")).toBe(false);
		expect(shouldExtract("/task create something long enough")).toBe(false);
	});

	it("accepts normal conversation", () => {
		expect(shouldExtract("今天见了张总，他是 ABC 公司的 CEO")).toBe(true);
		expect(shouldExtract("下周二下午跟技术团队开 sprint review")).toBe(true);
	});
});
