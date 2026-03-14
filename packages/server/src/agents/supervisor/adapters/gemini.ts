import { type ChildProcess, execSync, spawn } from "node:child_process";
import { nanoid } from "nanoid";
import type { AgentEvent } from "../../runtime";
import type { AdapterSpawnOptions, AdapterSpawnResult, AgentAdapter } from "../adapter";

/**
 * Gemini CLI Adapter — spawns `gemini` as a child process in non-interactive
 * mode and captures its output as an event stream.
 *
 * Gemini CLI supports JSON output mode which we parse for structured events.
 * Falls back to plain text output parsing if JSON mode is unavailable.
 */
export class GeminiAdapter implements AgentAdapter {
	readonly type = "gemini";

	private alive = false;
	private childProcess: ChildProcess | null = null;
	private eventHandlers: Array<(event: AgentEvent) => void> = [];
	private permissionHandlers: Array<
		(req: { requestId: string; tool: string; args: unknown; description: string }) => void
	> = [];
	private pendingPermissions = new Map<string, (allowed: boolean) => void>();
	private sessionKey = "";
	private agentConfig: Record<string, unknown>;
	private outputBuffer = "";

	constructor(agentConfig: Record<string, unknown>) {
		this.agentConfig = agentConfig;
	}

	async spawn(options: AdapterSpawnOptions): Promise<AdapterSpawnResult> {
		this.sessionKey = `gemini:${nanoid()}`;
		const geminiCfg = (this.agentConfig.gemini ?? {}) as Record<string, unknown>;

		// Verify gemini CLI is available
		detectGemini();

		const args: string[] = [];

		// Add model if specified
		const model = options.model ?? (geminiCfg.model as string | undefined);
		if (model) {
			args.push("--model", model);
		}

		// Permission mode mapping
		const permMode = (geminiCfg.permissionMode as string) ?? "default";
		if (permMode === "yolo") {
			args.push("--yolo");
		} else if (permMode === "safe-yolo") {
			args.push("--safe-yolo");
		}

		// Add sandbox if configured
		if (geminiCfg.sandbox) {
			args.push("--sandbox");
		}

		// Non-interactive mode with the task as prompt
		if (options.task) {
			args.push("--prompt", options.task);
		}

		// Spawn Gemini CLI
		const child = spawn("gemini", args, {
			cwd: options.workDir || process.cwd(),
			env: {
				...process.env,
				...(options.env ?? {}),
			},
			stdio: ["pipe", "pipe", "pipe"],
			detached: true,
		});

		this.childProcess = child;
		this.alive = true;

		child.stdout?.on("data", (data: Buffer) => {
			this.handleOutput(data.toString());
		});

		child.stderr?.on("data", (data: Buffer) => {
			const text = data.toString();
			// Gemini CLI writes progress info to stderr
			if (text.trim()) {
				this.emitEvent({
					type: "delta",
					sessionKey: this.sessionKey,
					text,
				});
			}
		});

		child.on("exit", (code) => {
			this.alive = false;
			// Flush remaining buffer
			if (this.outputBuffer.trim()) {
				this.emitEvent({
					type: "delta",
					sessionKey: this.sessionKey,
					text: this.outputBuffer,
				});
				this.outputBuffer = "";
			}

			if (code === 0) {
				this.emitEvent({
					type: "done",
					sessionKey: this.sessionKey,
					usage: { promptTokens: 0, completionTokens: 0 },
				});
			} else {
				this.emitEvent({
					type: "error",
					sessionKey: this.sessionKey,
					message: `Gemini CLI exited with code ${code}`,
				});
			}
		});

		child.on("error", (err) => {
			this.alive = false;
			this.emitEvent({
				type: "error",
				sessionKey: this.sessionKey,
				message: err.message,
			});
		});

		return { pid: child.pid };
	}

	async send(message: string): Promise<void> {
		if (!this.childProcess || !this.alive) {
			throw new Error("Gemini adapter is not running");
		}

		// Write to stdin
		this.childProcess.stdin?.write(`${message}\n`);
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
		if (this.childProcess) {
			try {
				this.childProcess.kill("SIGTERM");
				// Force kill after 5 seconds
				setTimeout(() => {
					if (this.childProcess && !this.childProcess.killed) {
						this.childProcess.kill("SIGKILL");
					}
				}, 5000);
			} catch {
				// Already dead
			}
			this.childProcess = null;
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

	private handleOutput(data: string): void {
		this.outputBuffer += data;

		// Try to parse as JSONL (line-by-line)
		const lines = this.outputBuffer.split("\n");
		this.outputBuffer = lines.pop() ?? "";

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			// Try JSON parsing
			try {
				const obj = JSON.parse(trimmed);
				this.handleJsonEvent(obj);
			} catch {
				// Plain text output
				this.emitEvent({
					type: "delta",
					sessionKey: this.sessionKey,
					text: `${line}\n`,
				});
			}
		}
	}

	private handleJsonEvent(obj: Record<string, unknown>): void {
		const type = obj.type as string;

		if (type === "text" || type === "content") {
			this.emitEvent({
				type: "delta",
				sessionKey: this.sessionKey,
				text: (obj.text ?? obj.content ?? "") as string,
			});
		} else if (type === "tool_call" || type === "function_call") {
			this.emitEvent({
				type: "tool_call",
				sessionKey: this.sessionKey,
				name: (obj.name ?? obj.function ?? "unknown") as string,
				args: obj.args ?? obj.arguments ?? {},
			});
		} else if (type === "tool_result" || type === "function_result") {
			this.emitEvent({
				type: "tool_result",
				sessionKey: this.sessionKey,
				name: (obj.name ?? "unknown") as string,
				result: obj.result ?? obj.output,
				duration: 0,
			});
		} else if (type === "error") {
			this.emitEvent({
				type: "error",
				sessionKey: this.sessionKey,
				message: (obj.message ?? obj.error ?? "unknown error") as string,
			});
		} else {
			// Unknown structured event — emit as delta
			this.emitEvent({
				type: "delta",
				sessionKey: this.sessionKey,
				text: JSON.stringify(obj),
			});
		}
	}
}

/** Verify Gemini CLI is installed. */
function detectGemini(): void {
	try {
		execSync("gemini --version", { encoding: "utf-8", stdio: "pipe" });
	} catch {
		throw new Error("Gemini CLI not found. Install with: npm install -g @google/gemini-cli");
	}
}

/** Factory function for registering with AgentSupervisor. */
export function createGeminiAdapter(agentConfig: Record<string, unknown>): AgentAdapter {
	return new GeminiAdapter(agentConfig);
}
