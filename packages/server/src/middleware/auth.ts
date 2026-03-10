import { createMiddleware } from "hono/factory";
import { getGateway } from "../gateway";

/** Paths that do not require authentication. */
const PUBLIC_PATHS = new Set(["/api/system/health", "/api/system/setup"]);

/**
 * Bearer token authentication middleware.
 * Validates `Authorization: Bearer <token>` against the runtime auth token.
 * WebSocket upgrades and public health/setup endpoints are exempt.
 */
export const authMiddleware = createMiddleware(async (c, next) => {
	// Skip auth for public endpoints
	if (PUBLIC_PATHS.has(c.req.path)) {
		return next();
	}

	// Skip auth for WebSocket upgrade requests (ws.ts handles its own flow)
	if (c.req.header("upgrade")?.toLowerCase() === "websocket") {
		return next();
	}

	const authHeader = c.req.header("Authorization");
	if (!authHeader) {
		return c.json({ error: "Missing Authorization header" }, 401);
	}

	const match = authHeader.match(/^Bearer\s+(.+)$/i);
	if (!match) {
		return c.json({ error: "Invalid Authorization format, expected: Bearer <token>" }, 401);
	}

	const token = match[1];
	const expectedToken = getGateway().config.get().gateway.auth.token;

	if (!expectedToken || token !== expectedToken) {
		return c.json({ error: "Invalid auth token" }, 401);
	}

	return next();
});
