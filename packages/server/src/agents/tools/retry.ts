import type { RetryConfig } from "../../config/schema";
import { log } from "../../logger";

/** Errors that should NOT be retried (permanent failures). */
const PERMANENT_PATTERNS = [
	/\b(401|403)\b/, // Auth/authz
	/\b404\b/, // Not found
	/\b400\b/, // Bad request
	/permission denied/i,
	/invalid (api.?key|token)/i,
	/EACCES/,
];

/** Errors that SHOULD be retried (transient failures). */
const TRANSIENT_PATTERNS = [
	/\b429\b/, // Rate limit
	/\b(502|503|504)\b/, // Server errors
	/ECONNRESET/,
	/ETIMEDOUT/,
	/ECONNREFUSED/,
	/ENOTFOUND/,
	/socket hang up/i,
	/network/i,
	/timeout/i,
	/temporarily unavailable/i,
	/fetch failed/i,
];

/** Check if an error is transient (worth retrying). */
export function isTransientError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error);
	if (PERMANENT_PATTERNS.some((p) => p.test(msg))) return false;
	return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

/** Parse Retry-After header value to milliseconds. */
export function parseRetryAfter(value: string | null | undefined): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (!Number.isNaN(seconds)) return seconds * 1000;
	const date = Date.parse(value);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return null;
}

/** Compute delay for a retry attempt. */
export function computeDelay(
	attempt: number,
	config: RetryConfig,
	retryAfterMs?: number | null,
): number {
	if (retryAfterMs && retryAfterMs > 0) {
		return Math.min(retryAfterMs, config.maxDelayMs);
	}
	let delay: number;
	switch (config.backoff) {
		case "exponential":
			delay = config.baseDelayMs * 2 ** attempt;
			break;
		case "linear":
			delay = config.baseDelayMs * (attempt + 1);
			break;
		case "fixed":
			delay = config.baseDelayMs;
			break;
	}
	// Apply jitter: delay × (1 ± jitter)
	const jitter = delay * config.jitter * (2 * Math.random() - 1);
	return Math.min(Math.max(0, delay + jitter), config.maxDelayMs);
}

/**
 * Wrap an async function with retry logic.
 * Only retries on transient errors. Permanent errors throw immediately.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	config: RetryConfig,
	context?: { tool?: string; correlationId?: string },
): Promise<T> {
	const rlog = log.agent();
	let lastError: unknown;

	for (let attempt = 0; attempt < config.attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			const isLast = attempt >= config.attempts - 1;
			if (!isTransientError(err) || isLast) {
				if (attempt > 0) {
					rlog.warn(
						{
							tool: context?.tool,
							attempt: attempt + 1,
							correlationId: context?.correlationId,
							err: String(err),
						},
						"retry exhausted",
					);
				}
				throw err;
			}
			const delay = computeDelay(attempt, config);
			rlog.warn(
				{
					tool: context?.tool,
					attempt: attempt + 1,
					maxAttempts: config.attempts,
					delayMs: Math.round(delay),
					correlationId: context?.correlationId,
					err: String(err),
				},
				"transient error, retrying",
			);
			await Bun.sleep(delay);
		}
	}
	throw lastError;
}

/** Tools that can be safely retried (idempotent / read-only). */
export const RETRYABLE_TOOLS = new Set([
	"web_fetch",
	"web_search",
	"memory_search",
	"memory_list",
	"browser_navigate",
	"browser_screenshot",
]);
