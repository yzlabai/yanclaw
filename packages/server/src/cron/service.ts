import { CronExpressionParser } from "cron-parser";
import type { Config } from "../config/schema";

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

export interface CronTask {
	id: string;
	agent: string;
	mode: "cron" | "interval" | "once";
	schedule: string;
	prompt: string;
	deliveryTargets: { channel: string; peer?: string }[];
	enabled: boolean;
}

export interface CronTaskStatus extends CronTask {
	nextRunAt: number | null;
	lastRunAt: number | null;
	lastResult: string | null;
	isRunning: boolean;
}

interface TaskState {
	nextRunAt: number;
	lastRunAt: number | null;
	lastResult: string | null;
	isRunning: boolean;
}

type AgentRunner = (params: {
	agentId: string;
	sessionKey: string;
	message: string;
	config: Config;
}) => AsyncGenerator<{ type: string; text?: string; message?: string }>;

/** Cron scheduler — evaluates cron expressions and triggers agent runs. */
export class CronService {
	private taskStates = new Map<string, TaskState>();
	private timer: ReturnType<typeof setInterval> | null = null;
	private agentRunner?: AgentRunner;
	private getConfig?: () => Config;
	private deliverCallback?: (
		channel: string,
		peer: string | undefined,
		text: string,
	) => Promise<void>;

	/** Set the agent runner callback. */
	setAgentRunner(runner: AgentRunner): void {
		this.agentRunner = runner;
	}

	/** Set config getter. */
	setConfigGetter(getter: () => Config): void {
		this.getConfig = getter;
	}

	/** Set delivery callback for sending results to channels. */
	setDeliveryCallback(
		cb: (channel: string, peer: string | undefined, text: string) => Promise<void>,
	): void {
		this.deliverCallback = cb;
	}

	/** Start the scheduler (checks every 30 seconds). */
	start(): void {
		if (this.timer) return;

		// Initial schedule computation
		this.refreshSchedules();

		this.timer = setInterval(() => {
			this.tick();
		}, 30_000);

		// Run first tick immediately
		this.tick();

		console.log("[cron] Scheduler started");
	}

	/** Stop the scheduler. */
	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		console.log("[cron] Scheduler stopped");
	}

	/** Refresh schedules from config. */
	refreshSchedules(): void {
		const config = this.getConfig?.();
		if (!config) return;

		const tasks = config.cron.tasks;
		const newIds = new Set(tasks.map((t) => t.id));

		// Remove deleted tasks
		for (const id of this.taskStates.keys()) {
			if (!newIds.has(id)) {
				this.taskStates.delete(id);
			}
		}

		// Add/update tasks
		for (const task of tasks) {
			if (!task.enabled) {
				this.taskStates.delete(task.id);
				continue;
			}

			const existing = this.taskStates.get(task.id);
			if (!existing) {
				const nextRunAt = this.computeNextRun(task.schedule, task.mode);
				if (nextRunAt) {
					this.taskStates.set(task.id, {
						nextRunAt,
						lastRunAt: null,
						lastResult: null,
						isRunning: false,
					});
				}
			}
		}
	}

	/** Get status of all tasks. */
	getTaskStatuses(): CronTaskStatus[] {
		const config = this.getConfig?.();
		if (!config) return [];

		return config.cron.tasks.map((task) => {
			const state = this.taskStates.get(task.id);
			return {
				...task,
				nextRunAt: state?.nextRunAt ?? null,
				lastRunAt: state?.lastRunAt ?? null,
				lastResult: state?.lastResult ?? null,
				isRunning: state?.isRunning ?? false,
			};
		});
	}

	/** Manually trigger a task. */
	async runTask(taskId: string): Promise<string> {
		const config = this.getConfig?.();
		if (!config) throw new Error("Config not available");

		const task = config.cron.tasks.find((t) => t.id === taskId);
		if (!task) throw new Error(`Task "${taskId}" not found`);

		return this.executeTask(task, config);
	}

	/** Check for tasks due and execute them. */
	private tick(): void {
		const config = this.getConfig?.();
		if (!config) return;

		const now = Date.now();

		for (const task of config.cron.tasks) {
			if (!task.enabled) continue;

			const state = this.taskStates.get(task.id);
			if (!state || state.isRunning) continue;

			if (now >= state.nextRunAt) {
				// Fire and forget
				this.executeTask(task, config).catch((err) => {
					console.error(`[cron] Task "${task.id}" failed:`, err.message);
				});
			}
		}
	}

	/** Execute a task and deliver results. */
	private async executeTask(task: CronTask, config: Config): Promise<string> {
		if (!this.agentRunner) throw new Error("No agent runner configured");

		const state = this.taskStates.get(task.id) ?? {
			nextRunAt: 0,
			lastRunAt: null,
			lastResult: null,
			isRunning: false,
		};

		state.isRunning = true;
		this.taskStates.set(task.id, state);

		const sessionKey = `cron:${task.id}`;
		let fullText = "";

		try {
			const events = this.agentRunner({
				agentId: task.agent,
				sessionKey,
				message: task.prompt,
				config,
			});

			for await (const event of events) {
				if (event.type === "delta" && event.text) {
					fullText += event.text;
				} else if (event.type === "error" && event.message) {
					fullText += `[Error: ${event.message}]`;
				}
			}

			// Deliver to targets
			const deliveryFailures: string[] = [];
			if (fullText.trim() && this.deliverCallback) {
				for (const target of task.deliveryTargets) {
					try {
						await this.deliverCallback(target.channel, target.peer, fullText);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						console.warn(`[cron] Delivery to ${target.channel} failed:`, msg);
						deliveryFailures.push(`${target.channel}: ${msg}`);
					}
				}
			}

			state.lastRunAt = Date.now();
			const resultSuffix =
				deliveryFailures.length > 0 ? `\n[Delivery failed: ${deliveryFailures.join("; ")}]` : "";
			state.lastResult = fullText.slice(0, 500) + resultSuffix;
			state.isRunning = false;

			// Compute next run (one-time tasks don't repeat)
			if (task.mode === "once") {
				this.taskStates.delete(task.id);
				console.log(`[cron] One-time task "${task.id}" completed, removed from schedule`);
			} else {
				const nextRun = this.computeNextRun(task.schedule, task.mode);
				if (nextRun) {
					state.nextRunAt = nextRun;
				}
				this.taskStates.set(task.id, state);
			}
			return fullText;
		} catch (err) {
			state.isRunning = false;
			state.lastRunAt = Date.now();
			state.lastResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
			this.taskStates.set(task.id, state);
			throw err;
		}
	}

	private computeNextRun(
		schedule: string,
		mode: "cron" | "interval" | "once" = "cron",
	): number | null {
		if (mode === "once") {
			// One-time: schedule is an ISO date string or Unix timestamp
			const ts = Number(schedule);
			const target = Number.isNaN(ts) ? new Date(schedule).getTime() : ts;
			if (Number.isNaN(target)) {
				console.warn(`[cron] Invalid one-time schedule: ${schedule}`);
				return null;
			}
			return target > Date.now() ? target : null;
		}

		if (mode === "interval") {
			// Interval: schedule is a duration string like "5m", "1h", "30s"
			const ms = parseDuration(schedule);
			if (!ms) {
				console.warn(`[cron] Invalid interval: ${schedule}`);
				return null;
			}
			return Date.now() + ms;
		}

		// Cron expression
		try {
			const interval = CronExpressionParser.parse(schedule);
			const next = interval.next();
			return next.getTime();
		} catch {
			console.warn(`[cron] Invalid schedule expression: ${schedule}`);
			return null;
		}
	}
}
