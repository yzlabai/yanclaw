import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { channelsRoute } from "./routes/channels";
import { agentsRoute } from "./routes/agents";
import { messagesRoute } from "./routes/messages";
import { wsRoute } from "./routes/ws";

const app = new Hono()
	.use("*", logger())
	.use("/api/*", cors({ origin: "http://localhost:1420" }));

const apiRoutes = app
	.basePath("/api")
	.route("/channels", channelsRoute)
	.route("/agents", agentsRoute)
	.route("/messages", messagesRoute)
	.route("/ws", wsRoute);

export type AppType = typeof apiRoutes;
export { app, apiRoutes };
