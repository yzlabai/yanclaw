import { Readability } from "@mozilla/readability";
import { tool } from "ai";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { z } from "zod";
import { type NetworkConfig, validateNetworkAccess } from "../../../security/network";
import { truncateOutput } from "../common";
import { webCache } from "./cache";

// ---------------------------------------------------------------------------
// Readability — HTML → structured Markdown extraction
// ---------------------------------------------------------------------------

const turndown = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
	bulletListMarker: "-",
});

interface ReadabilityResult {
	title: string;
	content: string;
	excerpt: string;
	byline: string;
	siteName: string;
}

function extractReadableContent(html: string, url: string): ReadabilityResult | null {
	try {
		const { document } = parseHTML(html);
		Object.defineProperty(document, "baseURI", { value: url, writable: false });
		const reader = new Readability(document as unknown as Document);
		const article = reader.parse();
		if (!article || !article.content) return null;

		const markdown = turndown.turndown(article.content);
		return {
			title: article.title ?? "",
			content: markdown,
			excerpt: article.excerpt ?? "",
			byline: article.byline ?? "",
			siteName: article.siteName ?? "",
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// web_fetch tool
// ---------------------------------------------------------------------------

export interface WebFetchOpts {
	maxOutput: number;
	network?: NetworkConfig;
	/** Enable readability extraction for HTML pages (default: true) */
	readability?: boolean;
	/** Cache TTL in minutes (0 = disabled, default: 15) */
	cacheTtlMinutes?: number;
}

export function createWebFetchTool(opts: WebFetchOpts) {
	const readabilityEnabled = opts.readability !== false;
	const cacheTtlMs = (opts.cacheTtlMinutes ?? 15) * 60_000;
	const cacheEnabled = cacheTtlMs > 0;

	return tool({
		description:
			"Fetch the content of a URL and return it as text. For HTML pages, automatically extracts the main article content as clean Markdown. Useful for reading web pages, APIs, or downloading text content.",
		parameters: z.object({
			url: z.string().url().describe("The URL to fetch"),
			headers: z
				.record(z.string())
				.optional()
				.describe("Optional HTTP headers to send with the request"),
			raw: z
				.boolean()
				.optional()
				.describe("If true, skip readability extraction and return raw content"),
		}),
		execute: async ({ url, headers, raw }) => {
			try {
				// Check cache first
				const cacheKey = `fetch:${url}`;
				if (cacheEnabled) {
					const cached = webCache.get(cacheKey);
					if (cached) return cached;
				}

				// Network access validation (SSRF prevention + host whitelist)
				if (opts.network) {
					const check = validateNetworkAccess(url, opts.network);
					if (!check.allowed) {
						return `Network access denied: ${check.reason}`;
					}
				}

				const res = await fetch(url, {
					headers: {
						"User-Agent":
							"Mozilla/5.0 (compatible; YanClaw/1.0; +https://github.com/nicepkg/yanclaw)",
						Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

					// Try readability extraction for HTML content
					if (
						readabilityEnabled &&
						!raw &&
						(contentType.includes("text/html") || contentType.includes("xhtml"))
					) {
						const article = extractReadableContent(text, url);
						if (article) {
							const parts: string[] = [];
							if (article.title) parts.push(`# ${article.title}`);
							if (article.byline) parts.push(`*${article.byline}*`);
							if (article.siteName) parts.push(`Source: ${article.siteName}`);
							parts.push(`URL: ${url}`);
							parts.push("---");
							parts.push(article.content);
							if (article.excerpt && article.excerpt !== article.content.slice(0, 200)) {
								parts.push(`\n---\n**Summary:** ${article.excerpt}`);
							}
							const result = truncateOutput(parts.join("\n\n"), opts.maxOutput);
							if (cacheEnabled) webCache.set(cacheKey, result, cacheTtlMs);
							return result;
						}
						// Readability failed — fall through to raw text
					}

					const result = truncateOutput(text, opts.maxOutput);
					if (cacheEnabled) webCache.set(cacheKey, result, cacheTtlMs);
					return result;
				}

				return `Binary content (${contentType}, ${res.headers.get("content-length") ?? "unknown"} bytes)`;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}
