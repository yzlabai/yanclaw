import { tool } from "ai";
import { z } from "zod";
import { truncateOutput } from "../common";
import { webCache } from "./cache";
import { BraveProvider } from "./providers/brave";
import { DuckDuckGoProvider } from "./providers/duckduckgo";
import { TavilyProvider } from "./providers/tavily";
import type { SearchProvider } from "./providers/types";

export type { SearchProvider } from "./providers/types";

// ---------------------------------------------------------------------------
// Provider registry — instantiate and order by config
// ---------------------------------------------------------------------------

export interface SearchConfig {
	/** Ordered list of provider names to try. Default: ["tavily", "brave", "duckduckgo"] */
	providers?: string[];
	tavily?: { apiKey?: string };
	brave?: { apiKey?: string };
}

function buildProviders(config?: SearchConfig): SearchProvider[] {
	const order = config?.providers ?? ["tavily", "brave", "duckduckgo"];

	const registry: Record<string, () => SearchProvider> = {
		tavily: () => new TavilyProvider(config?.tavily?.apiKey),
		brave: () => new BraveProvider(config?.brave?.apiKey),
		duckduckgo: () => new DuckDuckGoProvider(),
	};

	return order.filter((name) => name in registry).map((name) => registry[name]());
}

// ---------------------------------------------------------------------------
// web_search tool with multi-provider fallback
// ---------------------------------------------------------------------------

export interface WebSearchOpts {
	maxOutput: number;
	/** Cache TTL in minutes (0 = disabled, default: 15) */
	cacheTtlMinutes?: number;
	/** Search provider configuration */
	search?: SearchConfig;
}

export function createWebSearchTool(opts: WebSearchOpts) {
	const cacheTtlMs = (opts.cacheTtlMinutes ?? 15) * 60_000;
	const cacheEnabled = cacheTtlMs > 0;
	const providers = buildProviders(opts.search);

	return tool({
		description:
			"Search the web using a search engine. Returns a list of search results with titles, URLs, and snippets. Automatically falls back to alternative search engines if the primary one fails.",
		parameters: z.object({
			query: z.string().describe("The search query"),
			count: z.number().optional().default(5).describe("Number of results to return"),
		}),
		execute: async ({ query, count }) => {
			try {
				// Check cache
				const cacheKey = `search:${query}:${count}`;
				if (cacheEnabled) {
					const cached = webCache.get(cacheKey);
					if (cached) return cached;
				}

				// Try providers in order, fallback on failure
				const errors: string[] = [];
				for (const provider of providers) {
					if (!provider.isAvailable()) continue;
					try {
						const results = await provider.search(query, count);
						if (results.length === 0) continue;

						const output = results
							.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
							.join("\n\n");

						const result = truncateOutput(output, opts.maxOutput);
						if (cacheEnabled) webCache.set(cacheKey, result, cacheTtlMs);
						return result;
					} catch (err) {
						errors.push(`${provider.name}: ${err instanceof Error ? err.message : String(err)}`);
					}
				}

				if (errors.length > 0) {
					return `All search providers failed:\n${errors.join("\n")}`;
				}
				return "No search providers available. Configure API keys for Tavily or Brave Search.";
			} catch (err) {
				return `Search error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}
