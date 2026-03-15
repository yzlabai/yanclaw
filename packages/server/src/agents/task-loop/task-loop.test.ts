import { describe, expect, it } from "vitest";
import { ConfirmationGate } from "./confirm-gate";
import { DefaultTerminationPolicy } from "./default-termination";
import {
	assertTransition,
	canTransition,
	hasDAGCycle,
	isActive,
	isTerminal,
} from "./state-machine";
import type { ConfirmPolicy, LoopTask, Verifier } from "./types";
import { truncateTail } from "./utils";

// ── State Machine ─────────────────────────────────────────────────

describe("state-machine", () => {
	it("allows valid transitions", () => {
		expect(canTransition("queued", "spawning")).toBe(true);
		expect(canTransition("spawning", "executing")).toBe(true);
		expect(canTransition("executing", "verifying")).toBe(true);
		expect(canTransition("verifying", "evaluating")).toBe(true);
		expect(canTransition("evaluating", "done")).toBe(true);
		expect(canTransition("evaluating", "iterating")).toBe(true);
		expect(canTransition("evaluating", "blocked")).toBe(true);
		expect(canTransition("iterating", "executing")).toBe(true);
		expect(canTransition("done", "delivering")).toBe(true);
		expect(canTransition("blocked", "executing")).toBe(true);
		expect(canTransition("blocked", "cancelled")).toBe(true);
	});

	it("rejects invalid transitions", () => {
		expect(canTransition("queued", "executing")).toBe(false);
		expect(canTransition("queued", "done")).toBe(false);
		expect(canTransition("executing", "done")).toBe(false);
		expect(canTransition("cancelled", "queued")).toBe(false);
		expect(canTransition("done", "queued")).toBe(false);
	});

	it("assertTransition throws on invalid", () => {
		expect(() => assertTransition("queued", "done")).toThrow("Invalid task loop state transition");
	});

	it("assertTransition does not throw on valid", () => {
		expect(() => assertTransition("queued", "spawning")).not.toThrow();
	});

	it("identifies terminal states", () => {
		expect(isTerminal("cancelled")).toBe(true);
		expect(isTerminal("queued")).toBe(false);
		expect(isTerminal("done")).toBe(false);
	});

	it("identifies active states", () => {
		expect(isActive("executing")).toBe(true);
		expect(isActive("verifying")).toBe(true);
		expect(isActive("spawning")).toBe(true);
		expect(isActive("blocked")).toBe(false);
		expect(isActive("cancelled")).toBe(false);
		expect(isActive("waiting_confirm")).toBe(false);
	});

	it("supports waiting_confirm restore transitions", () => {
		expect(canTransition("executing", "waiting_confirm")).toBe(true);
		expect(canTransition("verifying", "waiting_confirm")).toBe(true);
		expect(canTransition("delivering", "waiting_confirm")).toBe(true);
		expect(canTransition("waiting_confirm", "executing")).toBe(true);
		expect(canTransition("waiting_confirm", "verifying")).toBe(true);
		expect(canTransition("waiting_confirm", "delivering")).toBe(true);
		expect(canTransition("waiting_confirm", "cancelled")).toBe(true);
	});
});

// ── DefaultTerminationPolicy ──────────────────────────────────────

describe("DefaultTerminationPolicy", () => {
	const passVerifier: Verifier<{ ok: boolean }> = {
		async verify() {
			return { allPassed: true, ok: true };
		},
		passed(r) {
			return r.ok;
		},
	};

	const makeTask = (overrides: Partial<LoopTask> = {}): LoopTask =>
		({
			id: "t1",
			preset: "dev",
			state: "evaluating",
			prompt: "test",
			workDir: "/tmp",
			iteration: 0,
			maxIterations: 10,
			maxDurationMs: 4 * 3600_000,
			errorHistory: [],
			confirmPolicy: { operations: [], stages: [], riskThreshold: "none" as const },
			options: {},
			triggeredBy: "dashboard" as const,
			createdAt: Date.now(),
			...overrides,
		}) as LoopTask;

	it("returns done when verifier passes", () => {
		const policy = new DefaultTerminationPolicy(passVerifier);
		const result = policy.judge({
			task: makeTask(),
			lastResult: { ok: true },
			elapsed: 0,
		});
		expect(result.action).toBe("done");
	});

	it("returns iterate when verifier fails and under limits", () => {
		const policy = new DefaultTerminationPolicy(passVerifier);
		const result = policy.judge({
			task: makeTask({ iteration: 2 }),
			lastResult: { ok: false },
			elapsed: 1000,
		});
		expect(result.action).toBe("iterate");
	});

	it("returns blocked when max iterations reached", () => {
		const policy = new DefaultTerminationPolicy(passVerifier);
		const result = policy.judge({
			task: makeTask({ iteration: 10, maxIterations: 10 }),
			lastResult: { ok: false },
			elapsed: 1000,
		});
		expect(result.action).toBe("blocked");
		expect(result.reason).toContain("最大迭代次数");
	});

	it("returns blocked when duration exceeded", () => {
		const policy = new DefaultTerminationPolicy(passVerifier);
		const result = policy.judge({
			task: makeTask({ maxDurationMs: 1000 }),
			lastResult: { ok: false },
			elapsed: 2000,
		});
		expect(result.action).toBe("blocked");
		expect(result.reason).toContain("超时");
	});

	it("detects dead loop with 3 identical errors", () => {
		const policy = new DefaultTerminationPolicy(passVerifier);
		const result = policy.judge({
			task: makeTask({
				errorHistory: [
					"Error: cannot find module 'foo'",
					"Error: cannot find module 'foo'",
					"Error: cannot find module 'foo'",
				],
			}),
			lastResult: { ok: false },
			elapsed: 1000,
		});
		expect(result.action).toBe("blocked");
		expect(result.reason).toContain("死循环");
	});

	it("does not detect dead loop with different errors", () => {
		const policy = new DefaultTerminationPolicy(passVerifier);
		const result = policy.judge({
			task: makeTask({
				errorHistory: ["Error: foo", "Error: bar", "Error: baz"],
			}),
			lastResult: { ok: false },
			elapsed: 1000,
		});
		expect(result.action).toBe("iterate");
	});

	it("normalizes timestamps and line numbers for dead loop detection", () => {
		const policy = new DefaultTerminationPolicy(passVerifier);
		const result = policy.judge({
			task: makeTask({
				errorHistory: [
					"2026-03-15T10:00:00 Error at src/foo.ts:10:5",
					"2026-03-15T10:01:00 Error at src/foo.ts:10:5",
					"2026-03-15T10:02:00 Error at src/foo.ts:10:5",
				],
			}),
			lastResult: { ok: false },
			elapsed: 1000,
		});
		expect(result.action).toBe("blocked");
	});
});

