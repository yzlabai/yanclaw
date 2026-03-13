import type { SearchProvider, SearchResult } from "./types";

/** Tavily Search API — designed for AI agents. Structured, high-quality results. */
export class TavilyProvider implements SearchProvider {
	name = "tavily";
	private apiKey: string | undefined;

	constructor(apiKey?: string) {
		this.apiKey = apiKey || process.env.TAVILY_API_KEY;
	}

	isAvailable(): boolean {
		return !!this.apiKey;
	}

	async search(query: string, limit: number): Promise<SearchResult[]> {
		if (!this.apiKey) throw new Error("Tavily API key not configured");

		const res = await fetch("https://api.tavily.com/search", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				api_key: this.apiKey,
				query,
				max_results: Math.min(limit, 10),
				include_answer: false,
				search_depth: "basic",
			}),
			signal: AbortSignal.timeout(15_000),
		});

		if (!res.ok) {
			throw new Error(`Tavily API HTTP ${res.status}`);
		}

		const data = (await res.json()) as {
			results?: Array<{ title: string; url: string; content: string }>;
		};

		return (data.results ?? []).slice(0, limit).map((r) => ({
			title: r.title,
			url: r.url,
			snippet: r.content,
		}));
	}
}
