import { describe, expect, it, vi } from "vitest";

// Mock bun:sqlite and drizzle before imports
const mockRun = vi.fn().mockReturnValue({ changes: 0 });
const mockGet = vi.fn();
const mockAll = vi.fn().mockReturnValue([]);

vi.mock("./sqlite", () => ({
	getDb: () => ({
		insert: () => ({ values: () => ({ run: mockRun }) }),
		update: () => ({
			set: () => ({
				where: () => ({ run: mockRun }),
			}),
		}),
		delete: () => ({
			where: () => ({ run: mockRun }),
		}),
		select: () => ({
			from: () => ({
				where: () => ({
					all: mockAll,
					get: mockGet,
				}),
			}),
		}),
	}),
}));

vi.mock("drizzle-orm", () => ({
	eq: (...args: unknown[]) => args,
	and: (...args: unknown[]) => args,
	lt: (...args: unknown[]) => args,
}));

const { ExecutionStore } = await import("./executions");

describe("ExecutionStore", () => {
	describe("create", () => {
		it("returns a non-empty execution id", () => {
			mockRun.mockReturnValue({ changes: 1 });
			const store = new ExecutionStore();
			const id = store.create({
				sessionKey: "s1",
				agentId: "agent1",
				userMessage: "hello",
			});
			expect(id).toBeTruthy();
			expect(typeof id).toBe("string");
			expect(mockRun).toHaveBeenCalled();
		});
	});

	describe("updateProgress", () => {
		it("calls db update with serialized steps", () => {
			mockRun.mockClear();
			const store = new ExecutionStore();
			store.updateProgress("exec1", ["step1", "step2"], "partial");
			expect(mockRun).toHaveBeenCalled();
		});
	});

	describe("complete", () => {
		it("calls db update to set status completed", () => {
			mockRun.mockClear();
			const store = new ExecutionStore();
			store.complete("exec1");
			expect(mockRun).toHaveBeenCalled();
		});
	});

	describe("markRunningAsInterrupted", () => {
		it("returns number of changed rows", () => {
			mockRun.mockReturnValue({ changes: 3 });
			const store = new ExecutionStore();
			const count = store.markRunningAsInterrupted();
			expect(count).toBe(3);
		});

		it("returns 0 when no running executions", () => {
			mockRun.mockReturnValue({ changes: 0 });
			const store = new ExecutionStore();
			expect(store.markRunningAsInterrupted()).toBe(0);
		});
	});

	describe("findInterrupted", () => {
		it("returns interrupted execution rows", () => {
			const rows = [
				{ id: "e1", status: "interrupted", sessionKey: "s1" },
				{ id: "e2", status: "interrupted", sessionKey: "s2" },
			];
			mockAll.mockReturnValue(rows);
			const store = new ExecutionStore();
			expect(store.findInterrupted()).toEqual(rows);
		});

		it("returns empty array when none interrupted", () => {
			mockAll.mockReturnValue([]);
			const store = new ExecutionStore();
			expect(store.findInterrupted()).toHaveLength(0);
		});
	});

	describe("findInterruptedBySession", () => {
		it("returns matching execution", () => {
			const row = { id: "e1", status: "interrupted", sessionKey: "s1", userMessage: "hello" };
			mockGet.mockReturnValue(row);
			const store = new ExecutionStore();
			expect(store.findInterruptedBySession("s1")).toEqual(row);
		});

		it("returns undefined when no match", () => {
			mockGet.mockReturnValue(undefined);
			const store = new ExecutionStore();
			expect(store.findInterruptedBySession("s999")).toBeUndefined();
		});
	});

	describe("discardInterrupted", () => {
		it("returns count of deleted rows", () => {
			mockRun.mockReturnValue({ changes: 1 });
			const store = new ExecutionStore();
			expect(store.discardInterrupted("s1")).toBe(1);
		});

		it("returns 0 when nothing to discard", () => {
			mockRun.mockReturnValue({ changes: 0 });
			const store = new ExecutionStore();
			expect(store.discardInterrupted("nonexistent")).toBe(0);
		});
	});

	describe("pruneCompleted", () => {
		it("returns 0 for non-positive days", () => {
			const store = new ExecutionStore();
			expect(store.pruneCompleted(0)).toBe(0);
			expect(store.pruneCompleted(-1)).toBe(0);
		});

		it("deletes old completed executions", () => {
			mockRun.mockReturnValue({ changes: 5 });
			const store = new ExecutionStore();
			expect(store.pruneCompleted(30)).toBe(5);
		});
	});
});
