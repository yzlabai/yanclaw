import { tool } from "ai";
import { z } from "zod";
import { type NetworkConfig, validateNetworkAccess } from "../../security/network";
import { truncateOutput } from "./common";

export function createWebFetchTool(opts: { maxOutput: number; network?: NetworkConfig }) {
	return tool({
		description:
			"Fetch the content of a URL and return it as text. Useful for reading web pages, APIs, or downloading text content.",
		parameters: z.object({
			url: z.string().url().describe("The URL to fetch"),
			headers: z
				.record(z.string())
				.optional()
				.describe("Optional HTTP headers to send with the request"),
		}),
		execute: async ({ url, headers }) => {
			try {
				// Network access validation (SSRF prevention + host whitelist)
				if (opts.network) {
					const check = validateNetworkAccess(url, opts.network);
					if (!check.allowed) {
						return `Network access denied: ${check.reason}`;
					}
				}

				const res = await fetch(url, {
					headers: {
						"User-Agent": "YanClaw/0.1",
						...headers,
					},
					signal: AbortSignal.timeout(30_000),
				});

				if (!res.ok) {
					return `HTTP ${res.status} ${res.statusText}`;
				}

				const contentType = res.headers.get("content-type") ?? "";
				if (
					contentType.includes("text/") ||
					contentType.includes("json") ||
					contentType.includes("xml")
				) {
					const text = await res.text();
					return truncateOutput(text, opts.maxOutput);
				}

				return `Binary content (${contentType}, ${res.headers.get("content-length") ?? "unknown"} bytes)`;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}

export function createWebSearchTool(opts: { maxOutput: number }) {
	return tool({
		description:
			"Search the web using a search engine API. Returns a list of search results with titles, URLs, and snippets.",
		parameters: z.object({
			query: z.string().describe("The search query"),
			count: z.number().optional().default(5).describe("Number of results to return"),
		}),
		execute: async ({ query, count }) => {
			// Use a simple scraping approach via DuckDuckGo HTML
			try {
				const encoded = encodeURIComponent(query);
				const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
					},
					signal: AbortSignal.timeout(15_000),
				});

				if (!res.ok) {
					return `Search failed: HTTP ${res.status}`;
				}

				const html = await res.text();

				// Parse results from DuckDuckGo HTML response
				const results: Array<{ title: string; url: string; snippet: string }> = [];
				const resultRegex =
					/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

				let match = resultRegex.exec(html);
				while (match && results.length < count) {
					const rawUrl = match[1];
					const title = match[2].replace(/<[^>]+>/g, "").trim();
					const snippet = match[3].replace(/<[^>]+>/g, "").trim();

					// DuckDuckGo wraps URLs in a redirect
					let url = rawUrl;
					const uddgMatch = rawUrl.match(/[?&]uddg=([^&]+)/);
					if (uddgMatch) {
						url = decodeURIComponent(uddgMatch[1]);
					}

					if (title && url) {
						results.push({ title, url, snippet });
					}
					match = resultRegex.exec(html);
				}

				if (results.length === 0) {
					return "No results found.";
				}

				const output = results
					.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
					.join("\n\n");

				return truncateOutput(output, opts.maxOutput);
			} catch (err) {
				return `Search error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}
