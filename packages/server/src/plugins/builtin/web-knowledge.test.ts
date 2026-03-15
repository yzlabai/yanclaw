import { describe, expect, it, vi } from "vitest";
import { webKnowledgePlugin } from "./web-knowledge";

describe("webKnowledgePlugin", () => {
	const hooks = webKnowledgePlugin.hooks as NonNullable<typeof webKnowledgePlugin.hooks>;
	const afterToolCall = hooks.afterToolCall as NonNullable<typeof hooks.afterToolCall>;

	it("has correct metadata", () => {
		expect(webKnowledgePlugin.id).toBe("web-knowledge");
		expect(webKnowledgePlugin.version).toBe("1.0.0");
		expect(webKnowledgePlugin.hooks?.afterToolCall).toBeDefined();
		expect(webKnowledgePlugin.hooks?.onGatewayStart).toBeDefined();
		expect(webKnowledgePlugin.hooks?.onGatewayStop).toBeDefined();
	});

	it("ignores non-web_fetch tool calls", async () => {
		// Should not throw for unrelated tool calls
		await afterToolCall({ name: "shell", input: {} }, "some output");
		await afterToolCall({ name: "file_read", input: {} }, "file content");
	});

	it("ignores short or error results", async () => {
		// Short content
		await afterToolCall({ name: "web_fetch", input: { url: "https://x.com" } }, "short");

		// HTTP errors
		await afterToolCall({ name: "web_fetch", input: {} }, "HTTP 404 Not Found");
		await afterToolCall({ name: "web_fetch", input: {} }, "Error: timeout");
		await afterToolCall({ name: "web_fetch", input: {} }, "Network access denied: blocked");
	});

	it("ignores results without URL (non-readability output)", async () => {
		const longText = "a".repeat(200); // Long enough but no URL

		await afterToolCall({ name: "web_fetch", input: {} }, longText);
	});

	it("stores web_fetch results when gateway is initialized", async () => {
		const storeMock = vi.fn().mockResolvedValue("mem-1");
		const searchFtsMock = vi.fn().mockResolvedValue([]);

		const mockCtx = {
			config: { get: () => ({ memory: { enabled: true } }) },
			memories: {
				store: storeMock,
				searchFts: searchFtsMock,
			},
		};

		// Initialize gateway context
		webKnowledgePlugin.hooks?.onGatewayStart?.(mockCtx as never);

		const content = [
			"# Test Article Title",
			"",
			"URL: https://example.com/article",
			"",
			"---",
			"",
			"This is the article content that is long enough to pass the minimum length check.",
			"It contains multiple paragraphs of useful information.",
		].join("\n");

		await webKnowledgePlugin.hooks?.afterToolCall?.(
			{ name: "web_fetch", input: { url: "https://example.com/article" } },
			content,
		);

		expect(searchFtsMock).toHaveBeenCalledWith("main", "https://example.com/article", 1);
		expect(storeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				agentId: "main",
				source: "auto",
				scope: "shared",
				tags: expect.arrayContaining(["web", "auto-stored", "example.com"]),
			}),
		);

		// Cleanup
		webKnowledgePlugin.hooks?.onGatewayStop?.();
	});

	it("skips duplicate URLs", async () => {
		const storeMock = vi.fn();
		const searchFtsMock = vi
			.fn()
			.mockResolvedValue([{ content: "URL: https://example.com/article\nExisting content" }]);

		const mockCtx = {
			config: { get: () => ({ memory: { enabled: true } }) },
			memories: { store: storeMock, searchFts: searchFtsMock },
		};

		webKnowledgePlugin.hooks?.onGatewayStart?.(mockCtx as never);

		const content =
			"# Dup Article\n\nURL: https://example.com/article\n\n---\n\nContent here that passes length.";

		await webKnowledgePlugin.hooks?.afterToolCall?.({ name: "web_fetch", input: {} }, content);

		expect(storeMock).not.toHaveBeenCalled();

		webKnowledgePlugin.hooks?.onGatewayStop?.();
	});
});
