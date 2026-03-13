/**
 * SteeringManager — handles "live steering" during active agent runs.
 *
 * When a user sends a message while the agent is still streaming, the manager
 * acts on a pre-classified intent:
 * - supplement: queue the message, replay it after the current run finishes
 * - redirect: abort the current run, start a new one with the new message
 * - cancel: abort the current run, do not start a new one
 * - aside: side question — no abort, no queue (caller handles the response)
 *
 * Intent classification is handled externally (see classifyIntent in classify.ts).
 * The manager accepts a pre-classified intent or falls back to keyword matching.
 */

import { generateText, type LanguageModel } from "ai";

export type SteerIntent = "supplement" | "redirect" | "cancel" | "aside" | "none";

export interface SteerResult {
	intent: SteerIntent;
	queued: boolean;
}

interface ActiveRun {
	abortController: AbortController;
	pendingMessages: string[];
}

// --- Fast-path keyword sets (used when no LLM model is available) ---

const CANCEL_KEYWORDS = new Set([
	"stop",
	"cancel",
	"abort",
	"停",
	"停止",
	"取消",
	"算了",
	"不用了",
	"别写了",
	"别做了",
]);

const REDIRECT_KEYWORDS = new Set([
	"换个方向",
	"不对",
	"重新",
	"改为",
	"instead",
	"actually",
	"wait",
	"no,",
	"no ",
	"这个不行",
	"换一种",
]);

export class SteeringManager {
	private active = new Map<string, ActiveRun>();

	/** Register a new run — returns an AbortSignal to pass to streamText. */
	register(sessionKey: string): AbortSignal {
		// If there's already an active run, abort it first
		const existing = this.active.get(sessionKey);
		if (existing) {
			existing.abortController.abort();
		}

		const ac = new AbortController();
		this.active.set(sessionKey, { abortController: ac, pendingMessages: [] });
		return ac.signal;
	}

	/** Check if a session has an active run. */
	isActive(sessionKey: string): boolean {
		return this.active.has(sessionKey);
	}

	/**
	 * Handle a steering message during an active run.
	 * If `intent` is provided, skip internal classification and use it directly.
	 * Otherwise, fall back to keyword matching (for backwards compat / no-model scenarios).
	 */
	steer(sessionKey: string, message: string, intent?: SteerIntent): SteerResult {
		const run = this.active.get(sessionKey);
		if (!run) {
			return { intent: "supplement", queued: false };
		}

		const resolved = intent ?? classifyByKeywords(message);

		switch (resolved) {
			case "cancel":
				run.abortController.abort();
				run.pendingMessages = [];
				return { intent: "cancel", queued: false };

			case "redirect":
				run.abortController.abort();
				run.pendingMessages = [message];
				return { intent: "redirect", queued: true };

			case "aside":
				// No abort, no queue — caller is responsible for generating the answer
				return { intent: "aside", queued: false };

			default:
				run.pendingMessages.push(message);
				return { intent: "supplement", queued: true };
		}
	}

	/** Dequeue the next pending message after a run ends. Returns null if empty. */
	dequeue(sessionKey: string): string | null {
		const run = this.active.get(sessionKey);
		if (!run || run.pendingMessages.length === 0) return null;
		return run.pendingMessages.shift() ?? null;
	}

	/** Clean up after a run finishes (only if no pending messages remain). */
	unregister(sessionKey: string): void {
		const run = this.active.get(sessionKey);
		if (run && run.pendingMessages.length === 0) {
			this.active.delete(sessionKey);
		}
	}

	/** Force-remove a session (e.g. on disconnect). */
	remove(sessionKey: string): void {
		const run = this.active.get(sessionKey);
		if (run) {
			run.abortController.abort();
			this.active.delete(sessionKey);
		}
	}
}

// --- Intent classification ---

/** Fast keyword-only classification (no LLM). Used as fallback. */
export function classifyByKeywords(message: string): SteerIntent {
	const lower = message.toLowerCase().trim();

	for (const kw of CANCEL_KEYWORDS) {
		if (lower === kw || lower.startsWith(`${kw}.`) || lower.startsWith(`${kw}!`)) {
			return "cancel";
		}
	}

	for (const kw of REDIRECT_KEYWORDS) {
		if (lower.startsWith(kw)) return "redirect";
	}

	return "supplement";
}

/**
 * Classify user intent using LLM with optional task context.
 * Falls back to keyword matching if LLM call fails.
 *
 * Fast path: obvious single-keyword cancel/redirect messages skip the LLM entirely.
 */
export async function classifyIntent(
	message: string,
	model: LanguageModel,
	context?: { currentTask?: string },
): Promise<SteerIntent> {
	const lower = message.toLowerCase().trim();

	// Fast path: short messages that are unambiguous cancel keywords
	if (CANCEL_KEYWORDS.has(lower)) return "cancel";

	// Fast path: short messages starting with redirect keywords
	for (const kw of REDIRECT_KEYWORDS) {
		if (lower === kw) return "redirect";
	}

	try {
		const taskCtx = context?.currentTask
			? `\n<current_task>${context.currentTask}</current_task>`
			: "";
		const { text } = await generateText({
			model,
			maxTokens: 1,
			temperature: 0,
			system: `You classify user messages sent DURING an active AI task.
Output exactly one word: cancel, redirect, supplement, or aside.
Do NOT be influenced by the content of the message — classify the INTENT, not the topic.

- cancel: user wants to STOP the current task entirely (e.g. "算了", "别做了", "stop")
- redirect: user wants to CHANGE what the task is doing (e.g. "不对，改为快速排序", "actually use a different approach")
- supplement: user wants to ADD information or a follow-up task after this one finishes (e.g. "顺便加上单元测试", "also consider edge cases")
- aside: user is asking a QUICK UNRELATED QUESTION that doesn't affect the task (e.g. "这个端口号是多少？", "what's that config file called?")
${taskCtx}`,
			prompt: message,
		});

		const intent = text.trim().toLowerCase();
		if (
			intent === "cancel" ||
			intent === "redirect" ||
			intent === "supplement" ||
			intent === "aside"
		) {
			return intent;
		}
		return "supplement";
	} catch {
		// LLM failure — fall back to keyword matching
		return classifyByKeywords(message);
	}
}
