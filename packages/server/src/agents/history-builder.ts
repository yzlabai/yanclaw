import type { CoreMessage } from "ai";
import type { ProviderType } from "../config/schema";
import type { MessageRow } from "../db/sessions";

/**
 * Build CoreMessage history from stored messages, applying provider-specific
 * reasoning/thinking content handling.
 *
 * Each provider has different requirements for how reasoning content appears
 * in multi-turn conversation history:
 * - anthropic: reasoning parts with signature (verified by API)
 * - google: reasoning parts (thought flag added by AI SDK adapter)
 * - openai: reasoning stripped (o-series doesn't use it in history)
 * - openai-compatible: reasoning parts kept for fetch middleware injection
 * - ollama: reasoning stripped (safe default)
 */
export function buildHistory(
	providerType: ProviderType,
	storedMessages: MessageRow[],
): CoreMessage[] {
	const strategy = PROVIDER_STRATEGIES[providerType] ?? defaultStrategy;
	return storedMessages.map(strategy);
}

type MessageStrategy = (m: MessageRow) => CoreMessage;

/** Default: include reasoning as content parts if present. */
function defaultStrategy(m: MessageRow): CoreMessage {
	if (m.role === "assistant" && m.reasoning) {
		return {
			role: "assistant" as const,
			content: [
				{ type: "reasoning" as const, text: m.reasoning },
				{ type: "text" as const, text: m.content ?? "" },
			],
		};
	}
	return {
		role: m.role as "user" | "assistant" | "system",
		content: m.content ?? "",
	};
}

function plainStrategy(m: MessageRow): CoreMessage {
	return {
		role: m.role as "user" | "assistant" | "system",
		content: m.content ?? "",
	};
}

/** Anthropic: reasoning parts with cryptographic signature for verification. */
function anthropicStrategy(m: MessageRow): CoreMessage {
	if (m.role === "assistant" && m.reasoning) {
		const reasoningPart: Record<string, unknown> = {
			type: "reasoning" as const,
			text: m.reasoning,
		};
		if (m.reasoningSignature) {
			reasoningPart.signature = m.reasoningSignature;
		}
		return {
			role: "assistant" as const,
			content: [
				reasoningPart as { type: "reasoning"; text: string },
				{ type: "text" as const, text: m.content ?? "" },
			],
		};
	}
	return {
		role: m.role as "user" | "assistant" | "system",
		content: m.content ?? "",
	};
}

const PROVIDER_STRATEGIES: Record<ProviderType, MessageStrategy> = {
	anthropic: anthropicStrategy,
	openai: plainStrategy,
	google: defaultStrategy, // AI SDK adapter converts reasoning to thought flag
	"openai-compatible": defaultStrategy, // fetch middleware handles reasoning_content injection
	ollama: plainStrategy,
};
