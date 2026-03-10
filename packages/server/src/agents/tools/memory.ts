import { tool } from "ai";
import { z } from "zod";
import type { Config } from "../../config/schema";
import type { MemoryStore } from "../../db/memories";
import { generateEmbedding } from "../../memory/embeddings";

export function createMemoryStoreTool(opts: {
	memoryStore: MemoryStore;
	agentId: string;
	config: Config;
	sessionKey?: string;
}) {
	return tool({
		description:
			"Store a fact, preference, or important information in long-term memory. Use this to remember things across conversations. Be specific and concise.",
		parameters: z.object({
			content: z.string().describe("The fact or information to remember. Be specific and concise."),
			tags: z
				.array(z.string())
				.optional()
				.describe("Tags to categorize this memory (e.g. ['preference', 'user-info'])"),
		}),
		execute: async ({ content, tags }) => {
			let embedding: Float32Array | undefined;
			if (opts.config.memory.enabled) {
				try {
					embedding = await generateEmbedding(content, opts.config);
				} catch {
					// Embedding generation failed, store without embedding
				}
			}

			const id = await opts.memoryStore.store({
				agentId: opts.agentId,
				content,
				tags,
				source: "tool",
				sessionKey: opts.sessionKey,
				embedding,
			});

			return `Memory stored (id: ${id})`;
		},
	});
}

export function createMemorySearchTool(opts: {
	memoryStore: MemoryStore;
	agentId: string;
	config: Config;
}) {
	return tool({
		description:
			"Search long-term memory for relevant facts and information from previous conversations. Use this when you need to recall something.",
		parameters: z.object({
			query: z.string().describe("Search query — keywords or a natural language question"),
			limit: z.number().optional().default(5).describe("Maximum number of results to return"),
		}),
		execute: async ({ query, limit }) => {
			let queryEmbedding: Float32Array | undefined;
			if (opts.config.memory.enabled) {
				try {
					queryEmbedding = await generateEmbedding(query, opts.config);
				} catch {
					// Fall back to FTS-only search
				}
			}

			const results = await opts.memoryStore.search(opts.agentId, query, queryEmbedding, limit);

			if (results.length === 0) {
				return "No relevant memories found.";
			}

			return results
				.map(
					(r, i) =>
						`[${i + 1}] (score: ${r.score.toFixed(2)}) ${r.content}${
							r.tags.length > 0 ? ` [${r.tags.join(", ")}]` : ""
						}`,
				)
				.join("\n");
		},
	});
}

export function createMemoryDeleteTool(opts: { memoryStore: MemoryStore }) {
	return tool({
		description: "Delete a specific memory entry by ID.",
		parameters: z.object({
			id: z.string().describe("The memory ID to delete"),
		}),
		execute: async ({ id }) => {
			const deleted = await opts.memoryStore.delete(id);
			return deleted ? `Memory ${id} deleted.` : `Memory ${id} not found.`;
		},
	});
}
