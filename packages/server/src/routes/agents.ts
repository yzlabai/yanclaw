import { Hono } from "hono";

export const agentsRoute = new Hono()
	.get("/", async (c) => {
		// TODO: list configured agents
		return c.json({ agents: [] });
	})
	.get("/:id/sessions", async (c) => {
		const agentId = c.req.param("id");
		// TODO: query sessions from db
		return c.json({ agentId, sessions: [] });
	});
