/**
 * Gateway-level slash commands processed before reaching the agent.
 * Zero token cost — intercepted in the channel message flow.
 */
import type { TaskLoopController } from "../agents/task-loop/controller";
import type { Config } from "../config/schema";
import type { ExecutionStore } from "../db/executions";
import type { SessionStore } from "../db/sessions";

export interface SlashCommandContext {
	config: Config;
	sessions: SessionStore;
	executions?: ExecutionStore;
	taskLoop?: TaskLoopController | null;
	sessionKey: string;
	isOwner: boolean;
	channelPeer?: { channelId: string; peerId: string };
}

export interface SlashCommandResult {
	reply: string;
	/** true = message fully handled, do not forward to agent */
	handled: boolean;
}

type CommandHandler = (
	args: string,
	ctx: SlashCommandContext,
) => SlashCommandResult | Promise<SlashCommandResult>;

const commands: Record<string, CommandHandler> = {
	"/model": async (args, ctx) => {
		if (!args.trim()) {
			const session = ctx.sessions.getSession(ctx.sessionKey);
			const current = session?.modelOverride ?? "default";
			return { reply: `Current model: ${current}`, handled: true };
		}
		const modelId = args.trim();
		const updated = ctx.sessions.updateModelOverride(ctx.sessionKey, modelId);
		if (!updated) {
			return { reply: "No active session to update.", handled: true };
		}
		return { reply: `Model switched to: ${modelId}`, handled: true };
	},

	"/reset": async (_, ctx) => {
		const deleted = ctx.sessions.resetSession(ctx.sessionKey);
		return {
			reply:
				deleted > 0 ? `Session reset (${deleted} messages cleared).` : "Session already empty.",
			handled: true,
		};
	},

	"/status": (_, ctx) => {
		const session = ctx.sessions.getSession(ctx.sessionKey);
		if (!session) return { reply: "No active session.", handled: true };
		const model = session.modelOverride ?? "default";
		return {
			reply: [
				`Agent: ${session.agentId}`,
				`Model: ${model}`,
				`Messages: ${session.messageCount}`,
				`Tokens: ~${session.tokenCount}`,
			].join("\n"),
			handled: true,
		};
	},

	"/resume": (_, ctx) => {
		if (!ctx.executions) {
			return { reply: "Resumable sessions not available.", handled: true };
		}
		const exec = ctx.executions.findInterruptedBySession(ctx.sessionKey);
		if (!exec) {
			return { reply: "No interrupted task found.", handled: true };
		}
		const steps = exec.completedSteps ? JSON.parse(exec.completedSteps) : [];
		// Don't actually resume here — return handled=false so the original
		// user message gets forwarded to the agent with context about the interruption
		return {
			reply: [
				"Resuming previous task...",
				`Original message: ${exec.userMessage.slice(0, 100)}${exec.userMessage.length > 100 ? "..." : ""}`,
				steps.length > 0 ? `Completed steps: ${steps.join(", ")}` : "",
				exec.partialResponse ? "Partial response available." : "",
			]
				.filter(Boolean)
				.join("\n"),
			handled: true,
		};
	},

	"/discard": (_, ctx) => {
		if (!ctx.executions) {
			return { reply: "Resumable sessions not available.", handled: true };
		}
		const count = ctx.executions.discardInterrupted(ctx.sessionKey);
		return {
			reply: count > 0 ? "Interrupted task discarded." : "No interrupted task to discard.",
			handled: true,
		};
	},

	"/task": async (args, ctx) => {
		if (!ctx.taskLoop) {
			return { reply: "Task Loop 未启用。", handled: true };
		}
		if (!ctx.isOwner) {
			return { reply: "仅 owner 可使用 /task 命令。", handled: true };
		}

		const parts = args.split(/\s+/);
		const subCmd = parts[0]?.toLowerCase();

		// /task status
		if (subCmd === "status") {
			const tasks = ctx.taskLoop.listTasks();
			if (tasks.length === 0) return { reply: "没有活跃的 Task Loop 任务。", handled: true };
			const lines = tasks.map(
				(t) =>
					`[${t.id}] ${t.state} | ${t.preset} | 迭代 ${t.iteration}/${t.maxIterations} | ${t.prompt.slice(0, 40)}`,
			);
			return { reply: lines.join("\n"), handled: true };
		}

		// /task stop <id>
		if (subCmd === "stop" && parts[1]) {
			try {
				ctx.taskLoop.cancelTask(parts[1]);
				return { reply: `任务 ${parts[1]} 已取消。`, handled: true };
			} catch (e) {
				return { reply: `取消失败: ${e instanceof Error ? e.message : String(e)}`, handled: true };
			}
		}

		// /task approve <id>
		if (subCmd === "approve" && parts[1]) {
			try {
				await ctx.taskLoop.approveTask(parts[1]);
				return { reply: `任务 ${parts[1]} 已批准。`, handled: true };
			} catch (e) {
				return { reply: `批准失败: ${e instanceof Error ? e.message : String(e)}`, handled: true };
			}
		}

		// /task resume <id> [message]
		if (subCmd === "resume" && parts[1]) {
			try {
				const message = parts.slice(2).join(" ") || undefined;
				await ctx.taskLoop.resumeTask(parts[1], message);
				return { reply: `任务 ${parts[1]} 已恢复。`, handled: true };
			} catch (e) {
				return { reply: `恢复失败: ${e instanceof Error ? e.message : String(e)}`, handled: true };
			}
		}

		// /task <preset> <prompt> [--options]
		if (subCmd && !["status", "stop", "approve", "resume", "help"].includes(subCmd)) {
			const preset = subCmd;
			// Parse prompt and options from remaining args
			const remaining = args.slice(preset.length).trim();
			const { prompt, options } = parseTaskArgs(remaining);

			if (!prompt) {
				return { reply: "用法: /task <preset> <prompt> [--options]", handled: true };
			}

			try {
				const task = await ctx.taskLoop.createTask({
					preset,
					prompt,
					workDir: (options.path as string) ?? process.cwd(),
					agentId: (options.agent as string) ?? "main",
					worktree: true,
					maxIterations: options["max-iterations"] ? Number(options["max-iterations"]) : undefined,
					triggeredBy: "channel",
					channelPeer: ctx.channelPeer,
					presetOptions: {
						verifyCommands: options.verify
							? (options.verify as string).split("&&").map((s: string) => s.trim())
							: undefined,
					},
				});
				return {
					reply: `Task Loop 已启动 [${task.id}]\n预设: ${preset}\n任务: ${prompt.slice(0, 60)}`,
					handled: true,
				};
			} catch (e) {
				return {
					reply: `启动失败: ${e instanceof Error ? e.message : String(e)}`,
					handled: true,
				};
			}
		}

		// /task (no args) or /task help
		return {
			reply: [
				"/task <preset> <prompt> — 启动任务循环",
				'/task dev <prompt> --path=/path --verify="cmd"',
				"/task status — 查看所有任务状态",
				"/task stop <id> — 停止任务",
				"/task approve <id> — 批准确认断点",
				"/task resume <id> [msg] — 恢复阻塞任务",
			].join("\n"),
			handled: true,
		};
	},

	"/help": () => ({
		reply: [
			"/model [id] — show or switch model for this session",
			"/reset — clear conversation context",
			"/status — show session stats",
			"/resume — resume an interrupted task",
			"/discard — discard an interrupted task",
			"/task <preset> <prompt> — start a task loop",
			"/task status — list task loop tasks",
			"/help — list available commands",
		].join("\n"),
		handled: true,
	}),
};

