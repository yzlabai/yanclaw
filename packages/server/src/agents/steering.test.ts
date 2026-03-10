import { describe, expect, it } from "vitest";
import { SteeringManager } from "./steering";

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

	it("classifies cancel keywords correctly", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");

		for (const word of ["stop", "cancel", "停", "取消", "算了", "不用了"]) {
			// Re-register to keep session active
			mgr.register("s1");
			const result = mgr.steer("s1", word);
			expect(result.intent).toBe("cancel");
			expect(result.queued).toBe(false);
		}
	});

	it("classifies cancel with punctuation", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");
		const result = mgr.steer("s1", "stop!");
		expect(result.intent).toBe("cancel");
	});

	it("classifies redirect keywords", () => {
		const mgr = new SteeringManager();

		for (const word of ["actually let me rethink", "instead do this", "不对，换一个", "重新来"]) {
			mgr.register("s1");
			const result = mgr.steer("s1", word);
			expect(result.intent).toBe("redirect");
			expect(result.queued).toBe(true);
		}
	});

	it("defaults to supplement for normal messages", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");
		const result = mgr.steer("s1", "also consider security implications");
		expect(result.intent).toBe("supplement");
		expect(result.queued).toBe(true);
	});

	it("cancel aborts the signal and clears pending messages", () => {
		const mgr = new SteeringManager();
		mgr.register("s1");

		mgr.steer("s1", "add this detail");
		mgr.steer("s1", "and this too");
		expect(mgr.dequeue("s1")).toBe("add this detail");

		// Put messages back
		mgr.register("s1");
		mgr.steer("s1", "queued msg");
		const cancelResult = mgr.steer("s1", "cancel");

		expect(cancelResult.intent).toBe("cancel");
		expect(mgr.dequeue("s1")).toBeNull();
	});

	it("redirect aborts signal and replaces queue with new message", () => {
		const mgr = new SteeringManager();
		const signal = mgr.register("s1");

		mgr.steer("s1", "first supplement");
		const redirectResult = mgr.steer("s1", "actually do something else");

		expect(redirectResult.intent).toBe("redirect");
		expect(signal.aborted).toBe(true);
		expect(mgr.dequeue("s1")).toBe("actually do something else");
		expect(mgr.dequeue("s1")).toBeNull();
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
		// Session should still be active because there are pending messages
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
