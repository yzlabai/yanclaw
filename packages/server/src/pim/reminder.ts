import type { PimConfig } from "../config/schema";
import { log } from "../logger";
import type { PimStore } from "./store";

type NotifyFn = (message: string) => void;

/**
 * PIM Reminder — periodic check for:
 * 1. Tasks (event/task) approaching deadline
 * 2. Meetings (event/meeting) about to start
 * 3. Clients (person with relation=客户) not contacted recently
 */
export class PimReminder {
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(
		private store: PimStore,
		private notify: NotifyFn,
		private getConfig: () => PimConfig,
	) {}

	start(): void {
		if (this.timer) return;
		// Check every 30 minutes
		this.timer = setInterval(() => this.check(), 30 * 60_000);
		// Also run once on start (delayed slightly to let everything initialize)
		setTimeout(() => this.check(), 5000);
		log.gateway().info("PIM reminder started (interval: 30min)");
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
	}

	private async check(): Promise<void> {
		const cfg = this.getConfig();
		if (!cfg.enabled || !cfg.reminders.enabled) return;

		try {
			await this.checkTaskDeadlines(cfg.reminders.taskDeadlineHours);
			await this.checkUpcomingMeetings(cfg.reminders.scheduleMinutes);
			await this.checkStaleContacts(cfg.reminders.followUpDays);
		} catch (err) {
			log.gateway().warn({ err }, "PIM reminder check failed");
		}
	}

	private async checkTaskDeadlines(deadlineHours: number): Promise<void> {
		const cutoff = new Date(Date.now() + deadlineHours * 3_600_000).toISOString();
		const tasks = await this.store.getUnremindedEvents({
			subtype: "task",
			status: "pending",
			datetimeBefore: cutoff,
		});

		for (const task of tasks) {
			this.notify(
				`\u23F0 待办即将到期: ${task.title}${task.datetime ? ` (截止: ${task.datetime})` : ""}`,
			);
			await this.store.markReminded(task.id);
		}
	}

	private async checkUpcomingMeetings(minutes: number): Promise<void> {
		const cutoff = new Date(Date.now() + minutes * 60_000).toISOString();
		const meetings = await this.store.getUnremindedEvents({
			subtype: "meeting",
			datetimeBefore: cutoff,
		});

		for (const meeting of meetings) {
			this.notify(
				`\uD83D\uDCC5 即将开始: ${meeting.title}${meeting.datetime ? ` (${meeting.datetime})` : ""}`,
			);
			await this.store.markReminded(meeting.id);
		}
	}

	private async checkStaleContacts(followUpDays: number): Promise<void> {
		const stale = await this.store.getStaleContacts(followUpDays);
		for (const contact of stale) {
			this.notify(`\uD83D\uDC64 ${contact.title} 已 ${contact.daysSince} 天未联系，建议跟进`);
		}
	}
}
