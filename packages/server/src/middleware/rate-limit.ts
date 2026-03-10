import type { Context, MiddlewareHandler } from "hono";

interface RateLimiterOptions {
	/** Window size in milliseconds. Default: 60000 (1 minute). */
	windowMs?: number;
	/** Max requests per window. Default: 60. */
	max?: number;
	/** Custom key generator. Default: client IP. */
	keyGenerator?: (c: Context) => string;
}

/**
 * Sliding-window rate limiter middleware for Hono.
 * Uses an in-memory Map — suitable for single-process Bun server.
 */
export function rateLimiter(opts: RateLimiterOptions = {}): MiddlewareHandler {
	const windowMs = opts.windowMs ?? 60_000;
	const max = opts.max ?? 60;
	const keyGen = opts.keyGenerator ?? getClientKey;

	const hits = new Map<string, number[]>();

	// Periodic cleanup of expired entries
	setInterval(() => {
		const now = Date.now();
		for (const [key, timestamps] of hits) {
			const valid = timestamps.filter((t) => now - t < windowMs);
			if (valid.length === 0) {
				hits.delete(key);
			} else {
				hits.set(key, valid);
			}
		}
	}, 60_000).unref();

	return async (c, next) => {
		const key = keyGen(c);
		const now = Date.now();
		// Filter to only timestamps within the current window
		const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

		if (timestamps.length >= max) {
			const retryAfter = Math.ceil((timestamps[0] + windowMs - now) / 1000);
			c.header("Retry-After", String(Math.max(retryAfter, 1)));
			return c.json({ error: "Too many requests" }, 429);
		}

		timestamps.push(now);
		hits.set(key, timestamps); // Already filtered, no memory bloat
		await next();
	};
}

function getClientKey(c: Context): string {
	// Prefer auth token for rate limiting (not spoofable), fall back to IP
	const auth = c.req.header("Authorization");
	if (auth) {
		// Use a hash-like prefix of the token (avoid storing full token)
		return `auth:${auth.slice(-16)}`;
	}
	return (
		c.req.header("x-real-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown"
	);
}
