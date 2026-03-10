export type AnomalyLevel = "normal" | "warning" | "critical";

interface WindowState {
	count: number;
	windowStart: number;
}

interface Thresholds {
	warn: number;
	critical: number;
}

export interface AnomalyConfig {
	enabled: boolean;
	thresholds: Record<string, Thresholds>;
	action: "log" | "pause" | "abort";
}

const DEFAULT_THRESHOLDS: Record<string, Thresholds> = {
	shell: { warn: 10, critical: 20 },
	file_write: { warn: 30, critical: 50 },
	"*": { warn: 80, critical: 100 },
};

/**
 * Detects anomalous tool call frequency per session.
 * Uses a sliding window (1 minute) to track calls per tool per session.
 */
export class AnomalyDetector {
	private counters = new Map<string, WindowState>();
	private readonly windowMs = 60_000;
	private thresholds: Record<string, Thresholds>;

	constructor(thresholds?: Record<string, Thresholds>) {
		this.thresholds = thresholds ?? DEFAULT_THRESHOLDS;
	}

	/** Check if a tool call frequency is anomalous. */
	check(sessionKey: string, toolName: string): AnomalyLevel {
		const key = `${sessionKey}:${toolName}`;
		const now = Date.now();
		const state = this.counters.get(key);

		if (!state || now - state.windowStart > this.windowMs) {
			// New window — reset in place (reuses Map slot, no stale entry buildup)
			this.counters.set(key, { count: 1, windowStart: now });
			return "normal";
		}

		state.count++;

		const thresholds = this.thresholds[toolName] ?? this.thresholds["*"];
		if (!thresholds) return "normal";

		if (state.count > thresholds.critical) return "critical";
		if (state.count > thresholds.warn) return "warning";
		return "normal";
	}

	/** Periodic cleanup of stale window entries. */
	cleanup(): void {
		const now = Date.now();
		for (const [key, state] of this.counters) {
			if (now - state.windowStart > this.windowMs) {
				this.counters.delete(key);
			}
		}
	}

	/** Update thresholds (e.g., from config reload). Resets all counters. */
	updateThresholds(thresholds: Record<string, Thresholds>): void {
		this.thresholds = thresholds;
		this.counters.clear();
	}

	/** Clear all counters (e.g., on session end). */
	clearSession(sessionKey: string): void {
		for (const key of this.counters.keys()) {
			if (key.startsWith(`${sessionKey}:`)) {
				this.counters.delete(key);
			}
		}
	}
}
