import { describe, expect, it, vi } from "vitest";
import type { ExecutionStore } from "../db/executions";
import type { SessionStore } from "../db/sessions";
import type { SlashCommandContext } from "./slash-commands";
import { executeSlashCommand, parseSlashCommand } from "./slash-commands";

/** Build a minimal SlashCommandContext with mock stores. */
function makeCtx(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
	return {
		config: {} as SlashCommandContext["config"],
		sessions: {
			getSession: vi.fn(),
			updateModelOverride: vi.fn(),
			resetSession: vi.fn(),
		} as unknown as SessionStore,
		sessionKey: "test-session",
		isOwner: true,
		...overrides,
	};
}

describe("parseSlashCommand", () => {
	it("parses a known command without args", () => {
		expect(parseSlashCommand("/reset")).toEqual({ name: "/reset", args: "" });
	});

	it("parses a known command with args", () => {
		expect(parseSlashCommand("/model gpt-4o")).toEqual({ name: "/model", args: "gpt-4o" });
	});

	it("returns null for unrecognized commands", () => {
		expect(parseSlashCommand("/unknown")).toBeNull();
	});

	it("returns null for non-command text", () => {
		expect(parseSlashCommand("hello world")).toBeNull();
	});

	it("returns null for slash in middle of text", () => {
		expect(parseSlashCommand("please /reset my session")).toBeNull();
	});

	it("trims whitespace in args", () => {
		expect(parseSlashCommand("/model   gpt-4o  ")).toEqual({ name: "/model", args: "gpt-4o" });
	});

	it("handles multiline args", () => {
		const result = parseSlashCommand("/model line1\nline2");
		expect(result).toEqual({ name: "/model", args: "line1\nline2" });
	});
});

