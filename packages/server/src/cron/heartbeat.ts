/**
 * HeartbeatRunner — periodic agent heartbeats with active-hour constraints.
 * Registers as a special CronService task per agent that has heartbeat enabled.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Config } from "../config/schema";
import { resolveDataDir } from "../config/store";

const HEARTBEAT_OK_PATTERNS = [
	/^HEARTBEAT[_\s]?OK$/i,
	/^OK$/i,
	/^No\s+(?:action|task|issue)/i,
	/^Nothing\s+to/i,
	/^All\s+(?:good|clear|systems)/i,
];

export interface HeartbeatTarget {
	type: "none" | "last" | "channel";
	channelId?: string;
}

type AgentRunner = (params: {
	agentId: string;
	sessionKey: string;
	message: string;
	config: Config;
}) => AsyncGenerator<{ type: string; text?: string; message?: string }>;

type DeliverFn = (channelId: string, text: string) => Promise<void>;

export class HeartbeatRunner {
	private timers = new Map<string, ReturnType<typeof setInterval>>();
	private lastActiveChannel = new Map<string, string>();
	private agentRunner?: AgentRunner;
	private deliverFn?: DeliverFn;
	private getConfig: () => Config;

	constructor(getConfig: () => Config) {
		this.getConfig = getConfig;
	}

	setAgentRunner(runner: AgentRunner): void {
		this.agentRunner = runner;
	}

	setDeliverFn(fn: DeliverFn): void {
		this.deliverFn = fn;
	}

	/** Record last active channel for an agent (called from message routing). */
	recordActivity(agentId: string, channelId: string): void {
		this.lastActiveChannel.set(agentId, channelId);
	}

	/** Start heartbeats for all agents that have it enabled. */
	start(): void {
		const config = this.getConfig();
		for (const agent of config.agents) {
			if (!agent.heartbeat?.enabled) continue;
			this.startAgent(agent.id, agent.heartbeat);
		}
	}

	/** Stop all heartbeat timers. */
	stop(): void {
		for (const timer of this.timers.values()) {
			clearInterval(timer);
		}
		this.timers.clear();
	}

	/** Refresh: stop existing timers and restart from config. */
	refresh(): void {
		this.stop();
		this.start();
	}

	private startAgent(
		agentId: string,
		hbConfig: NonNullable<Config["agents"][number]["heartbeat"]>,
	): void {
		const intervalMs = parseDuration(hbConfig.interval);
		if (!intervalMs) {
			console.warn(`[heartbeat] Invalid interval "${hbConfig.interval}" for agent ${agentId}`);
			return;
		}

		const timer = setInterval(() => {
			this.runHeartbeat(agentId).catch((err) => {
				console.error(`[heartbeat] Agent ${agentId} error:`, err.message);
			});
		}, intervalMs);

		this.timers.set(agentId, timer);
		console.log(`[heartbeat] Started for agent "${agentId}" every ${hbConfig.interval}`);
	}

	private async runHeartbeat(agentId: string): Promise<void> {
		if (!this.agentRunner) return;

		const config = this.getConfig();
		const agent = config.agents.find((a) => a.id === agentId);
		if (!agent?.heartbeat?.enabled) return;

		const hb = agent.heartbeat;

		// Check active hours
		if (hb.activeHours && !isWithinActiveHours(hb.activeHours)) {
			return;
		}

		// Resolve prompt
		const prompt = await this.resolvePrompt(hb, config);
		if (!prompt) {
			console.warn(`[heartbeat] No prompt configured for agent ${agentId}`);
			return;
		}

		const sessionKey = `heartbeat:${agentId}`;
		let fullText = "";

		try {
			const events = this.agentRunner({
				agentId,
				sessionKey,
				message: prompt,
				config,
			});

			for await (const event of events) {
				if (event.type === "delta" && event.text) {
					fullText += event.text;
				} else if (event.type === "error" && event.message) {
					fullText += `[Error: ${event.message}]`;
				}
			}
		} catch (err) {
			console.error(`[heartbeat] Agent ${agentId} run failed:`, err);
			return;
		}

		const trimmed = fullText.trim();
		if (!trimmed) return;

		// Suppress OK responses
		if (hb.suppressOk && isOkResponse(trimmed)) {
			return;
		}

		// Deliver output
		await this.deliver(agentId, hb.target, trimmed);
	}

	private async resolvePrompt(
		hb: NonNullable<Config["agents"][number]["heartbeat"]>,
		config: Config,
	): Promise<string | null> {
		// Try promptFile first
		if (hb.promptFile) {
			try {
				const filePath = resolve(resolveDataDir(config), hb.promptFile);
				return await readFile(filePath, "utf-8");
			} catch {
				console.warn(`[heartbeat] Could not read prompt file: ${hb.promptFile}`);
			}
		}

		// Fall back to inline prompt
		if (hb.prompt) return hb.prompt;

		// Default heartbeat prompt
		return "Check your current state and pending tasks. If everything is normal, respond with HEARTBEAT_OK. Otherwise, report any issues or actions needed.";
	}

	private async deliver(agentId: string, target: string, text: string): Promise<void> {
		if (target === "none") return;

		let channelId: string | undefined;
		if (target === "last") {
			channelId = this.lastActiveChannel.get(agentId);
			if (!channelId) return; // No known channel, suppress
		} else {
			channelId = target;
		}

		if (channelId && this.deliverFn) {
			try {
				await this.deliverFn(channelId, text);
			} catch (err) {
				console.warn(`[heartbeat] Delivery to ${channelId} failed:`, err);
			}
		}
	}
}

function isOkResponse(text: string): boolean {
	const firstLine = text.split("\n")[0].trim();
	return HEARTBEAT_OK_PATTERNS.some((p) => p.test(firstLine));
}

function isWithinActiveHours(hours: { start: number; end: number; timezone?: string }): boolean {
	const { start, end, timezone = "Asia/Shanghai" } = hours;
	try {
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour: "numeric",
			hour12: false,
		});
		const currentHour = Number.parseInt(formatter.format(new Date()), 10);

		if (start <= end) {
			// e.g. 9-22: active when 9 <= hour < 22
			return currentHour >= start && currentHour < end;
		}
		// e.g. 22-6: active when hour >= 22 or hour < 6 (overnight)
		return currentHour >= start || currentHour < end;
	} catch {
		return true; // If timezone is invalid, default to active
	}
}

/** Parse a duration string like "30s", "5m", "2h", "1d" to milliseconds. */
function parseDuration(s: string): number | null {
	const match = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
	if (!match) return null;
	const value = Number.parseFloat(match[1]);
	const unit = match[2].toLowerCase();
	const multipliers: Record<string, number> = {
		s: 1000,
		sec: 1000,
		m: 60_000,
		min: 60_000,
		h: 3_600_000,
		hr: 3_600_000,
		d: 86_400_000,
		day: 86_400_000,
	};
	return value * (multipliers[unit] ?? 0) || null;
}