/** Parse a slash command from message text. Returns null if not a recognized command. */
export function parseSlashCommand(text: string): { name: string; args: string } | null {
	const match = text.match(/^\/(\w+)(?:\s+(.*))?$/s);
	if (!match) return null;
	const name = `/${match[1]}`;
	if (!(name in commands)) return null;
	return { name, args: match[2]?.trim() ?? "" };
}

/** Execute a parsed slash command. */
export async function executeSlashCommand(
	name: string,
	args: string,
	ctx: SlashCommandContext,
): Promise<SlashCommandResult> {
	const handler = commands[name];
	if (!handler) return { reply: `Unknown command: ${name}`, handled: true };
	return handler(args, ctx);
}

/** Parse task args: extract prompt (possibly quoted) and --key=value options. */
function parseTaskArgs(input: string): { prompt: string; options: Record<string, string> } {
	const options: Record<string, string> = {};
	let prompt = input;

	// Extract --key=value or --key="value with spaces"
	prompt = prompt.replace(/--(\w[\w-]*)=(?:"([^"]*)"|([\S]*))/g, (_, key, quotedVal, val) => {
		options[key] = quotedVal ?? val;
		return "";
	});

	// Remove surrounding quotes from prompt
	prompt = prompt
		.trim()
		.replace(/^["']|["']$/g, "")
		.trim();

	return { prompt, options };
}
