import { APP_NAME, VERSION } from "@yanclaw/shared/constants";
import { Hono } from "hono";
import { getGateway } from "../gateway";

export const systemRoute = new Hono()
	.get("/health", (c) => {
		const gw = getGateway();
		const config = gw.config.get();
		return c.json({
			status: "ok",
			name: APP_NAME,
			version: VERSION,
			gateway: {
				port: config.gateway.port,
				bind: config.gateway.bind,
			},
		});
	})
	.get("/status", (c) => {
		const gw = getGateway();
		const config = gw.config.get();
		const { total } = gw.sessions.listSessions({ limit: 0 });

		return c.json({
			agents: { count: config.agents.length },
			channels: { total: Object.keys(config.channels).length },
			sessions: { total },
			cron: { total: config.cron.tasks.length },
		});
	});
