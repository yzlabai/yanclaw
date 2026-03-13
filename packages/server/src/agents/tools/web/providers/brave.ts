import type { SearchProvider, SearchResult } from "./types";

/** Brave Search API — requires BRAVE_API_KEY. High quality, generous free tier. */
export class BraveProvider implements SearchProvider {
	name = "brave";
	private apiKey: string | undefined;

	constructor(apiKey?: string) {
		this.apiKey = apiKey || process.env.BRAVE_API_KEY;
	}

	isAvailable(): boolean {
		return !!this.apiKey;
	}

	async search(query: string, limit: number): Promise<SearchResult[]> {
		if (!this.apiKey) throw new Error("Brave API key not configured");

		const params = new URLSearchParams({
			q: query,
			count: String(Math.min(limit, 20)),
		});

		const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
			headers: {
				Accept: "application/json",
				"Accept-Encoding": "gzip",
				"X-Subscription-Token": this.apiKey,
			},
			signal: AbortSignal.timeout(15_000),
		});

		if (!res.ok) {
			throw new Error(`Brave API HTTP ${res.status}`);
		}

		const data = (await res.json()) as {
			web?: { results?: Array<{ title: string; url: string; description: string }> };
		};

		return (data.web?.results ?? []).slice(0, limit).map((r) => ({
			title: r.title,
			url: r.url,
			snippet: r.description,
		}));
	}
}
