import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "../config/store";
import { log } from "../logger";

/**
 * Automatic token rotation with grace period.
 * During the grace period, both old and new tokens are accepted.
 */
export class TokenRotation {
	private currentToken: string;
	private previousToken: string | null = null;
	private graceDeadline = 0;
	private gracePeriodMs: number;
	private timer: ReturnType<typeof setInterval> | null = null;
	private graceTimer: ReturnType<typeof setTimeout> | null = null;
	private onRotate: (newToken: string) => void;

	constructor(opts: {
		initialToken: string;
		intervalHours: number;
		gracePeriodMinutes: number;
		onRotate: (newToken: string) => void;
	}) {
		this.currentToken = opts.initialToken;
		this.onRotate = opts.onRotate;
		this.gracePeriodMs = opts.gracePeriodMinutes * 60_000;

		if (opts.intervalHours > 0) {
			const intervalMs = opts.intervalHours * 3600_000;
			this.timer = setInterval(() => this.rotate(), intervalMs);
			this.timer.unref();
		}
	}

	/** Check if a token is valid (current or within grace period). */
	validate(token: string): boolean {
		if (token === this.currentToken) return true;
		if (this.previousToken && token === this.previousToken && Date.now() < this.graceDeadline) {
			return true;
		}
		return false;
	}

	/** Force an immediate rotation. */
	async rotate(): Promise<string> {
		const newToken = randomBytes(32).toString("hex");

		// Write new token to file BEFORE updating in-memory state
		try {
			const tokenPath = join(resolveDataDir(), "auth.token");
			await writeFile(tokenPath, newToken, "utf-8");
		} catch (err) {
			log.security().error({ err }, "failed to write rotated token, aborting rotation");
			return this.currentToken;
		}

		// Only update state after successful file write
		this.previousToken = this.currentToken;
		this.currentToken = newToken;
		this.graceDeadline = Date.now() + this.gracePeriodMs;

		// Schedule clearing of previousToken after grace period
		if (this.graceTimer) clearTimeout(this.graceTimer);
		this.graceTimer = setTimeout(() => {
			this.previousToken = null;
			this.graceDeadline = 0;
			this.graceTimer = null;
		}, this.gracePeriodMs);
		this.graceTimer.unref();

		this.onRotate(newToken);
		log.security().info("auth token rotated, grace period active");
		return newToken;
	}

	get token(): string {
		return this.currentToken;
	}

	/** Whether rotation is active (interval > 0). */
	get isActive(): boolean {
		return this.timer !== null;
	}

	/** Whether the grace period is currently active (both old and new tokens accepted). */
	get isInGracePeriod(): boolean {
		return this.previousToken !== null && Date.now() < this.graceDeadline;
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		if (this.graceTimer) {
			clearTimeout(this.graceTimer);
			this.graceTimer = null;
		}
	}
}
