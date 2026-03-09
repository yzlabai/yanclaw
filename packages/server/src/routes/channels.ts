import { Hono } from "hono";
import { getGateway } from "../gateway";

export const channelsRoute = new Hono()
	.get("/", (c) => {
		const config = getGateway().config.get();
		const channels = Object.entries(config.channels)
			.filter(([, cfg]) => cfg?.enabled)
			.map(([type, cfg]) => ({
				type,
				enabled: cfg?.enabled,
				accounts: cfg?.accounts.map((a) => ({
					id: a.id,
					status: "disconnected" as const,
				})),
			}));
		return c.json(channels);
	})
	.get("/:id", (c) => {
		const id = c.req.param("id");
		return c.json({ id, status: "disconnected" });
	});
