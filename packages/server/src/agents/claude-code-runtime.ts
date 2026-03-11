import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "./runtime";

/**
 * Shape of messages yielded by the Claude Agent SDK `query()`.
 * We define a loose type since the SDK doesn't export a single union.
 */
export type SdkMessage = {
	type?: string;
	subtype?: string;
	session_id?: string;
	result?: string;
	stop_reason?: string;
	content?: Array<{
		type: string;
		text?: string;
		name?: string;
		input?: unknown;
		content?: Array<{ type: string; text?: string }>;
		id?: string;
	}>;
	// biome-ignore lint/suspicious/noExplicitAny: SDK messages are loosely typed
	[key: string]: any;
};

/**
 * Pure mapping function: converts a single SDK message into zero or more AgentEvents.
 * Does NOT emit "done" — that's the caller's responsibility.
 */
export function mapToAgentEvent(msg: SdkMessage, sessionKey: string): AgentEvent[] {
	// System init message — caller captures session_id, nothing to emit
	if (msg.type === "system" && msg.subtype === "init") {
		return [];
	}

	// Final result message — caller handles this after the loop
	if (msg.result !== undefined) {
		return [];
	}

	const events: AgentEvent[] = [];

	// Process content blocks if present
	if (Array.isArray(msg.content)) {
		for (const block of msg.content) {
			switch (block.type) {
				case "text":
					if (block.text) {
						events.push({ type: "delta", sessionKey, text: block.text });
					}
					break;

				case "thinking":
					if (block.text) {
						events.push({ type: "thinking", sessionKey, text: block.text });
					}
					break;

				case "tool_use":
					if (block.name) {
						events.push({
							type: "tool_call",
							sessionKey,
							name: block.name,
							args: block.input ?? {},
						});
					}
					break;

				case "tool_result": {
					const resultText = Array.isArray(block.content)
						? block.content
								.filter((c) => c.type === "text" && c.text)
								.map((c) => c.text)
								.join("\n")
						: (block.text ?? "");
					if (block.name || block.id) {
						events.push({
							type: "tool_result",
							sessionKey,
							name: block.name ?? block.id ?? "unknown",
							result: resultText,
							duration: 0,
						});
					}
					break;
				}
			}
		}
	}

	return events;
}

/** Parameters for `runClaudeCode`. */
export interface ClaudeCodeParams {
	prompt: string;
	sessionKey: string;
	cwd?: string;
	allowedTools?: string[];
	permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
	maxTurns?: number;
	resume?: string;
	systemPrompt?: string;
	mcpServers?: Record<string, unknown>;
	agents?: Record<string, unknown>;
	signal?: AbortSignal;
}

/** Metadata returned after a Claude Code run completes. */
export interface ClaudeCodeResult {
	sessionId?: string;
	resultText?: string;
}

/**
 * Async generator that wraps the Claude Agent SDK `query()`,
 * yielding AgentEvents compatible with YanClaw's agent runtime.
 *
 * After iteration completes, call `.next()` one final time — the return
 * value contains `ClaudeCodeResult` with session ID and result text.
 */
export async function* runClaudeCode(
	params: ClaudeCodeParams,
): AsyncGenerator<AgentEvent, ClaudeCodeResult> {
	const { prompt, sessionKey, signal } = params;

	let sessionId: string | undefined;
	let finalResult: string | undefined;
	let usage = { promptTokens: 0, completionTokens: 0 };

	try {
		const options: Record<string, unknown> = {
			cwd: params.cwd ?? process.cwd(),
			maxTurns: params.maxTurns ?? 50,
		};

		if (params.allowedTools) {
			options.allowedTools = params.allowedTools;
		}
		if (params.permissionMode) {
			options.permissionMode = params.permissionMode;
			if (params.permissionMode === "bypassPermissions") {
				options.allowDangerouslySkipPermissions = true;
			}
		}
		if (params.resume) {
			options.resume = params.resume;
		}
		if (params.systemPrompt) {
			options.systemPrompt = params.systemPrompt;
		}
		if (params.mcpServers) {
			options.mcpServers = params.mcpServers;
		}
		if (params.agents && Object.keys(params.agents).length > 0) {
			options.agents = params.agents;
		}

		const stream = query({ prompt, options });

		for await (const msg of stream) {
			if (signal?.aborted) {
				yield { type: "aborted", sessionKey, partial: finalResult ?? "" };
				return { sessionId, resultText: finalResult };
			}

			const sdkMsg = msg as SdkMessage;

			// Capture session ID from init
			if (sdkMsg.type === "system" && sdkMsg.subtype === "init" && sdkMsg.session_id) {
				sessionId = sdkMsg.session_id;
			}

			// Capture final result + usage
			if (sdkMsg.result !== undefined) {
				finalResult = sdkMsg.result;
				if (sdkMsg.usage) {
					usage = {
						promptTokens: Number(sdkMsg.usage.input_tokens ?? 0),
						completionTokens: Number(sdkMsg.usage.output_tokens ?? 0),
					};
				}
			}

			const events = mapToAgentEvent(sdkMsg, sessionKey);
			for (const event of events) {
				yield event;
			}
		}

		// Emit final result as delta + done
		if (finalResult) {
			yield { type: "delta", sessionKey, text: finalResult };
		}

		yield { type: "done", sessionKey, usage };
	} catch (err) {
		if (signal?.aborted) {
			yield { type: "aborted", sessionKey, partial: finalResult ?? "" };
			return { sessionId, resultText: finalResult };
		}

		yield {
			type: "error",
			sessionKey,
			message: err instanceof Error ? err.message : String(err),
		};
	}

	return { sessionId, resultText: finalResult };
}
