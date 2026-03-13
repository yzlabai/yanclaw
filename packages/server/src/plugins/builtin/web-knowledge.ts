/**
 * Built-in web-knowledge plugin — auto-stores web_fetch results into the knowledge base.
 *
 * Features:
 * - Intercepts web_fetch tool results via afterToolCall hook
 * - Extracts title + URL from the Markdown output
 * - URL deduplication (won't store same URL twice)
 * - Chunks long content (max 4000 chars per memory entry)
 * - Auto-tags: ["web", "auto-stored", domain]
 */
import type { GatewayContext } from "../../gateway";
import { generateEmbedding } from "../../memory/embeddings";
import type { PluginDefinition } from "../types";

let gatewayCtx: GatewayContext | null = null;

/** Extract domain from URL for tagging. */
function extractDomain(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "unknown";
	}
}

/** Extract URL from the web_fetch Markdown output. */
function extractUrl(content: string): string | null {
	const match = content.match(/^URL:\s*(.+)$/m);
	return match?.[1]?.trim() ?? null;
}

/** Extract title from the Markdown output (first # heading). */
function extractTitle(content: string): string | null {
	const match = content.match(/^#\s+(.+)$/m);
	return match?.[1]?.trim() ?? null;
}

/** Split content into chunks at paragraph boundaries. */
function chunkContent(content: string, maxChars = 4000): string[] {
	if (content.length <= maxChars) return [content];

	const chunks: string[] = [];
	const paragraphs = content.split(/\n\n+/);
	let current = "";

	for (const para of paragraphs) {
		if (current.length + para.length + 2 > maxChars && current.length > 0) {
			chunks.push(current.trim());
			current = para;
		} else {
			current += (current ? "\n\n" : "") + para;
		}
	}
	if (current.trim()) chunks.push(current.trim());

	return chunks;
}

export const webKnowledgePlugin: PluginDefinition = {
	id: "web-knowledge",
	name: "Web Knowledge Auto-Store",
	version: "1.0.0",
	hooks: {
		onGatewayStart: (ctx) => {
			gatewayCtx = ctx;
		},
		onGatewayStop: () => {
			gatewayCtx = null;
		},
		afterToolCall: async (call, result) => {
			// Only intercept web_fetch calls
			if (call.name !== "web_fetch") return;
			if (!gatewayCtx) return;

			const config = gatewayCtx.config.get();
			if (!config.memory.enabled) return;

			const content = typeof result === "string" ? result : String(result);

			// Skip error/short results
			if (content.length < 100) return;
			if (
				content.startsWith("HTTP ") ||
				content.startsWith("Error:") ||
				content.startsWith("Network access denied")
			)
				return;

			const url = extractUrl(content);
			if (!url) return; // Not a structured readability result

			const title = extractTitle(content) ?? url;
			const domain = extractDomain(url);

			// URL deduplication — check if we already have this URL stored
			try {
				const existing = await gatewayCtx.memories.searchFts("main", url, 1);
				if (existing.length > 0 && existing[0].content.includes(url)) {
					return; // Already stored
				}
			} catch {
				// FTS query failed, proceed with storing
			}

			// Chunk long content and store each chunk
			const chunks = chunkContent(content);
			const tags = ["web", "auto-stored", domain];

			for (let i = 0; i < chunks.length; i++) {
				const chunkLabel = chunks.length > 1 ? ` [${i + 1}/${chunks.length}]` : "";
				const memoryContent = `${title}${chunkLabel}\n${url}\n\n${chunks[i]}`;

				let embedding: Float32Array | undefined;
				try {
					embedding = await generateEmbedding(memoryContent.slice(0, 8000), config);
				} catch {
					// Store without embedding
				}

				await gatewayCtx.memories.store({
					agentId: "main",
					content: memoryContent,
					tags,
					source: "auto",
					scope: "shared",
					embedding,
				});
			}
		},
	},
};
