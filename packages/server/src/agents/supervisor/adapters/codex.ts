import type { ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { nanoid } from "nanoid";
import type { AgentEvent } from "../../runtime";
import type { AdapterSpawnOptions, AdapterSpawnResult, AgentAdapter } from "../adapter";

/**
 * Codex Adapter — connects to OpenAI Codex CLI via MCP protocol.
 *
 * Codex exposes an MCP server (`codex mcp-server` or `codex mcp`),
 * which we connect to via StdioClientTransport. We send tasks as
 * MCP tool calls and receive results.
 */
export class CodexAdapter implements AgentAdapter {
	readonly type = "codex";

	private alive = false;
	private client: Client | null = null;
	private transport: StdioClientTransport | null = null;
	private eventHandlers: Array<(event: AgentEvent) => void> = [];
	private permissionHandlers: Array<
		(req: { requestId: string; tool: string; args: unknown; description: string }) => void
	> = [];
	private pendingPermissions = new Map<string, (allowed: boolean) => void>();
	private sessionKey = "";
	private agentConfig: Record<string, unknown>;

	constructor(agentConfig: Record<string, unknown>) {
		this.agentConfig = agentConfig;
	}

	async spawn(options: AdapterSpawnOptions): Promise<AdapterSpawnResult> {
		this.sessionKey = `codex:${nanoid()}`;
		const codexCfg = (this.agentConfig.codex ?? {}) as Record<string, unknown>;

		// Detect Codex version and MCP subcommand
		const mcpCommand = detectMcpCommand();

		// Determine approval mode
		const mode = (codexCfg.mode as string) ?? "full-auto";

		const args = [mcpCommand];
		if (options.model || codexCfg.model) {
			args.push("--model", (options.model ?? codexCfg.model) as string);
		}

		// Create MCP transport via stdio
		this.transport = new StdioClientTransport({
			command: "codex",
			args,
			env: {
				...process.env,
				...(options.env ?? {}),
			} as Record<string, string>,
		});

		this.client = new Client({ name: "yanclaw-codex", version: "1.0.0" });

		try {
			await this.client.connect(this.transport);
			this.alive = true;

			// Get PID from transport's child process
			const pid = (this.transport as unknown as { _process?: ChildProcess })._process?.pid;

			this.emitEvent({
				type: "delta",
				sessionKey: this.sessionKey,
				text: "[Codex MCP connected]\n",
			});

			// Send the task if provided
			if (options.task) {
				await this.executeTask(options.task, options.workDir, mode);
			}

			return { pid };
		} catch (err) {
			this.alive = false;
			throw new Error(`Failed to start Codex MCP: ${err instanceof Error ? err.message : err}`);
		}
	}

	async send(message: string): Promise<void> {
		if (!this.client || !this.alive) {
			throw new Error("Codex adapter is not connected");
		}
		const codexCfg = (this.agentConfig.codex ?? {}) as Record<string, unknown>;
		const mode = (codexCfg.mode as string) ?? "full-auto";
		await this.executeTask(message, undefined, mode);
	}

	async respondPermission(requestId: string, allowed: boolean): Promise<void> {
		const resolver = this.pendingPermissions.get(requestId);
		if (resolver) {
			resolver(allowed);
			this.pendingPermissions.delete(requestId);
		}
	}

	async stop(): Promise<void> {
		this.alive = false;
		if (this.client) {
			try {
				await this.client.close();
			} catch {
				// Best effort
			}
			this.client = null;
		}
		if (this.transport) {
			try {
				await this.transport.close();
			} catch {
				// Best effort
			}
			this.transport = null;
		}
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

	private async executeTask(task: string, workDir?: string, mode?: string): Promise<void> {
		if (!this.client) return;

		try {
			// List available tools
			const tools = await this.client.listTools();

			// Find the codex execution tool — typically "codex" or "run"
			const execTool = tools.tools.find(
				(t) => t.name === "codex" || t.name === "run" || t.name === "execute",
			);

			if (!execTool) {
				// Fallback: use first available tool
				if (tools.tools.length === 0) {
					this.emitEvent({
						type: "error",
						sessionKey: this.sessionKey,
						message: "No tools available from Codex MCP server",
					});
					return;
				}
			}

			const toolName = execTool?.name ?? tools.tools[0].name;
			const toolArgs: Record<string, unknown> = { prompt: task };
			if (workDir) toolArgs.workdir = workDir;
			if (mode) toolArgs.mode = mode;

			this.emitEvent({
				type: "tool_call",
				sessionKey: this.sessionKey,
				name: toolName,
				args: toolArgs,
			});

			const result = await this.client.callTool({
				name: toolName,
				arguments: toolArgs,
			});

			// Process result content
			if (result.content && Array.isArray(result.content)) {
				for (const block of result.content) {
					if (typeof block === "object" && block !== null && "text" in block) {
						this.emitEvent({
							type: "delta",
							sessionKey: this.sessionKey,
							text: (block as { text: string }).text,
						});
					}
				}
			}

			this.emitEvent({
				type: "tool_result",
				sessionKey: this.sessionKey,
				name: toolName,
				result: result.content,
				duration: 0,
			});

			this.emitEvent({
				type: "done",
				sessionKey: this.sessionKey,
				usage: { promptTokens: 0, completionTokens: 0 },
			});
		} catch (err) {
			this.emitEvent({
				type: "error",
				sessionKey: this.sessionKey,
				message: err instanceof Error ? err.message : String(err),
			});
			this.alive = false;
		}
	}
}

/** Detect which MCP subcommand Codex supports. */
function detectMcpCommand(): string {
	try {
		execSync("codex --version", { encoding: "utf-8" });
		// Newer versions use "mcp-server", older use "mcp"
		// Try to detect via help output
		try {
			const help = execSync("codex --help", { encoding: "utf-8" });
			if (help.includes("mcp-server")) return "mcp-server";
		} catch {
			// Ignore
		}
		return "mcp";
	} catch {
		throw new Error("Codex CLI not found. Install with: npm install -g @openai/codex");
	}
}

/** Factory function for registering with AgentSupervisor. */
export function createCodexAdapter(agentConfig: Record<string, unknown>): AgentAdapter {
	return new CodexAdapter(agentConfig);
}
