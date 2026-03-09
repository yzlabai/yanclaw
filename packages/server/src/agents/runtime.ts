import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { type CoreMessage, type LanguageModel, streamText } from "ai";
import type { Config } from "../config/schema";
import { resolveDataDir } from "../config/store";
import { SessionStore } from "../db/sessions";
import { createToolset } from "./tools";

export type AgentEvent =
	| { type: "delta"; sessionKey: string; text: string }
	| { type: "tool_call"; sessionKey: string; name: string; args: unknown }
	| { type: "tool_result"; sessionKey: string; name: string; result: unknown; duration: number }
	| { type: "done"; sessionKey: string; usage: { promptTokens: number; completionTokens: number } }
	| { type: "error"; sessionKey: string; message: string };

function resolveModel(modelId: string, config: Config): LanguageModel {
	if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3")) {
		const key = config.models.openai?.profiles?.[0]?.apiKey;
		if (!key) throw new Error("OpenAI API key not configured");
		return openai(modelId);
	}

	// Default to Anthropic
	const key = config.models.anthropic?.profiles?.[0]?.apiKey;
	if (!key) throw new Error("Anthropic API key not configured");
	return anthropic(modelId);
}

export class AgentRuntime {
	private sessionStore = new SessionStore();

	async *run(params: {
		agentId: string;
		sessionKey: string;
		message: string;
		config: Config;
	}): AsyncGenerator<AgentEvent> {
		const { agentId, sessionKey, message, config } = params;

		const agentConfig = config.agents.find((a) => a.id === agentId);
		if (!agentConfig) {
			yield { type: "error", sessionKey, message: `Agent "${agentId}" not found` };
			return;
		}

		try {
			// Ensure workspace dir
			const workspaceDir = agentConfig.workspaceDir ?? join(resolveDataDir(), "workspace", agentId);
			await mkdir(workspaceDir, { recursive: true });

			// Ensure session exists
			this.sessionStore.ensureSession({ key: sessionKey, agentId });

			// Load history
			const storedMessages = this.sessionStore.loadMessages(sessionKey);
			const history: CoreMessage[] = storedMessages.map((m) => ({
				role: m.role as "user" | "assistant" | "system",
				content: m.content ?? "",
			}));

			// Build messages
			const messages: CoreMessage[] = [
				{ role: "system", content: agentConfig.systemPrompt },
				...history,
				{ role: "user", content: message },
			];

			// Resolve model
			const model = resolveModel(agentConfig.model, config);

			// Create tools filtered by policy
			const tools = createToolset({
				workspaceDir,
				toolsConfig: config.tools,
				agentTools: agentConfig.tools,
			});

			// Stream execution
			const result = streamText({
				model,
				messages,
				tools,
				maxSteps: 25,
			});

			let fullText = "";

			for await (const part of result.fullStream) {
				switch (part.type) {
					case "text-delta":
						fullText += part.textDelta;
						yield { type: "delta", sessionKey, text: part.textDelta };
						break;

					case "tool-call": {
						yield {
							type: "tool_call",
							sessionKey,
							name: part.toolName,
							args: part.args,
						};
						break;
					}

					case "tool-result": {
						yield {
							type: "tool_result",
							sessionKey,
							name: part.toolName,
							result: part.result,
							duration: 0,
						};
						break;
					}

					case "error": {
						yield {
							type: "error",
							sessionKey,
							message: String(part.error),
						};
						break;
					}
				}
			}

			// Get final usage
			const usage = await result.usage;

			// Save user message + assistant reply
			this.sessionStore.saveMessages(sessionKey, [
				{ role: "user", content: message },
				{
					role: "assistant",
					content: fullText || null,
					model: agentConfig.model,
					tokenCount: usage.completionTokens,
				},
			]);

			yield {
				type: "done",
				sessionKey,
				usage: {
					promptTokens: usage.promptTokens,
					completionTokens: usage.completionTokens,
				},
			};
		} catch (err) {
			yield {
				type: "error",
				sessionKey,
				message: err instanceof Error ? err.message : String(err),
			};
		}
	}
}
