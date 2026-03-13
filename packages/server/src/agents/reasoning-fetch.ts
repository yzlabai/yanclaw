/**
 * Fetch middleware for openai-compatible providers (e.g. DeepSeek) that
 * require `reasoning_content` on assistant messages in multi-turn
 * conversations when thinking mode is enabled.
 *
 * The AI SDK's @ai-sdk/openai adapter strips reasoning parts during message
 * conversion (`convertToOpenAIChatMessages` only handles "text" and
 * "tool-call" part types). This middleware intercepts the HTTP request body
 * and injects `reasoning_content` back into assistant messages.
 *
 * Concurrency note: this uses module-level state which is safe in Bun's
 * single-threaded model because `prepareReasoningContext` → `streamText` →
 * first fetch all execute synchronously without intervening awaits.
 * If moved to a multi-threaded runtime, replace with AsyncLocalStorage.
 */

/** Per-request reasoning context: ordered list of reasoning for assistant messages. */
let pendingReasoning: string[] = [];

/**
 * Call this BEFORE each streamText invocation to supply the reasoning
 * strings for assistant messages in the conversation history.
 * Pass one entry per assistant message in order; use "" for messages
 * without reasoning.
 */
export function prepareReasoningContext(reasonings: string[]): void {
	pendingReasoning = reasonings;
}

/**
 * Custom fetch function that injects `reasoning_content` into assistant
 * messages for openai-compatible APIs (DeepSeek).
 *
 * Pass this as the `fetch` option to `createOpenAI()`.
 */
export const reasoningFetch: typeof globalThis.fetch = async (
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> => {
	// Snapshot and keep (don't clear) — multi-step tool loops call fetch
	// multiple times for the same conversation, each time with the full
	// message history (+ new tool results appended by the SDK).
	const reasonings = pendingReasoning;

	if (reasonings.length === 0 || !init?.body || typeof init.body !== "string") {
		return globalThis.fetch(input, init);
	}

	try {
		const body = JSON.parse(init.body);
		if (Array.isArray(body.messages)) {
			let assistantIdx = 0;
			for (const msg of body.messages) {
				if (msg.role === "assistant") {
					// Inject stored reasoning for history messages, or empty string
					// so the field is always present (DeepSeek requires it).
					if (assistantIdx < reasonings.length && msg.reasoning_content === undefined) {
						msg.reasoning_content = reasonings[assistantIdx] || "";
					}
					assistantIdx++;
				}
			}
			return globalThis.fetch(input, {
				...init,
				body: JSON.stringify(body),
			});
		}
	} catch {
		// JSON parse failed — forward as-is
	}

	return globalThis.fetch(input, init);
};
