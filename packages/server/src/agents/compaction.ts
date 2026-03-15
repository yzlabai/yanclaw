/**
 * Context compaction engine: LLM-based summarization of old messages
 * to stay within context window limits while preserving key information.
 */
import { type CoreMessage, generateText, type LanguageModel } from "ai";
import type { Config } from "../config/schema";
import type { MemoryStore } from "../db/memories";
import { log } from "../logger";
import { generateEmbedding } from "../memory/embeddings";

export interface CompactionResult {
	/** The summary that replaces old messages. */
	summary: string;
	/** Number of messages that were compacted. */
	compactedCount: number;
	/** Number of facts flushed to memory. */
	flushedFacts: number;
}

/**
 * Estimate token count from message content.
 * Rough heuristic: ~4 chars per token for English, ~2 for CJK.
 */
export function estimateTokens(messages: CoreMessage[]): number {
	let total = 0;
	for (const msg of messages) {
		const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
		// Rough: count CJK chars as 1 token each, others as 0.25 tokens
		let tokens = 0;
		for (let i = 0; i < text.length; i++) {
			const code = text.charCodeAt(i);
			tokens += code > 0x2e80 ? 1 : 0.25;
		}
		total += Math.ceil(tokens);
	}
	return total;
}

/**
 * Check if compaction is needed based on estimated token usage vs context budget.
 */
export function needsCompaction(
	messages: CoreMessage[],
	contextBudget: number,
	triggerRatio: number,
): boolean {
	const estimated = estimateTokens(messages);
	return estimated > contextBudget * triggerRatio;
}

/**
 * Summarize old messages using an LLM, preserving key information.
 */
export async function compactMessages(params: {
	messages: CoreMessage[];
	model: LanguageModel;
	keepRecent: number;
	identifierPolicy: "strict" | "off";
}): Promise<{ summary: string; keptMessages: CoreMessage[]; compactedCount: number }> {
	const { messages, model, keepRecent, identifierPolicy } = params;

	// System prompt is messages[0], then history, then current user message
	// We want to keep: system prompt + last N messages + current user message
	if (messages.length <= keepRecent + 2) {
		// Not enough messages to compact
		return { summary: "", keptMessages: messages, compactedCount: 0 };
	}

	const systemMsg = messages[0]; // system prompt
	const currentUserMsg = messages[messages.length - 1]; // latest user message
	const historyMessages = messages.slice(1, -1); // everything between system and current

	if (historyMessages.length <= keepRecent) {
		return { summary: "", keptMessages: messages, compactedCount: 0 };
	}

	const toCompact = historyMessages.slice(0, -keepRecent);
	const toKeep = historyMessages.slice(-keepRecent);

	// Build the compaction prompt
	const compactionText = toCompact
		.map((m) => {
			const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
			return `[${m.role}]: ${content}`;
		})
		.join("\n\n");

	const identifierInstruction =
		identifierPolicy === "strict"
			? "\n- IMPORTANT: Preserve ALL identifiers exactly (UUIDs, hashes, file paths, URLs, variable names, function names, error codes). Do not paraphrase or abbreviate them."
			: "";

	const summaryPrompt = `Summarize the following conversation history into a concise but comprehensive summary. This summary will replace the original messages in the conversation context.

Requirements:
- Preserve all key decisions, conclusions, and action items
- Preserve all technical details (code snippets, configs, commands)
- Preserve the chronological flow of important events
- Be concise: aim for ~20% of original length${identifierInstruction}
- Write in the same language as the original conversation
- Format as a narrative summary, not a list

Conversation to summarize:
${compactionText}`;

	try {
		const result = await generateText({
			model,
			messages: [{ role: "user", content: summaryPrompt }],
			maxTokens: 2000,
		});

		const summary = result.text.trim();
		if (!summary) {
			return { summary: "", keptMessages: messages, compactedCount: 0 };
		}

		// Reconstruct message array with summary replacing old messages
		const keptMessages: CoreMessage[] = [
			systemMsg,
			{
				role: "assistant",
				content: `[Previous conversation summary]\n${summary}`,
			},
			...toKeep,
			currentUserMsg,
		];

		return { summary, keptMessages, compactedCount: toCompact.length };
	} catch (err) {
		log.agent().error({ err }, "summarization failed");
		return { summary: "", keptMessages: messages, compactedCount: 0 };
	}
}

/**
 * Flush key facts from messages to the memory store before compaction.
 * Uses an LLM to extract important factual statements.
 */
export async function flushToMemory(params: {
	messages: CoreMessage[];
	model: LanguageModel;
	memoryStore: MemoryStore;
	agentId: string;
	sessionKey: string;
	config: Config;
}): Promise<number> {
	const { messages, model, memoryStore, agentId, sessionKey, config } = params;

	// Only flush if there's enough content
	const text = messages
		.filter((m) => m.role !== "system")
		.map((m) => (typeof m.content === "string" ? m.content : ""))
		.join("\n");

	if (text.length < 200) return 0;

	try {
		const result = await generateText({
			model,
			messages: [
				{
					role: "user",
					content: `Extract the most important facts, decisions, and conclusions from this conversation as a list. Each fact should be a standalone statement that would be useful to recall in future conversations. Output one fact per line, no numbering or bullets. If there are no important facts, output "NONE".

Conversation:
${text.slice(0, 8000)}`,
				},
			],
			maxTokens: 500,
		});

		const facts = result.text
			.trim()
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l && l !== "NONE" && l.length > 10);

		let stored = 0;
		for (const fact of facts.slice(0, 10)) {
			try {
				let embedding: Float32Array | undefined;
				try {
					embedding = await generateEmbedding(fact, config);
				} catch {
					// FTS-only fallback
				}
				await memoryStore.store({
					agentId,
					content: fact,
					tags: ["auto-flush", `session:${sessionKey}`],
					source: "auto",
					sessionKey,
					embedding,
				});
				stored++;
			} catch {
				// Continue with other facts
			}
		}

		if (stored > 0) {
			log.agent().info({ sessionKey, stored }, "flushed facts to memory");
		}
		return stored;
	} catch (err) {
		log.agent().warn({ err }, "memory flush failed");
		return 0;
	}
}