describe("executeSlashCommand", () => {
	describe("/help", () => {
		it("returns help text listing all commands", async () => {
			const ctx = makeCtx();
			const result = await executeSlashCommand("/help", "", ctx);
			expect(result.handled).toBe(true);
			expect(result.reply).toContain("/model");
			expect(result.reply).toContain("/reset");
			expect(result.reply).toContain("/status");
			expect(result.reply).toContain("/resume");
			expect(result.reply).toContain("/discard");
		});
	});

	describe("/model", () => {
		it("shows current model when no args", async () => {
			const ctx = makeCtx();
			(ctx.sessions.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
				modelOverride: "claude-sonnet-4-20250514",
			});
			const result = await executeSlashCommand("/model", "", ctx);
			expect(result.handled).toBe(true);
			expect(result.reply).toBe("Current model: claude-sonnet-4-20250514");
		});

		it("shows 'default' when no model override set", async () => {
			const ctx = makeCtx();
			(ctx.sessions.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
				modelOverride: null,
			});
			const result = await executeSlashCommand("/model", "", ctx);
			expect(result.reply).toBe("Current model: default");
		});

		it("switches model when args provided", async () => {
			const ctx = makeCtx();
			(ctx.sessions.updateModelOverride as ReturnType<typeof vi.fn>).mockReturnValue(true);
			const result = await executeSlashCommand("/model", "gpt-4o", ctx);
			expect(result.handled).toBe(true);
			expect(result.reply).toBe("Model switched to: gpt-4o");
			expect(ctx.sessions.updateModelOverride).toHaveBeenCalledWith("test-session", "gpt-4o");
		});

		it("reports error when no active session to update", async () => {
			const ctx = makeCtx();
			(ctx.sessions.updateModelOverride as ReturnType<typeof vi.fn>).mockReturnValue(false);
			const result = await executeSlashCommand("/model", "gpt-4o", ctx);
			expect(result.reply).toBe("No active session to update.");
		});
	});

	describe("/reset", () => {
		it("reports cleared messages count", async () => {
			const ctx = makeCtx();
			(ctx.sessions.resetSession as ReturnType<typeof vi.fn>).mockReturnValue(5);
			const result = await executeSlashCommand("/reset", "", ctx);
			expect(result.handled).toBe(true);
			expect(result.reply).toBe("Session reset (5 messages cleared).");
		});

		it("reports already empty when no messages", async () => {
			const ctx = makeCtx();
			(ctx.sessions.resetSession as ReturnType<typeof vi.fn>).mockReturnValue(0);
			const result = await executeSlashCommand("/reset", "", ctx);
			expect(result.reply).toBe("Session already empty.");
		});
	});

	describe("/status", () => {
		it("shows session stats", async () => {
			const ctx = makeCtx();
			(ctx.sessions.getSession as ReturnType<typeof vi.fn>).mockReturnValue({
				agentId: "assistant",
				modelOverride: "gpt-4o",
				messageCount: 10,
				tokenCount: 2500,
			});
			const result = await executeSlashCommand("/status", "", ctx);
			expect(result.handled).toBe(true);
			expect(result.reply).toContain("Agent: assistant");
			expect(result.reply).toContain("Model: gpt-4o");
			expect(result.reply).toContain("Messages: 10");
			expect(result.reply).toContain("Tokens: ~2500");
		});

		it("reports no active session", async () => {
			const ctx = makeCtx();
			(ctx.sessions.getSession as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
			const result = await executeSlashCommand("/status", "", ctx);
			expect(result.reply).toBe("No active session.");
		});
	});

	describe("/resume", () => {
		it("reports unavailable when no execution store", async () => {
			const ctx = makeCtx({ executions: undefined });
			const result = await executeSlashCommand("/resume", "", ctx);
			expect(result.handled).toBe(true);
			expect(result.reply).toBe("Resumable sessions not available.");
		});

		it("reports no interrupted task when none found", async () => {
			const executions = {
				findInterruptedBySession: vi.fn().mockReturnValue(undefined),
			} as unknown as ExecutionStore;
			const ctx = makeCtx({ executions });
			const result = await executeSlashCommand("/resume", "", ctx);
			expect(result.reply).toBe("No interrupted task found.");
		});

		it("shows interrupted task context", async () => {
			const executions = {
				findInterruptedBySession: vi.fn().mockReturnValue({
					userMessage: "Build a REST API",
					completedSteps: JSON.stringify(["web_search", "file_write"]),
					partialResponse: "partial output...",
				}),
			} as unknown as ExecutionStore;
			const ctx = makeCtx({ executions });
			const result = await executeSlashCommand("/resume", "", ctx);
			expect(result.reply).toContain("Resuming previous task...");
			expect(result.reply).toContain("Build a REST API");
			expect(result.reply).toContain("web_search, file_write");
			expect(result.reply).toContain("Partial response available.");
		});

		it("truncates long user messages", async () => {
			const longMsg = "x".repeat(200);
			const executions = {
				findInterruptedBySession: vi.fn().mockReturnValue({
					userMessage: longMsg,
					completedSteps: null,
					partialResponse: null,
				}),
			} as unknown as ExecutionStore;
			const ctx = makeCtx({ executions });
			const result = await executeSlashCommand("/resume", "", ctx);
			expect(result.reply).toContain("...");
			// Should only show first 100 chars
			expect(result.reply).not.toContain("x".repeat(200));
		});
	});

	describe("/discard", () => {
		it("reports unavailable when no execution store", async () => {
			const ctx = makeCtx({ executions: undefined });
			const result = await executeSlashCommand("/discard", "", ctx);
			expect(result.reply).toBe("Resumable sessions not available.");
		});

		it("discards interrupted task", async () => {
			const executions = {
				discardInterrupted: vi.fn().mockReturnValue(1),
			} as unknown as ExecutionStore;
			const ctx = makeCtx({ executions });
			const result = await executeSlashCommand("/discard", "", ctx);
			expect(result.handled).toBe(true);
			expect(result.reply).toBe("Interrupted task discarded.");
		});

		it("reports nothing to discard", async () => {
			const executions = {
				discardInterrupted: vi.fn().mockReturnValue(0),
			} as unknown as ExecutionStore;
			const ctx = makeCtx({ executions });
			const result = await executeSlashCommand("/discard", "", ctx);
			expect(result.reply).toBe("No interrupted task to discard.");
		});
	});

	it("returns unknown command for unregistered name", async () => {
		const ctx = makeCtx();
		const result = await executeSlashCommand("/foobar", "", ctx);
		expect(result.handled).toBe(true);
		expect(result.reply).toContain("Unknown command");
	});
});
