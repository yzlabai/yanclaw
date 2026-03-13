/** Unified search result shape across all providers. */
export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

/** Search provider interface — each engine implements this. */
export interface SearchProvider {
	name: string;
	/** Check if this provider has the required configuration (API keys etc). */
	isAvailable(): boolean;
	/** Execute a search query. Throws on failure. */
	search(query: string, limit: number): Promise<SearchResult[]>;
}
