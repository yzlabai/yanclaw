import { describe, expect, it } from "vitest";
import { classifyByKeywords, classifyIntent, SteeringManager } from "./steering";

describe("SteeringManager", () => {
	it("register returns an AbortSignal", () => {
		const mgr = new SteeringManager();
		const signal = mgr.register("s1");
		expect(signal).toBeInstanceOf(AbortSignal);
		expect(signal.aborted).toBe(false);
	});

	it("isActive returns true after register, false after unregister", () => {
		const mgr = new SteeringManager();
		expect(mgr.isActive("s1")).toBe(false);
		mgr.register("s1");
		expect(mgr.isActive("s1")).toBe(true);
		mgr.unregister("s1");
		expect(mgr.isActive("s1")).toBe(false);
	});

	it("register aborts previous run for same session", () => {
		const mgr = new SteeringManager();
		const signal1 = mgr.register("s1");
		const signal2 = mgr.register("s1");
		expect(signal1.aborted).toBe(true);
		expect(signal2.aborted).toBe(false);
	});

	it("steer with pre-classified cancel intent aborts and clears queue", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");
		mgr.steer("s1", "queued msg");

		mgr.register("s1");
		mgr.steer("s1", "another queued");
		const result = mgr.steer("s1", "anything", "cancel");

		expect(result.intent).toBe("cancel");
		expect(result.queued).toBe(false);
		expect(mgr.dequeue("s1")).toBeNull();
	});

	it("steer with pre-classified redirect intent aborts and replaces queue", () => {
		const mgr = new SteeringManager();
		const signal = mgr.register("s1");
		mgr.steer("s1", "first supplement");

		const result = mgr.steer("s1", "do something else", "redirect");

		expect(result.intent).toBe("redirect");
		expect(result.queued).toBe(true);
		expect(signal.aborted).toBe(true);
		expect(mgr.dequeue("s1")).toBe("do something else");
		expect(mgr.dequeue("s1")).toBeNull();
	});

	it("steer with pre-classified aside intent does not abort or queue", () => {
		const mgr = new SteeringManager();
		const signal = mgr.register("s1");
		mgr.steer("s1", "queued msg");

		const result = mgr.steer("s1", "what port is this?", "aside");

		expect(result.intent).toBe("aside");
		expect(result.queued).toBe(false);
		expect(signal.aborted).toBe(false);
		// Previous queued message should still be there
		expect(mgr.dequeue("s1")).toBe("queued msg");
	});

	it("steer with pre-classified supplement intent queues the message", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");

		const result = mgr.steer("s1", "also add tests", "supplement");

		expect(result.intent).toBe("supplement");
		expect(result.queued).toBe(true);
		expect(mgr.dequeue("s1")).toBe("also add tests");
	});

	it("falls back to keyword matching when no intent provided", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");
		const result = mgr.steer("s1", "stop");
		expect(result.intent).toBe("cancel");
	});

	it("dequeue returns messages in FIFO order", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");

		mgr.steer("s1", "first");
		mgr.steer("s1", "second");
		mgr.steer("s1", "third");

		expect(mgr.dequeue("s1")).toBe("first");
		expect(mgr.dequeue("s1")).toBe("second");
		expect(mgr.dequeue("s1")).toBe("third");
		expect(mgr.dequeue("s1")).toBeNull();
	});

	it("dequeue returns null for unknown session", () => {
		const mgr = new SteeringManager();
		expect(mgr.dequeue("nonexistent")).toBeNull();
	});

	it("unregister keeps session if pending messages remain", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");
		mgr.steer("s1", "queued");
		mgr.unregister("s1");
		expect(mgr.isActive("s1")).toBe(true);
		expect(mgr.dequeue("s1")).toBe("queued");
	});

	it("remove force-cleans a session and aborts signal", () => {
		const mgr = new SteeringManager();
		const signal = mgr.register("s1");
		mgr.steer("s1", "queued");

		mgr.remove("s1");

		expect(signal.aborted).toBe(true);
		expect(mgr.isActive("s1")).toBe(false);
		expect(mgr.dequeue("s1")).toBeNull();
	});

	it("steer on inactive session returns supplement with queued=false", () => {
		const mgr = new SteeringManager();
		const result = mgr.steer("nonexistent", "hello");
		expect(result.intent).toBe("supplement");
		expect(result.queued).toBe(false);
	});

	it("sessions are independent", () => {
		const mgr = new SteeringManager();
		const signal1 = mgr.register("s1");
		const signal2 = mgr.register("s2");

		mgr.steer("s1", "stop");
		expect(signal1.aborted).toBe(true);
		expect(signal2.aborted).toBe(false);
		expect(mgr.isActive("s2")).toBe(true);
	});
});

describe("classifyByKeywords", () => {
	it("classifies cancel keywords", () => {
		for (const word of ["stop", "cancel", "停", "取消", "算了", "不用了", "别写了", "别做了"]) {
			expect(classifyByKeywords(word)).toBe("cancel");
		}
	});

	it("classifies cancel with punctuation", () => {
		expect(classifyByKeywords("stop!")).toBe("cancel");
		expect(classifyByKeywords("算了.")).toBe("cancel");
	});

	it("classifies redirect keywords", () => {
		for (const phrase of [
			"actually let me rethink",
			"instead do this",
			"不对，换一个",
			"重新来",
			"这个不行",
		]) {
			expect(classifyByKeywords(phrase)).toBe("redirect");
		}
	});

	it("defaults to supplement for normal messages", () => {
		expect(classifyByKeywords("also consider security implications")).toBe("supplement");
		expect(classifyByKeywords("add unit tests")).toBe("supplement");
	});
});

describe("classifyIntent (LLM)", () => {
	it("fast-path: obvious cancel keywords skip LLM", async () => {
		const mockModel = {} as Parameters<typeof classifyIntent>[1];
		// These should return without calling the model
		expect(await classifyIntent("算了", mockModel)).toBe("cancel");
		expect(await classifyIntent("stop", mockModel)).toBe("cancel");
		expect(await classifyIntent("取消", mockModel)).toBe("cancel");
	});

	it("fast-path: exact redirect keywords skip LLM", async () => {
		const mockModel = {} as Parameters<typeof classifyIntent>[1];
		expect(await classifyIntent("不对", mockModel)).toBe("redirect");
		expect(await classifyIntent("重新", mockModel)).toBe("redirect");
	});

	it("falls back to keyword matching on LLM error", async () => {
		// A model that throws on any call
		const badModel = {
			modelId: "bad",
			specificationVersion: "v1",
			provider: "bad",
			doGenerate: () => {
				throw new Error("LLM unavailable");
			},
		} as unknown as Parameters<typeof classifyIntent>[1];

		// Non-keyword message → LLM fails → fallback to keywords → supplement
		expect(await classifyIntent("please also check the logs", badModel)).toBe("supplement");
	});
});
