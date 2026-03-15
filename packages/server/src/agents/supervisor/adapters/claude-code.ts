import { query } from "@anthropic-ai/claude-agent-sdk";
import { nanoid } from "nanoid";
import { mapToAgentEvent, type SdkMessage } from "../../claude-code-runtime";
import type { AgentEvent } from "../../runtime";
import type { AdapterSpawnOptions, AdapterSpawnResult, AgentAdapter } from "../adapter";

/**
 * Claude Code Adapter — uses Agent SDK `query()` to programmatically
 * control Claude Code as a child process.
 *
 * Supports:
 * - Streaming AgentEvent output
 * - Permission request interception via control_request/control_response
 * - Session resume via SDK session ID
 * - AbortController for cancellation
 */
export class ClaudeCodeAdapter implements AgentAdapter {
	readonly type = "claude-code";

	private alive = false;
	private abortController: AbortController | null = null;
	private eventHandlers: Array<(event: AgentEvent) => void> = [];
	private permissionHandlers: Array<
		(req: { requestId: string; tool: string; args: unknown; description: string }) => void
	> = [];
	/** Pending permission request resolvers, keyed by requestId. */
	private pendingPermissions = new Map<string, (allowed: boolean) => void>();
	private sessionId?: string;
	private sessionKey = "";
	private agentConfig: Record<string, unknown>;

	constructor(agentConfig: Record<string, unknown>) {
		this.agentConfig = agentConfig;
	}

	async spawn(options: AdapterSpawnOptions): Promise<AdapterSpawnResult> {
		this.abortController = new AbortController();
		this.alive = true;
		this.sessionKey = `claude-code:${nanoid()}`;

		const cc = (this.agentConfig.claudeCode ?? {}) as Record<string, unknown>;

		// Run the query in the background — it drives the entire session
		this.runQuery(options, cc).catch((err) => {
			const message = err instanceof Error ? err.message : String(err);
			console.error(
				"[claude-code-adapter] Query failed:",
				message,
				err instanceof Error ? err.stack : "",
			);
			this.emitEvent({
				type: "error",
				sessionKey: this.sessionKey,
				message,
			});
			this.alive = false;
		});

		// Wait briefly for the process to start
		await new Promise((resolve) => setTimeout(resolve, 500));

		return { sessionId: this.sessionId };
	}

	async send(message: string): Promise<void> {
		// For SDK mode, sending a follow-up message means starting a new query
		// in the same session (resume). We stop the current query and start a new one.
		if (this.abortController) {
			this.abortController.abort();
		}
		this.abortController = new AbortController();
		this.alive = true;

		const cc = (this.agentConfig.claudeCode ?? {}) as Record<string, unknown>;
		this.runQuery(
			{
				workDir: "",
				task: message,
				resumeSessionId: this.sessionId,
			},
			cc,
		).catch((err) => {
			this.emitEvent({
				type: "error",
				sessionKey: this.sessionKey,
				message: err instanceof Error ? err.message : String(err),
			});
		});
	}

	async respondPermission(requestId: string, allowed: boolean): Promise<void> {
		const resolver = this.pendingPermissions.get(requestId);
		if (resolver) {
			resolver(allowed);
			this.pendingPermissions.delete(requestId);
		}
	}

	async stop(): Promise<void> {
		if (this.abortController) {
			this.abortController.abort();
		}
		this.alive = false;
		this.pendingPermissions.clear();
	}

	isAlive(): boolean {
		return this.alive;
	}

	onEvent(handler: (event: AgentEvent) => void): () => void {
		this.eventHandlers.push(handler);
		return () => {
			this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
		};
	}

	onPermissionRequest(
		handler: (req: { requestId: string; tool: string; args: unknown; description: string }) => void,
	): () => void {
		this.permissionHandlers.push(handler);
		return () => {
			this.permissionHandlers = this.permissionHandlers.filter((h) => h !== handler);
		};
	}

	// ── Internal ───────────────────────────────────────────────────────

	private emitEvent(event: AgentEvent): void {
		for (const handler of this.eventHandlers) {
			handler(event);
		}
	}

	private emitPermissionRequest(req: {
		requestId: string;
		tool: string;
		args: unknown;
		description: string;
	}): void {
		for (const handler of this.permissionHandlers) {
			handler(req);
		}
	}

	private async runQuery(options: AdapterSpawnOptions, cc: Record<string, unknown>): Promise<void> {
		const queryOptions: Record<string, unknown> = {
			cwd: options.workDir || process.cwd(),
			maxTurns: (cc.maxTurns as number) ?? 50,
		};

		if (cc.allowedTools) queryOptions.allowedTools = cc.allowedTools;
		if (cc.permissionMode) {
			queryOptions.permissionMode = cc.permissionMode;
			if (cc.permissionMode === "bypassPermissions") {
				queryOptions.allowDangerouslySkipPermissions = true;
			}
		}
		if (options.resumeSessionId ?? this.sessionId) {
			queryOptions.resume = options.resumeSessionId ?? this.sessionId;
		}
		if (options.systemPrompt) queryOptions.systemPrompt = options.systemPrompt;
		if (cc.mcpServers) queryOptions.mcpServers = cc.mcpServers;
		if (cc.agents) queryOptions.agents = cc.agents;

		const prompt = options.task ?? "";

		const stream = query({ prompt, options: queryOptions });

		for await (const msg of stream) {
			if (this.abortController?.signal.aborted) {
				this.emitEvent({
					type: "aborted",
					sessionKey: this.sessionKey,
					partial: "",
				});
				break;
			}

			const sdkMsg = msg as SdkMessage;

			// Capture session ID
			if (sdkMsg.type === "system" && sdkMsg.subtype === "init" && sdkMsg.session_id) {
				this.sessionId = sdkMsg.session_id;
			}

			// Handle control_request (permission gate)
			if (sdkMsg.type === "control_request") {
				const requestId = nanoid();
				const tool = (sdkMsg.tool ?? sdkMsg.name ?? "unknown") as string;
				const args = sdkMsg.input ?? sdkMsg.args ?? {};
				const description = `${tool}: ${JSON.stringify(args).slice(0, 200)}`;

				this.emitPermissionRequest({ requestId, tool, args, description });

				// Block until permission is granted or denied
				const allowed = await new Promise<boolean>((resolve) => {
					this.pendingPermissions.set(requestId, resolve);
				});

				// Write control_response back — the SDK handles this internally
				// via the canCallTool callback. Since we're using query() directly,
				// we cannot inject into its stdin. For now, if permission mode is
				// set to acceptEdits or bypassPermissions, this won't be triggered.
				// TODO: Use SDK's canCallTool option when available
				if (!allowed) {
					// If denied, we can only abort the current query
					this.abortController?.abort();
					break;
				}
				continue;
			}

			// Capture final result
			if (sdkMsg.result !== undefined) {
				if (sdkMsg.usage) {
					this.emitEvent({
						type: "done",
						sessionKey: this.sessionKey,
						usage: {
							promptTokens: Number(sdkMsg.usage.input_tokens ?? 0),
							completionTokens: Number(sdkMsg.usage.output_tokens ?? 0),
						},
					});
				}
				continue;
			}

			// Map standard events
			const events = mapToAgentEvent(sdkMsg, this.sessionKey);
			for (const event of events) {
				this.emitEvent(event);
			}
		}

		this.alive = false;
	}
}

/** Factory function for registering with AgentSupervisor. */
export function createClaudeCodeAdapter(agentConfig: Record<string, unknown>): AgentAdapter {
	return new ClaudeCodeAdapter(agentConfig);
}
