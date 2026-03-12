import { Hono } from "hono";
import { getGateway } from "../gateway";

export const usageRoute = new Hono()
	.get("/summary", (c) => {
		const gw = getGateway();
		const days = Math.min(Math.max(Number(c.req.query("days") ?? 7) || 7, 1), 365);
		return c.json(gw.usageTracker.summary(days));
	})

	.get("/by-agent", (c) => {
		const gw = getGateway();
		const days = Math.min(Math.max(Number(c.req.query("days") ?? 7) || 7, 1), 365);
		return c.json(gw.usageTracker.byAgent(days));
	})

	.get("/by-model", (c) => {
		const gw = getGateway();
		const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
		return c.json(gw.usageTracker.byModel(days));
	})

	.get("/daily", (c) => {
		const gw = getGateway();
		const days = Math.min(Math.max(Number(c.req.query("days") ?? 30) || 30, 1), 365);
		return c.json(gw.usageTracker.daily(days));
	})

	.get("/recent", (c) => {
		const gw = getGateway();
		const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 500);
		const agentId = c.req.query("agentId") || undefined;
		return c.json(gw.usageTracker.recent(limit, agentId));
	});
