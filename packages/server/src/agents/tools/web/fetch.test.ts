import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWebCache } from "./cache";
import { createWebFetchTool } from "./fetch";

afterEach(() => {
	clearWebCache();
	vi.restoreAllMocks();
});

describe("createWebFetchTool", () => {
	it("extracts readable content from HTML", async () => {
		const html = `
			<html><head><title>Test Article</title></head>
			<body>
				<article>
					<h1>Test Article</h1>
					<p>This is the main content of the article. It has enough text to be recognized by readability.
					The article discusses important topics that are relevant to the reader.
					Multiple paragraphs help readability identify this as the main content.</p>
					<p>Second paragraph with additional details about the article content.
					This ensures the readability algorithm has enough to work with.</p>
				</article>
			</body></html>
		`;

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(html, {
					status: 200,
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
			),
		);

		const tool = createWebFetchTool({ maxOutput: 50000 });
		const result = await tool.execute(
			{ url: "https://example.com/article" },
			{ toolCallId: "t1", messages: [] },
		);

		expect(result).toContain("Test Article");
		expect(result).toContain("URL: https://example.com/article");
	});

	it("returns raw text for JSON content", async () => {
		const json = JSON.stringify({ key: "value", nested: { a: 1 } });

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(json, {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			),
		);

		const tool = createWebFetchTool({ maxOutput: 50000 });
		const result = await tool.execute(
			{ url: "https://api.example.com/data" },
			{ toolCallId: "t1", messages: [] },
		);

		expect(result).toContain('"key"');
		expect(result).toContain('"value"');
	});

	it("returns error for non-ok responses", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(new Response("Not Found", { status: 404, statusText: "Not Found" })),
		);

		const tool = createWebFetchTool({ maxOutput: 50000 });
		const result = await tool.execute(
			{ url: "https://example.com/missing" },
			{ toolCallId: "t1", messages: [] },
		);

		expect(result).toBe("HTTP 404 Not Found");
	});

	it("returns binary content info for non-text types", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(new Uint8Array([1, 2, 3]), {
					status: 200,
					headers: { "content-type": "image/png", "content-length": "3" },
				}),
			),
		);

		const tool = createWebFetchTool({ maxOutput: 50000 });
		const result = await tool.execute(
			{ url: "https://example.com/image.png" },
			{ toolCallId: "t1", messages: [] },
		);

		expect(result).toContain("Binary content");
		expect(result).toContain("image/png");
	});

	it("uses cache on repeated requests", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response("cached text", {
				status: 200,
				headers: { "content-type": "text/plain" },
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		const tool = createWebFetchTool({ maxOutput: 50000, cacheTtlMinutes: 15 });

		const result1 = await tool.execute(
			{ url: "https://example.com/cache-test" },
			{ toolCallId: "t1", messages: [] },
		);
		const result2 = await tool.execute(
			{ url: "https://example.com/cache-test" },
			{ toolCallId: "t2", messages: [] },
		);

		expect(result1).toBe(result2);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("skips readability when raw=true", async () => {
		const html = `
			<html><head><title>Raw Test</title></head>
			<body><article><h1>Article</h1><p>Content here that is long enough.</p></article></body></html>
		`;
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(html, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			),
		);

		const tool = createWebFetchTool({ maxOutput: 50000 });
		const result = await tool.execute(
			{ url: "https://example.com/raw", raw: true },
			{ toolCallId: "t1", messages: [] },
		);

		// Raw HTML should be returned as-is
		expect(result).toContain("<html>");
	});

	it("respects network access denial", async () => {
		const tool = createWebFetchTool({
			maxOutput: 50000,
			network: {
				allowedHosts: ["allowed.com"],
			},
		});

		const result = await tool.execute(
			{ url: "https://denied.com/page" },
			{ toolCallId: "t1", messages: [] },
		);

		expect(result).toContain("Network access denied");
	});
});
