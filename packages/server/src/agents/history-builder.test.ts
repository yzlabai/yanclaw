import { describe, expect, it } from "vitest";
import type { MessageRow } from "../db/sessions";
import { buildHistory } from "./history-builder";

function makeMsg(overrides: Partial<MessageRow>): MessageRow {
	return {
		id: "msg-1",
		sessionKey: "sess-1",
		role: "assistant",
		content: "Hello",
		reasoning: null,
		reasoningSignature: null,
		toolCalls: null,
		attachments: null,
		model: "test-model",
		tokenCount: 10,
		createdAt: Date.now(),
		...overrides,
	} as MessageRow;
}

describe("buildHistory", () => {
	const userMsg = makeMsg({ role: "user", content: "Hi" });
	const plainAssistant = makeMsg({ role: "assistant", content: "Hello" });
	const reasoningAssistant = makeMsg({
		role: "assistant",
		content: "Answer",
		reasoning: "Let me think...",
	});
	const signedAssistant = makeMsg({
		role: "assistant",
		content: "Answer",
		reasoning: "Deep thought",
		reasoningSignature: "sig-abc123",
	});

	describe("anthropic strategy", () => {
		it("returns plain content for messages without reasoning", () => {
			const result = buildHistory("anthropic", [userMsg, plainAssistant]);
			expect(result).toEqual([
				{ role: "user", content: "Hi" },
				{ role: "assistant", content: "Hello" },
			]);
		});

		it("includes reasoning part with signature for assistant messages", () => {
			const result = buildHistory("anthropic", [userMsg, signedAssistant]);
			expect(result).toHaveLength(2);
			expect(result[1]).toEqual({
				role: "assistant",
				content: [
					{ type: "reasoning", text: "Deep thought", signature: "sig-abc123" },
					{ type: "text", text: "Answer" },
				],
			});
		});

		it("includes reasoning part without signature when not available", () => {
			const result = buildHistory("anthropic", [userMsg, reasoningAssistant]);
			expect(result[1]).toEqual({
				role: "assistant",
				content: [
					{ type: "reasoning", text: "Let me think..." },
					{ type: "text", text: "Answer" },
				],
			});
		});
	});

	describe("google strategy", () => {
		it("includes reasoning as content parts", () => {
			const result = buildHistory("google", [userMsg, reasoningAssistant]);
			expect(result[1]).toEqual({
				role: "assistant",
				content: [
					{ type: "reasoning", text: "Let me think..." },
					{ type: "text", text: "Answer" },
				],
			});
		});

		it("returns plain content without reasoning", () => {
			const result = buildHistory("google", [userMsg, plainAssistant]);
			expect(result[1]).toEqual({ role: "assistant", content: "Hello" });
		});
	});

	describe("openai strategy", () => {
		it("strips reasoning even when present", () => {
			const result = buildHistory("openai", [userMsg, reasoningAssistant]);
			expect(result[1]).toEqual({ role: "assistant", content: "Answer" });
		});

		it("returns plain content as-is", () => {
			const result = buildHistory("openai", [userMsg, plainAssistant]);
			expect(result[1]).toEqual({ role: "assistant", content: "Hello" });
		});
	});

	describe("openai-compatible strategy", () => {
		it("includes reasoning as content parts (for fetch middleware to pick up)", () => {
			const result = buildHistory("openai-compatible", [userMsg, reasoningAssistant]);
			expect(result[1]).toEqual({
				role: "assistant",
				content: [
					{ type: "reasoning", text: "Let me think..." },
					{ type: "text", text: "Answer" },
				],
			});
		});

		it("returns plain content without reasoning", () => {
			const result = buildHistory("openai-compatible", [userMsg, plainAssistant]);
			expect(result[1]).toEqual({ role: "assistant", content: "Hello" });
		});
	});

	describe("ollama strategy", () => {
		it("strips reasoning even when present", () => {
			const result = buildHistory("ollama", [userMsg, reasoningAssistant]);
			expect(result[1]).toEqual({ role: "assistant", content: "Answer" });
		});
	});

	describe("mixed conversation", () => {
		it("handles multi-turn with mixed reasoning/non-reasoning messages", () => {
			const msgs = [
				makeMsg({ role: "user", content: "Q1" }),
				makeMsg({ role: "assistant", content: "A1" }),
				makeMsg({ role: "user", content: "Q2" }),
				makeMsg({ role: "assistant", content: "A2", reasoning: "Thinking about Q2" }),
				makeMsg({ role: "user", content: "Q3" }),
				makeMsg({ role: "assistant", content: "A3" }),
			];

			const result = buildHistory("anthropic", msgs);
			expect(result).toHaveLength(6);
			// First assistant: no reasoning
			expect(result[1]).toEqual({ role: "assistant", content: "A1" });
			// Second assistant: has reasoning
			expect(result[3]).toEqual({
				role: "assistant",
				content: [
					{ type: "reasoning", text: "Thinking about Q2" },
					{ type: "text", text: "A2" },
				],
			});
			// Third assistant: no reasoning
			expect(result[5]).toEqual({ role: "assistant", content: "A3" });
		});
	});

	describe("edge cases", () => {
		it("handles empty message list", () => {
			const result = buildHistory("anthropic", []);
			expect(result).toEqual([]);
		});

		it("handles null content with reasoning", () => {
			const msg = makeMsg({ role: "assistant", content: null, reasoning: "thinking" });
			const result = buildHistory("anthropic", [msg]);
			expect(result[0]).toEqual({
				role: "assistant",
				content: [
					{ type: "reasoning", text: "thinking" },
					{ type: "text", text: "" },
				],
			});
		});

		it("handles system messages unchanged across all providers", () => {
			const sysMsg = makeMsg({ role: "system", content: "You are helpful" });
			for (const provider of [
				"anthropic",
				"openai",
				"google",
				"openai-compatible",
				"ollama",
			] as const) {
				const result = buildHistory(provider, [sysMsg]);
				expect(result[0]).toEqual({ role: "system", content: "You are helpful" });
			}
		});
	});
});
