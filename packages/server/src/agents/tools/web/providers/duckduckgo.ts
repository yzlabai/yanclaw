import type { SearchProvider, SearchResult } from "./types";

/** DuckDuckGo HTML scraper — no API key required (fallback provider). */
export class DuckDuckGoProvider implements SearchProvider {
	name = "duckduckgo";

	isAvailable(): boolean {
		return true; // Always available, no API key needed
	}

	async search(query: string, limit: number): Promise<SearchResult[]> {
		const encoded = encodeURIComponent(query);
		const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
			headers: {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			},
			signal: AbortSignal.timeout(15_000),
		});

		if (!res.ok) {
			throw new Error(`DuckDuckGo HTTP ${res.status}`);
		}

		const html = await res.text();
		const results: SearchResult[] = [];
		const resultRegex =
			/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

		let match = resultRegex.exec(html);
		while (match && results.length < limit) {
			const rawUrl = match[1];
			const title = match[2].replace(/<[^>]+>/g, "").trim();
			const snippet = match[3].replace(/<[^>]+>/g, "").trim();

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

		return results;
	}
}
