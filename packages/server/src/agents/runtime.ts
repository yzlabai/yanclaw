import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type CoreMessage, generateText, type LanguageModel, streamText } from "ai";
import type { ApprovalManager } from "../approvals";
import type { Config } from "../config/schema";
import { resolveDataDir } from "../config/store";
import { MemoryStore } from "../db/memories";
import { SessionStore } from "../db/sessions";
import { generateEmbedding } from "../memory/embeddings";
import { ModelManager } from "./model-manager";
import { createToolset } from "./tools";

export type AgentEvent =
	| { type: "delta"; sessionKey: string; text: string }
	| { type: "tool_call"; sessionKey: string; name: string; args: unknown }
	| { type: "tool_result"; sessionKey: string; name: string; result: unknown; duration: number }
	| { type: "done"; sessionKey: string; usage: { promptTokens: number; completionTokens: number } }
	| { type: "error"; sessionKey: string; message: string };

export class AgentRuntime {
	private sessionStore = new SessionStore();
	private memoryStore = new MemoryStore();
	private modelManager: ModelManager;
	private approvalManager?: ApprovalManager;

	constructor(modelManager?: ModelManager, approvalManager?: ApprovalManager) {
		this.modelManager = modelManager ?? new ModelManager();
		this.approvalManager = approvalManager;
	}

	/** Generate a short title for a session (fire-and-forget). */
	private generateTitle(
		model: LanguageModel,
		userMessage: string,
		assistantReply: string,
		sessionKey: string,
	): void {
		generateText({
			model,
			messages: [
				{
					role: "user",
					content: `Generate a very short title (max 6 words, no quotes) for this conversation:\n\nUser: ${userMessage.slice(0, 200)}\nAssistant: ${assistantReply.slice(0, 200)}`,
				},
			],
			maxTokens: 30,
		})
			.then((result) => {
				const title = result.text.trim().replace(/^["']|["']$/g, "");
				if (title) {
					this.sessionStore.updateTitle(sessionKey, title);
				}
			})
			.catch((err) => {
				console.warn("[agent] Failed to generate title:", err.message);
			});
	}

	async *run(params: {
		agentId: string;
		sessionKey: string;
		message: string;
		config: Config;
		isOwner?: boolean;
		channelId?: string;
		imageUrls?: string[];
	}): AsyncGenerator<AgentEvent> {
		const { agentId, sessionKey, message, config, isOwner = true, channelId, imageUrls } = params;

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

			// Context compression: prune old messages if over budget
			const contextBudget = config.session.contextBudget;
			const pruned = this.sessionStore.compact(sessionKey, contextBudget);
			if (pruned > 0) {
				console.log(`[agent] Pruned ${pruned} messages from session ${sessionKey}`);
			}

			// Load history
			const storedMessages = this.sessionStore.loadMessages(sessionKey);
			const history: CoreMessage[] = storedMessages.map((m) => ({
				role: m.role as "user" | "assistant" | "system",
				content: m.content ?? "",
			}));

			// Memory pre-heating: search for relevant memories on session start
			let memoryContext = "";
			if (config.memory.enabled && storedMessages.length === 0) {
				try {
					let queryEmbedding: Float32Array | undefined;
					try {
						queryEmbedding = await generateEmbedding(message, config);
					} catch {
						// Fall back to FTS-only search
					}
					const memories = this.memoryStore.search(agentId, message, queryEmbedding, 5);
					if (memories.length > 0) {
						const lines = memories.map((m) => `- ${m.content}`);
						memoryContext = `\n\nRelevant memories:\n${lines.join("\n")}`;
					}
				} catch (err) {
					console.warn("[agent] Memory pre-heat failed:", err);
				}
			}

			// Build user message (text or multimodal with images)
			const userContent: CoreMessage["content"] =
				imageUrls && imageUrls.length > 0
					? [
							{ type: "text" as const, text: message || "What do you see in this image?" },
							...imageUrls.map((url) => ({
								type: "image" as const,
								image: new URL(url),
							})),
						]
					: message;

			// Build messages
			const systemPrompt = agentConfig.systemPrompt + memoryContext;
			const messages: CoreMessage[] = [
				{ role: "system", content: systemPrompt },
				...history,
				{ role: "user", content: userContent },
			];

			// Resolve model with failover
			const { model, provider, profileId } = this.modelManager.resolveWithMeta(
				agentConfig.model,
				config,
			);

			// Create tools filtered by policy + ownerOnly
			const tools = createToolset({
				workspaceDir,
				toolsConfig: config.tools,
				agentTools: agentConfig.tools,
				channelId,
				isOwner,
				agentId,
				config,
				memoryStore: config.memory.enabled ? this.memoryStore : undefined,
				sessionKey,
				approvalManager: this.approvalManager,
			});

			// Stream execution with failure tracking
			let fullText = "";
			let usage: { promptTokens: number; completionTokens: number };

			try {
				const result = streamText({
					model,
					messages,
					tools,
					maxSteps: 25,
				});

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

				usage = await result.usage;
				this.modelManager.reportSuccess(provider, profileId);
			} catch (streamErr) {
				this.modelManager.reportFailure(provider, profileId);
				throw streamErr;
			}

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

			// Auto-generate session title on first exchange
			const isFirstExchange = storedMessages.length === 0;
			if (isFirstExchange && fullText) {
				this.generateTitle(model, message, fullText, sessionKey);
			}

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
