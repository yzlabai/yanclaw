import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { type CoreMessage, generateText, type LanguageModel, streamText } from "ai";
import type { ApprovalManager } from "../approvals";
import { type Config, DEFAULT_SYSTEM_PROMPT, type Preference } from "../config/schema";
import { resolveDataDir } from "../config/store";
import { MemoryStore } from "../db/memories";
import { SessionStore } from "../db/sessions";
import type { McpClientManager } from "../mcp/client";
import type { MediaStore } from "../media";
import { generateEmbedding } from "../memory/embeddings";
import type { PluginRegistry } from "../plugins/registry";
import type { LeakDetector } from "../security/leak-detector";
import { checkDataFlow, detectInjection, wrapUntrustedContent } from "../security/sanitize";
import { runClaudeCode } from "./claude-code-runtime";
import { compactMessages, flushToMemory, needsCompaction } from "./compaction";
import { ModelManager } from "./model-manager";
import { buildSystemPrompt } from "./system-prompt-builder";
import { createToolset } from "./tools";
import { LoopDetector } from "./tools/loop-detector";
import type { UsageTracker } from "./usage-tracker";

export type AgentEvent =
	| { type: "delta"; sessionKey: string; text: string }
	| { type: "thinking"; sessionKey: string; text: string }
	| { type: "tool_call"; sessionKey: string; name: string; args: unknown }
	| { type: "tool_result"; sessionKey: string; name: string; result: unknown; duration: number }
	| { type: "done"; sessionKey: string; usage: { promptTokens: number; completionTokens: number } }
	| { type: "aborted"; sessionKey: string; partial: string }
	| { type: "error"; sessionKey: string; message: string }
	| { type: "steering_resume"; sessionKey: string; message: string };

export class AgentRuntime {
	private sessionStore = new SessionStore();
	private memoryStore = new MemoryStore();
	private modelManager: ModelManager;
	private approvalManager?: ApprovalManager;
	private mediaStore?: MediaStore;
	private leakDetector?: LeakDetector;
	private mcpClientManager?: McpClientManager;
	private usageTracker?: UsageTracker;
	private pluginRegistry?: PluginRegistry;
	private loopDetector = new LoopDetector();
	/** Maps YanClaw sessionKey → Agent SDK session ID (for resume). */
	private sdkSessionIds = new Map<string, string>();
	/** Per-session serialization lanes to prevent concurrent execution. */
	private sessionLanes = new Map<string, Promise<void>>();

