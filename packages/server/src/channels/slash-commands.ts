/**
 * Gateway-level slash commands processed before reaching the agent.
 * Zero token cost — intercepted in the channel message flow.
 */
import type { Config } from "../config/schema";
import type { ExecutionStore } from "../db/executions";
import type { SessionStore } from "../db/sessions";

export interface SlashCommandContext {
	config: Config;
	sessions: SessionStore;
	executions?: ExecutionStore;
	sessionKey: string;
	isOwner: boolean;
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

	"/help": () => ({
		reply: [
			"/model [id] — show or switch model for this session",
			"/reset — clear conversation context",
			"/status — show session stats",
			"/resume — resume an interrupted task",
			"/discard — discard an interrupted task",
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
