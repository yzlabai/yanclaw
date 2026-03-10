import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";
import { agentsRoute } from "./routes/agents";
import { approvalsRoute } from "./routes/approvals";
import { channelsRoute } from "./routes/channels";
import { chatRoute } from "./routes/chat";
import { configRoute } from "./routes/config";
import { cronRoute } from "./routes/cron";
import { mediaRoute } from "./routes/media";
import { memoryRoute } from "./routes/memory";
import { messagesRoute } from "./routes/messages";
import { pluginsRoute } from "./routes/plugins";
import { sessionsRoute } from "./routes/sessions";
import { systemRoute } from "./routes/system";
import { wsRoute } from "./routes/ws";

const app = new Hono()
	.use("*", logger())
	.use("/api/*", cors({ origin: ["http://localhost:1420", "http://localhost:5173"] }))
	.use("/api/*", authMiddleware);

const apiRoutes = app
	.basePath("/api")
	.route("/chat", chatRoute)
	.route("/agents", agentsRoute)
	.route("/approvals", approvalsRoute)
	.route("/channels", channelsRoute)
	.route("/sessions", sessionsRoute)
	.route("/config", configRoute)
	.route("/cron", cronRoute)
	.route("/media", mediaRoute)
	.route("/memory", memoryRoute)
	.route("/messages", messagesRoute)
	.route("/plugins", pluginsRoute)
	.route("/system", systemRoute)
	.route("/ws", wsRoute);

export type AppType = typeof apiRoutes;
export { app, apiRoutes };
