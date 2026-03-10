import { Hono } from "hono";
import { getGateway } from "../gateway";

export const auditRoute = new Hono().get("/", (c) => {
	const gw = getGateway();
	if (!gw.auditLogger) {
		return c.json({ logs: [], total: 0 });
	}

	const action = c.req.query("action");
	const actor = c.req.query("actor");
	const after = c.req.query("after");
	const before = c.req.query("before");
	const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 1000);
	const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);

	const result = gw.auditLogger.query({ action, actor, after, before, limit, offset });
	return c.json(result);
});