	constructor(
		modelManager?: ModelManager,
		approvalManager?: ApprovalManager,
		mediaStore?: MediaStore,
		leakDetector?: LeakDetector,
		mcpClientManager?: McpClientManager,
		usageTracker?: UsageTracker,
		pluginRegistry?: PluginRegistry,
	) {
		this.modelManager = modelManager ?? new ModelManager();
		this.approvalManager = approvalManager;
		this.mediaStore = mediaStore;
		this.leakDetector = leakDetector;
		this.mcpClientManager = mcpClientManager;
		this.usageTracker = usageTracker;
		this.pluginRegistry = pluginRegistry;
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
		signal?: AbortSignal;
		preference?: Preference;
	}): AsyncGenerator<AgentEvent> {
		// Session serialization: wait for any in-flight run on the same session
		const { sessionKey } = params;
		const prevLane = this.sessionLanes.get(sessionKey);
		let releaseLane: (() => void) | undefined;
		const lanePromise = new Promise<void>((resolve) => {
			releaseLane = resolve;
		});
		this.sessionLanes.set(sessionKey, lanePromise);

		if (prevLane) {
			await prevLane;
		}

		try {
			yield* this._runInternal(params);
		} finally {
			releaseLane?.();
			// Clean up lane if it's still ours
			if (this.sessionLanes.get(sessionKey) === lanePromise) {
				this.sessionLanes.delete(sessionKey);
			}
		}
	}

	private async *_runInternal(params: {
		agentId: string;
		sessionKey: string;
		message: string;
		config: Config;
		isOwner?: boolean;
		channelId?: string;
		imageUrls?: string[];
		signal?: AbortSignal;
		preference?: Preference;
	}): AsyncGenerator<AgentEvent> {
		const {
			agentId,
			sessionKey,
			message,
			config,
			isOwner = true,
			channelId,
			imageUrls,
			signal,
			preference,
		} = params;

		const agentConfig = config.agents.find((a) => a.id === agentId);
		if (!agentConfig) {
			yield { type: "error", sessionKey, message: `Agent "${agentId}" not found` };
			return;
		}

		// Claude Code runtime: delegate to Agent SDK
		if (agentConfig.runtime === "claude-code") {
			const workspaceDir = agentConfig.workspaceDir ?? join(resolveDataDir(), "workspace", agentId);
			await mkdir(workspaceDir, { recursive: true });
			this.sessionStore.ensureSession({ key: sessionKey, agentId });

			// Load existing SDK session ID for resume
			const sdkSessionId = this.sdkSessionIds.get(sessionKey);

			const cc = agentConfig.claudeCode;
			const gen = runClaudeCode({
				prompt: message,
				sessionKey,
				cwd: workspaceDir,
				allowedTools: cc?.allowedTools,
				permissionMode: cc?.permissionMode,
				maxTurns: cc?.maxTurns,
				mcpServers: cc?.mcpServers as Record<string, unknown> | undefined,
				agents: cc?.agents as Record<string, unknown> | undefined,
				systemPrompt:
					agentConfig.systemPrompt !== DEFAULT_SYSTEM_PROMPT ? agentConfig.systemPrompt : undefined,
				resume: sdkSessionId,
				signal,
			});

			// Drain the generator, yielding events to the caller
			let step = await gen.next();
			while (!step.done) {
				yield step.value;
				step = await gen.next();
			}

			// Persist session: save messages + SDK session ID for resume
			const result = step.value;
			if (result?.sessionId) {
				this.sdkSessionIds.set(sessionKey, result.sessionId);
			}
			this.sessionStore.saveMessages(sessionKey, [
				{ role: "user", content: message },
				{
					role: "assistant",
					content: result?.resultText ?? null,
					model: "claude-code",
				},
			]);
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

			// Build system prompt using layered builder
			const promptMode = agentConfig.bootstrap?.mode ?? "full";
			const skillPrompts = this.pluginRegistry?.getSkillPrompts();
			const systemPrompt = await buildSystemPrompt({
				agentId,
				systemPrompt: agentConfig.systemPrompt,
				config,
				mode: promptMode,
				memoryContext: memoryContext || undefined,
				channelId,
				workspaceDir: agentConfig.workspaceDir,
				skillPrompts: skillPrompts?.length ? skillPrompts : undefined,
			});

			let messages: CoreMessage[] = [
				{ role: "system", content: systemPrompt },
				...history,
				{ role: "user", content: userContent },
			];

			// Resolve model: session override → 2D scene×preference → legacy model ID
			const session = this.sessionStore.getSession(sessionKey);
			const modelOverride = session?.modelOverride;
			const scene = imageUrls && imageUrls.length > 0 ? "vision" : "chat";
			const resolvedPreference = preference ?? agentConfig.preference ?? "default";

			let model: LanguageModel;
			let provider: string;
			let profileId: string;

			if (modelOverride) {
				// Session-level model override takes priority
				({ model, provider, profileId } = this.modelManager.resolveByIdWithMeta(
					modelOverride,
					config,
				));
			} else {
				try {
					// Try 2D systemModels resolution first
					({ model, provider, profileId } = this.modelManager.resolveWithMeta(
						scene,
						resolvedPreference,
						config,
					));
				} catch {
					// Fallback to legacy: resolve by agent's model ID directly
					({ model, provider, profileId } = this.modelManager.resolveByIdWithMeta(
						agentConfig.model,
						config,
					));
				}
			}

			// LLM-based context compaction: summarize old messages if approaching budget
			const compactionCfg = config.session.compaction;
			if (
				compactionCfg.enabled &&
				needsCompaction(messages, contextBudget, compactionCfg.triggerRatio)
			) {
				console.log(`[agent] Context compaction triggered for session ${sessionKey}`);

				// Resolve compaction model (may differ from chat model)
				let compactionModel = model;
				if (compactionCfg.model) {
					try {
						compactionModel = this.modelManager.resolveByIdWithMeta(
							compactionCfg.model,
							config,
						).model;
					} catch {
						// Fall back to chat model
					}
				}

				// Flush important facts to memory before compacting
				if (compactionCfg.memoryFlush && config.memory.enabled) {
					const toFlush = messages.slice(1, -(compactionCfg.keepRecentMessages + 1));
					await flushToMemory({
						messages: toFlush,
						model: compactionModel,
						memoryStore: this.memoryStore,
						agentId,
						sessionKey,
						config,
					});
				}

				// Summarize old messages
				const compaction = await compactMessages({
					messages,
					model: compactionModel,
					keepRecent: compactionCfg.keepRecentMessages,
					identifierPolicy: compactionCfg.identifierPolicy,
				});

				if (compaction.compactedCount > 0) {
					messages = compaction.keptMessages;
					console.log(
						`[agent] Compacted ${compaction.compactedCount} messages into summary for session ${sessionKey}`,
					);
				}
			}

			// Create tools filtered by policy + ownerOnly
			const tools = await createToolset({
				workspaceDir,
				toolsConfig: config.tools,
				agentTools: agentConfig.tools,
				channelId,
				isOwner,
				agentId,
				config,
				memoryStore: config.memory.enabled ? this.memoryStore : undefined,
				mediaStore: this.mediaStore,
				sessionKey,
				approvalManager: this.approvalManager,
				agentCapabilities: agentConfig.capabilities,
				mcpClientManager: this.mcpClientManager,
				sessionStore: this.sessionStore,
				pluginRegistry: this.pluginRegistry,
			});

			// Stream execution with failure tracking
			let fullText = "";
			let usage: { promptTokens: number; completionTokens: number };
			const streamStartTime = Date.now();

			try {
				const result = streamText({
					model,
					messages,
					tools,
					maxSteps: 25,
					abortSignal: signal,
				});

				for await (const part of result.fullStream) {
					switch (part.type) {
						case "text-delta":
							// Leak detection: scan output for credential patterns
							if (this.leakDetector && this.leakDetector.size > 0) {
								const check = this.leakDetector.scan(fullText + part.textDelta);
								if (check.leaked) {
									console.error(
										`[security] Credential leak detected in LLM output for session ${sessionKey}`,
									);
									yield {
										type: "error",
										sessionKey,
										message: "Response blocked: potential credential leak detected",
									};
									return;
								}
							}
							fullText += part.textDelta;
							yield { type: "delta", sessionKey, text: part.textDelta };
							break;

						case "reasoning": {
							yield { type: "thinking", sessionKey, text: part.textDelta };
							break;
						}

						case "tool-call": {
							// Loop detection: check for repetitive tool calls
							const loopCheck = this.loopDetector.check(sessionKey, part.toolName, part.args);
							if (loopCheck.action === "circuit_break") {
								console.error(`[agent] ${loopCheck.reason}`);
								yield {
									type: "error",
									sessionKey,
									message: loopCheck.reason ?? "Loop circuit breaker triggered",
								};
								return;
							}
							if (loopCheck.action === "block") {
								console.warn(`[agent] ${loopCheck.reason}`);
								yield {
									type: "error",
									sessionKey,
									message: loopCheck.reason ?? "Repetitive tool call blocked",
								};
								return;
							}
							if (loopCheck.action === "warn") {
								console.warn(`[agent] ${loopCheck.reason}`);
							}

							// Data flow heuristic check before tool execution
							const flowCheck = checkDataFlow(part.toolName, part.args as Record<string, unknown>);
							if (flowCheck) {
								console.warn(
									`[security] Data flow rule "${flowCheck.rule}" triggered for ${part.toolName} in session ${sessionKey}`,
								);
							}

							// Plugin beforeToolCall hooks
							if (this.pluginRegistry) {
								const hookResult = await this.pluginRegistry.runBeforeToolCall({
									name: part.toolName,
									input: part.args,
								});
								if (hookResult === null) {
									console.warn(`[plugins] Tool call "${part.toolName}" blocked by plugin hook`);
									yield {
										type: "tool_result",
										sessionKey,
										name: part.toolName,
										result: "Tool execution blocked by plugin.",
										duration: 0,
									};
									break;
								}
							}

							yield {
								type: "tool_call",
								sessionKey,
								name: part.toolName,
								args: part.args,
							};
							break;
						}

						case "tool-result": {
							// Record output for loop stall detection
							this.loopDetector.recordOutput(sessionKey, part.toolName, part.result);

							// Wrap tool results with boundary markers for injection defense
							const resultStr =
								typeof part.result === "string" ? part.result : JSON.stringify(part.result);
							const wrappedResult = wrapUntrustedContent(resultStr, part.toolName);

							// Check for injection patterns (log warning)
							const injection = detectInjection(resultStr);
							if (injection.detected) {
								console.warn(
									`[security] Injection pattern detected in ${part.toolName} result for session ${sessionKey}: ${injection.patterns.join(", ")}`,
								);
							}

							// Plugin afterToolCall hooks
							if (this.pluginRegistry) {
								await this.pluginRegistry.runAfterToolCall(
									{ name: part.toolName, input: part.args },
									part.result,
								);
							}

							yield {
								type: "tool_result",
								sessionKey,
								name: part.toolName,
								result: wrappedResult,
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

				// Record usage for cost tracking
				if (this.usageTracker) {
					try {
						this.usageTracker.record({
							sessionKey,
							agentId,
							model: agentConfig.model,
							provider,
							inputTokens: usage.promptTokens,
							outputTokens: usage.completionTokens,
							durationMs: Date.now() - streamStartTime,
						});
					} catch (err) {
						console.warn("[agent] Failed to record usage:", err);
					}
				}
			} catch (streamErr) {
				// Check if this was an intentional abort (steering/cancel)
				if (signal?.aborted) {
					// Save partial output so context is preserved
					if (fullText) {
						this.sessionStore.saveMessages(sessionKey, [
							{ role: "user", content: message },
							{
								role: "assistant",
								content: `${fullText}\n\n[interrupted]`,
								model: agentConfig.model,
								tokenCount: 0,
							},
						]);
					}
					yield { type: "aborted", sessionKey, partial: fullText };
					return;
				}
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
