import { Hono } from "hono";

export const channelsRoute = new Hono()
	.get("/", async (c) => {
		// TODO: return connected channel status
		return c.json({ channels: [] });
	})
	.get("/:id", async (c) => {
		const id = c.req.param("id");
		return c.json({ id, status: "disconnected" });
	});
