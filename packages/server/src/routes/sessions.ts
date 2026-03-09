import { Hono } from "hono";
import { getGateway } from "../gateway";

export const sessionsRoute = new Hono()
	.get("/", (c) => {
		const gw = getGateway();
		const agentId = c.req.query("agentId");
		const channel = c.req.query("channel");
		const limit = Number(c.req.query("limit")) || 20;
		const offset = Number(c.req.query("offset")) || 0;

		const result = gw.sessions.listSessions({ agentId, channel, limit, offset });
		return c.json(result);
	})
	.get("/:key", (c) => {
		const gw = getGateway();
		const key = decodeURIComponent(c.req.param("key"));
		const session = gw.sessions.getSession(key);
		if (!session) return c.json({ error: "Session not found" }, 404);

		const messages = gw.sessions.loadMessages(key);
		return c.json({ ...session, messages });
	})
	.delete("/:key", (c) => {
		const gw = getGateway();
		const key = decodeURIComponent(c.req.param("key"));
		const deleted = gw.sessions.deleteSession(key);
		if (!deleted) return c.json({ error: "Session not found" }, 404);
		return c.json({ deleted: true });
	});
