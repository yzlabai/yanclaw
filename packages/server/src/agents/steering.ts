/**
 * SteeringManager — handles "live steering" during active agent runs.
 *
 * When a user sends a message while the agent is still streaming, the manager
 * classifies intent (supplement / redirect / cancel) and acts accordingly:
 * - supplement: queue the message, replay it after the current run finishes
 * - redirect: abort the current run, start a new one with the new message
 * - cancel: abort the current run, do not start a new one
 */

export type SteerIntent = "supplement" | "redirect" | "cancel" | "none";

export interface SteerResult {
	intent: SteerIntent;
	queued: boolean;
}

interface ActiveRun {
	abortController: AbortController;
	pendingMessages: string[];
}

const CANCEL_KEYWORDS = new Set([
	"stop",
	"cancel",
	"abort",
	"停",
	"停止",
	"取消",
	"算了",
	"不用了",
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

	/** Classify and handle a steering message during an active run. */
	steer(sessionKey: string, message: string): SteerResult {
		const run = this.active.get(sessionKey);
		if (!run) {
			// No active run — treat as a normal message (caller should use chat.send)
			return { intent: "supplement", queued: false };
		}

		const intent = classifyIntent(message);

		switch (intent) {
			case "cancel":
				run.abortController.abort();
				run.pendingMessages = [];
				return { intent: "cancel", queued: false };

			case "redirect":
				run.abortController.abort();
				run.pendingMessages = [message];
				return { intent: "redirect", queued: true };

			case "supplement":
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

/** Classify user intent from the message text using keyword matching. */
function classifyIntent(message: string): SteerIntent {
	const lower = message.toLowerCase().trim();

	// Exact or near-exact cancel
	if (CANCEL_KEYWORDS.has(lower)) return "cancel";

	// Check if message starts with a cancel keyword followed by punctuation
	for (const kw of CANCEL_KEYWORDS) {
		if (lower === kw || lower.startsWith(`${kw}.`) || lower.startsWith(`${kw}!`)) {
			return "cancel";
		}
	}

	// Check redirect keywords (message starts with or contains them)
	for (const kw of REDIRECT_KEYWORDS) {
		if (lower.startsWith(kw)) return "redirect";
	}

	// Default: supplement (queue and replay after current run)
	return "supplement";
}
