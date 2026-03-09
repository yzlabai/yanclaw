import { app } from "./app";
import { createBunWebSocket } from "hono/bun";

const { websocket } = createBunWebSocket();

const port = Number(process.env.PORT) || 18789;

const server = Bun.serve({
	port,
	fetch: app.fetch,
	websocket,
});

console.log(`YanClaw Gateway running on http://localhost:${server.port}`);
