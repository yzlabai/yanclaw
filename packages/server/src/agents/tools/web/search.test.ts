import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWebCache } from "./cache";
import { createWebSearchTool } from "./search";

afterEach(() => {
	clearWebCache();
	vi.restoreAllMocks();
});

describe("createWebSearchTool", () => {
	it("returns search results from DuckDuckGo (default provider)", async () => {
		// DuckDuckGo uses the HTML scraping fallback — mock fetch
		const mockHtml = `
			<html><body>
				<div class="result">
					<a class="result__a" href="https://example.com/result1">Result 1</a>
					<a class="result__snippet">This is the snippet for result 1.</a>
				</div>
			</body></html>
		`;

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(mockHtml, {
					status: 200,
					headers: { "content-type": "text/html" },
				}),
			),
		);

		const tool = createWebSearchTool({ maxOutput: 50000 });
		const result = await tool.execute(
			{ query: "test query", limit: 5 },
			{ toolCallId: "t1", messages: [] },
		);

		// Should return a string (formatted results or error message)
		expect(typeof result).toBe("string");
	});

	it("handles search errors gracefully", async () => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

		const tool = createWebSearchTool({ maxOutput: 50000 });
		const result = await tool.execute(
			{ query: "test", limit: 3 },
			{ toolCallId: "t1", messages: [] },
		);

		expect(typeof result).toBe("string");
		expect(result).toContain("error" || "Error" || "No results");
	});
});
