import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { authMiddleware } from "./middleware/auth";
import { rateLimiter } from "./middleware/rate-limit";
import { agentsRoute } from "./routes/agents";
import { approvalsRoute } from "./routes/approvals";
import { auditRoute } from "./routes/audit";
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
	.use(
		"/api/*",
		cors({
			origin: [
				"http://localhost:1420",
				"http://localhost:5173",
				"http://tauri.localhost",
				"https://tauri.localhost",
			],
		}),
	)
	.use("/api/*", authMiddleware)
	.use("/api/*", rateLimiter({ windowMs: 60_000, max: 60 }))
	.use("/api/chat/*", rateLimiter({ windowMs: 60_000, max: 10 }))
	.use("/api/approvals/*", rateLimiter({ windowMs: 60_000, max: 30 }));

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
	.route("/audit", auditRoute)
	.route("/ws", wsRoute);

export type AppType = typeof apiRoutes;
export { app, apiRoutes };
