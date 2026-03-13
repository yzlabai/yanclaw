import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareReasoningContext, reasoningFetch } from "./reasoning-fetch";

// Mock globalThis.fetch
const mockFetch = vi.fn<typeof globalThis.fetch>();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
	mockFetch.mockReset();
	prepareReasoningContext([]);
});

function makeInit(messages: unknown[]): RequestInit {
	return {
		method: "POST",
		body: JSON.stringify({ model: "deepseek-reasoner", messages }),
	};
}

describe("reasoningFetch", () => {
	describe("injection", () => {
		it("injects reasoning_content into assistant messages", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["I thought about it", "Second thought"]);

			const messages = [
				{ role: "system", content: "You are helpful" },
				{ role: "user", content: "Q1" },
				{ role: "assistant", content: "A1" },
				{ role: "user", content: "Q2" },
				{ role: "assistant", content: "A2" },
				{ role: "user", content: "Q3" },
			];

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", makeInit(messages));

			expect(mockFetch).toHaveBeenCalledOnce();
			const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
			// System message unchanged
			expect(calledBody.messages[0].reasoning_content).toBeUndefined();
			// User messages unchanged
			expect(calledBody.messages[1].reasoning_content).toBeUndefined();
			// First assistant: gets first reasoning
			expect(calledBody.messages[2].reasoning_content).toBe("I thought about it");
			// Second assistant: gets second reasoning
			expect(calledBody.messages[4].reasoning_content).toBe("Second thought");
		});

		it("injects empty string when reasoning is empty", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["", "has reasoning"]);

			const messages = [
				{ role: "user", content: "Q1" },
				{ role: "assistant", content: "A1" },
				{ role: "user", content: "Q2" },
				{ role: "assistant", content: "A2" },
			];

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", makeInit(messages));

			const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
			expect(calledBody.messages[1].reasoning_content).toBe("");
			expect(calledBody.messages[3].reasoning_content).toBe("has reasoning");
		});

		it("does not overwrite existing reasoning_content", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["stored"]);

			const messages = [
				{ role: "user", content: "Q1" },
				{ role: "assistant", content: "A1", reasoning_content: "from-model" },
			];

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", makeInit(messages));

			const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
			// Existing reasoning_content preserved
			expect(calledBody.messages[1].reasoning_content).toBe("from-model");
		});
	});

	describe("passthrough", () => {
		it("passes through when no reasoning context prepared", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			const messages = [
				{ role: "user", content: "Q1" },
				{ role: "assistant", content: "A1" },
			];

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", makeInit(messages));

			// Called with original args unchanged
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.deepseek.com/v1/chat/completions",
				expect.objectContaining({ method: "POST" }),
			);
			const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
			expect(calledBody.messages[1].reasoning_content).toBeUndefined();
		});

		it("passes through when body is not a string", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["some reasoning"]);

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", {
				method: "POST",
				body: undefined,
			});

			expect(mockFetch).toHaveBeenCalledOnce();
		});

		it("passes through when body has no messages array", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["some reasoning"]);

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", {
				method: "POST",
				body: JSON.stringify({ model: "deepseek-chat", prompt: "Hello" }),
			});

			expect(mockFetch).toHaveBeenCalledOnce();
			const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
			expect(calledBody.messages).toBeUndefined();
		});

		it("passes through on malformed JSON body", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["some reasoning"]);

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", {
				method: "POST",
				body: "not json{",
			});

			// Should still call fetch without crashing
			expect(mockFetch).toHaveBeenCalledOnce();
		});
	});

	describe("multi-step tool loop", () => {
		it("retains reasoning context across multiple fetch calls", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["thought-1"]);

			const messages1 = [
				{ role: "user", content: "Q1" },
				{ role: "assistant", content: "A1" },
			];

			// First call (initial request)
			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", makeInit(messages1));

			// Second call (tool loop continuation, same reasoning context)
			const messages2 = [
				...messages1,
				{ role: "user", content: "tool result" },
				{ role: "assistant", content: "A2" },
			];
			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", makeInit(messages2));

			// Both calls should have injected reasoning
			const body1 = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
			expect(body1.messages[1].reasoning_content).toBe("thought-1");

			const body2 = JSON.parse(mockFetch.mock.calls[1][1]?.body as string);
			expect(body2.messages[1].reasoning_content).toBe("thought-1");
			// New assistant message from tool loop: beyond stored context, no injection
		});
	});

	describe("preserves other body fields", () => {
		it("keeps model, temperature, and other fields intact", async () => {
			mockFetch.mockResolvedValue(new Response("ok"));

			prepareReasoningContext(["thought"]);

			const body = {
				model: "deepseek-reasoner",
				temperature: 0.7,
				max_tokens: 1000,
				messages: [
					{ role: "user", content: "Q1" },
					{ role: "assistant", content: "A1" },
				],
			};

			await reasoningFetch("https://api.deepseek.com/v1/chat/completions", {
				method: "POST",
				body: JSON.stringify(body),
			});

			const calledBody = JSON.parse(mockFetch.mock.calls[0][1]?.body as string);
			expect(calledBody.model).toBe("deepseek-reasoner");
			expect(calledBody.temperature).toBe(0.7);
			expect(calledBody.max_tokens).toBe(1000);
		});
	});
});