// ── ConfirmationGate ──────────────────────────────────────────────

describe("ConfirmationGate", () => {
	const gate = new ConfirmationGate();
	const makeTask = (policy: Partial<ConfirmPolicy> = {}): LoopTask =>
		({
			confirmPolicy: {
				operations: [],
				stages: [],
				riskThreshold: "none",
				...policy,
			},
		}) as unknown as LoopTask;

	it("confirms when stage matches", () => {
		const task = makeTask({ stages: ["delivering"] });
		expect(gate.shouldConfirm(task, "delivering")).toBe(true);
	});

	it("does not confirm when stage does not match", () => {
		const task = makeTask({ stages: ["delivering"] });
		expect(gate.shouldConfirm(task, "executing")).toBe(false);
	});

	it("confirms operation match", () => {
		const policy: ConfirmPolicy = {
			operations: ["shell", "file_write"],
			stages: [],
			riskThreshold: "none",
		};
		expect(gate.shouldConfirmOperation(policy, "shell")).toBe(true);
		expect(gate.shouldConfirmOperation(policy, "file_read")).toBe(false);
	});

	it("confirms risk threshold", () => {
		const policy: ConfirmPolicy = {
			operations: [],
			stages: [],
			riskThreshold: "medium",
		};
		expect(gate.shouldConfirmRisk(policy, "high")).toBe(true);
		expect(gate.shouldConfirmRisk(policy, "medium")).toBe(true);
		expect(gate.shouldConfirmRisk(policy, "low")).toBe(false);
	});

	it("never confirms risk when threshold is none", () => {
		const policy: ConfirmPolicy = {
			operations: [],
			stages: [],
			riskThreshold: "none",
		};
		expect(gate.shouldConfirmRisk(policy, "high")).toBe(false);
	});
});

// ── DAG Cycle Detection ───────────────────────────────────────────

describe("hasDAGCycle", () => {
	it("returns false for a valid DAG", () => {
		expect(
			hasDAGCycle([
				{ id: "a", dependsOn: [] },
				{ id: "b", dependsOn: ["a"] },
				{ id: "c", dependsOn: ["a", "b"] },
			]),
		).toBe(false);
	});

	it("detects a simple cycle", () => {
		expect(
			hasDAGCycle([
				{ id: "a", dependsOn: ["b"] },
				{ id: "b", dependsOn: ["a"] },
			]),
		).toBe(true);
	});

	it("detects a transitive cycle", () => {
		expect(
			hasDAGCycle([
				{ id: "a", dependsOn: ["c"] },
				{ id: "b", dependsOn: ["a"] },
				{ id: "c", dependsOn: ["b"] },
			]),
		).toBe(true);
	});

	it("detects a self-cycle", () => {
		expect(hasDAGCycle([{ id: "a", dependsOn: ["a"] }])).toBe(true);
	});

	it("returns false for empty nodes", () => {
		expect(hasDAGCycle([])).toBe(false);
	});

	it("returns false for single node with no deps", () => {
		expect(hasDAGCycle([{ id: "a", dependsOn: [] }])).toBe(false);
	});
});

// ── Utils ─────────────────────────────────────────────────────────

describe("truncateTail", () => {
	it("returns full text when under limit", () => {
		expect(truncateTail("a\nb\nc", 5)).toBe("a\nb\nc");
	});

	it("truncates keeping tail lines", () => {
		const text = Array.from({ length: 10 }, (_, i) => `line${i}`).join("\n");
		const result = truncateTail(text, 3);
		expect(result).toContain("truncated 7 lines");
		expect(result).toContain("line7");
		expect(result).toContain("line8");
		expect(result).toContain("line9");
		expect(result).not.toContain("line0");
	});
});
