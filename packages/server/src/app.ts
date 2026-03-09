import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { agentsRoute } from "./routes/agents";
import { channelsRoute } from "./routes/channels";
import { chatRoute } from "./routes/chat";
import { configRoute } from "./routes/config";
import { messagesRoute } from "./routes/messages";
import { sessionsRoute } from "./routes/sessions";
import { systemRoute } from "./routes/system";
import { wsRoute } from "./routes/ws";

const app = new Hono()
	.use("*", logger())
	.use("/api/*", cors({ origin: ["http://localhost:1420", "http://localhost:5173"] }));

const apiRoutes = app
	.basePath("/api")
	.route("/chat", chatRoute)
	.route("/agents", agentsRoute)
	.route("/channels", channelsRoute)
	.route("/sessions", sessionsRoute)
	.route("/config", configRoute)
	.route("/messages", messagesRoute)
	.route("/system", systemRoute)
	.route("/ws", wsRoute);

export type AppType = typeof apiRoutes;
export { app, apiRoutes };
