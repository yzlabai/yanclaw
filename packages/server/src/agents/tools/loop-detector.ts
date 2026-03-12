/**
 * Tool loop detector: detects repetitive, ping-pong, and stalled tool call patterns.
 * Integrated into the agent runtime to prevent wasteful infinite loops.
 */

export interface LoopDetectorConfig {
	/** Number of recent calls to track. Default: 30 */
	historySize: number;
	/** Identical call count to emit warning. Default: 10 */
	warningThreshold: number;
	/** Identical call count to block execution. Default: 20 */
	blockThreshold: number;
	/** Total repetitions to trigger circuit breaker. Default: 30 */
	circuitBreaker: number;
}

export type LoopAction = "allow" | "warn" | "block" | "circuit_break";

interface CallEntry {
	hash: string;
	toolName: string;
	outputHash?: string;
}

const DEFAULT_CONFIG: LoopDetectorConfig = {
	historySize: 30,
	warningThreshold: 10,
	blockThreshold: 20,
	circuitBreaker: 30,
};

export class LoopDetector {
	private config: LoopDetectorConfig;
	/** Per-session call history. */
	private sessions = new Map<string, CallEntry[]>();
	/** Per-session total blocked count (for circuit breaker). */
	private blockedCounts = new Map<string, number>();
	/** Per-session last activity timestamp (for eviction). */
	private lastActivity = new Map<string, number>();
	/** Max idle time before evicting session state (1 hour). */
	private readonly evictionMs = 60 * 60 * 1000;

	constructor(config?: Partial<LoopDetectorConfig>) {
		this.config = { ...DEFAULT_CONFIG, ...config };
	}

	/** Evict stale session data to prevent memory leaks. */
	private evictStale(): void {
		if (this.sessions.size < 100) return; // only bother when there's enough to clean
		const cutoff = Date.now() - this.evictionMs;
		for (const [key, ts] of this.lastActivity) {
			if (ts < cutoff) {
				this.sessions.delete(key);
				this.blockedCounts.delete(key);
				this.lastActivity.delete(key);
			}
		}
	}

	/**
	 * Check a tool call before execution.
	 * Returns the action to take and an optional reason message.
	 */
	check(
		sessionKey: string,
		toolName: string,
		args: unknown,
	): { action: LoopAction; reason?: string } {
		this.lastActivity.set(sessionKey, Date.now());
		this.evictStale();

		const history = this.getHistory(sessionKey);
		const hash = this.hashCall(toolName, args);

		// Circuit breaker: too many total blocks
		const totalBlocked = this.blockedCounts.get(sessionKey) ?? 0;
		if (totalBlocked >= this.config.circuitBreaker) {
			return {
				action: "circuit_break",
				reason: `Circuit breaker triggered: ${totalBlocked} tool calls blocked in this session. The agent appears stuck in an unrecoverable loop.`,
			};
		}

		// Count identical calls
		const identicalCount = history.filter((e) => e.hash === hash).length;

		if (identicalCount >= this.config.blockThreshold) {
			this.blockedCounts.set(sessionKey, totalBlocked + 1);
			return {
				action: "block",
				reason: `Blocked: ${toolName} called ${identicalCount} times with identical arguments. Try a different approach.`,
			};
		}

		// Ping-pong detection: A→B→A→B pattern
		if (history.length >= 4) {
			const recent = history.slice(-4);
			if (
				recent[0].hash === recent[2].hash &&
				recent[1].hash === recent[3].hash &&
				recent[0].hash !== recent[1].hash
			) {
				const pingPongCount = this.countPingPong(history);
				if (pingPongCount >= this.config.blockThreshold / 2) {
					this.blockedCounts.set(sessionKey, totalBlocked + 1);
					return {
						action: "block",
						reason: `Blocked: ping-pong loop detected between tool calls (${pingPongCount} cycles). Break the cycle.`,
					};
				}
				if (pingPongCount >= this.config.warningThreshold / 2) {
					this.recordCall(sessionKey, hash, toolName);
					return {
						action: "warn",
						reason: `Warning: possible ping-pong loop detected (${pingPongCount} cycles). Consider a different strategy.`,
					};
				}
			}
		}

		// Stall detection: same tool, output unchanged
		if (history.length >= 3) {
			const sameTool = history.filter((e) => e.toolName === toolName && e.outputHash);
			if (sameTool.length >= 3) {
				const lastOutputs = sameTool.slice(-3).map((e) => e.outputHash);
				if (lastOutputs.every((h) => h === lastOutputs[0])) {
					if (sameTool.length >= this.config.warningThreshold) {
						this.recordCall(sessionKey, hash, toolName);
						return {
							action: "warn",
							reason: `Warning: ${toolName} producing identical output across ${sameTool.length} calls. The operation may be stalled.`,
						};
					}
				}
			}
		}

		if (identicalCount >= this.config.warningThreshold) {
			this.recordCall(sessionKey, hash, toolName);
			return {
				action: "warn",
				reason: `Warning: ${toolName} called ${identicalCount} times with identical arguments. Consider changing your approach.`,
			};
		}

		// Record and allow
		this.recordCall(sessionKey, hash, toolName);
		return { action: "allow" };
	}

	/** Record the output hash for stall detection. */
	recordOutput(sessionKey: string, toolName: string, output: unknown): void {
		const history = this.sessions.get(sessionKey);
		if (!history || history.length === 0) return;

		// Update the last entry for this tool
		for (let i = history.length - 1; i >= 0; i--) {
			if (history[i].toolName === toolName && !history[i].outputHash) {
				history[i].outputHash = this.simpleHash(JSON.stringify(output).slice(0, 1000));
				break;
			}
		}
	}

	/** Clear history for a session. */
	clear(sessionKey: string): void {
		this.sessions.delete(sessionKey);
		this.blockedCounts.delete(sessionKey);
		this.lastActivity.delete(sessionKey);
	}

	private getHistory(sessionKey: string): CallEntry[] {
		return this.sessions.get(sessionKey) ?? [];
	}

	private recordCall(sessionKey: string, hash: string, toolName: string): void {
		let history = this.sessions.get(sessionKey);
		if (!history) {
			history = [];
			this.sessions.set(sessionKey, history);
		}
		history.push({ hash, toolName });
		// Trim to history size
		if (history.length > this.config.historySize) {
			history.splice(0, history.length - this.config.historySize);
		}
	}

	private countPingPong(history: CallEntry[]): number {
		if (history.length < 2) return 0;
		let cycles = 0;
		for (let i = 2; i < history.length; i += 2) {
			if (
				history[i].hash === history[i - 2].hash &&
				i - 1 >= 0 &&
				i + 1 < history.length &&
				history[i - 1].hash === history[i + 1]?.hash
			) {
				cycles++;
			}
		}
		return cycles;
	}

	private hashCall(toolName: string, args: unknown): string {
		const str = `${toolName}:${JSON.stringify(args)}`;
		return this.simpleHash(str);
	}

	/** Fast non-crypto hash (djb2). */
	private simpleHash(str: string): string {
		let hash = 5381;
		for (let i = 0; i < str.length; i++) {
			hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff;
		}
		return hash.toString(36);
	}
}
