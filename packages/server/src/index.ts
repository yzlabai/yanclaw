import { createBunWebSocket } from "hono/bun";
import { app } from "./app";
import { ConfigStore } from "./config";
import { initDatabase } from "./db";
import {
	initGateway,
	runSessionCleanup,
	startChannels,
	startCron,
	startHeartbeats,
	startMcp,
	startMemoryIndexer,
	startPlugins,
} from "./gateway";

const { websocket } = createBunWebSocket();

async function main() {
	// 1. Load config
	const configStore = await ConfigStore.load();
	const config = configStore.get();

	// 2. Initialize database
	initDatabase();

	// 3. Initialize gateway context
	const gw = initGateway(configStore);

	// 4. Start HTTP server
	const port = config.gateway.port;
	const hostname = config.gateway.bind === "lan" ? "0.0.0.0" : "127.0.0.1";

	const server = Bun.serve({
		port,
		hostname,
		fetch: app.fetch,
		websocket,
	});

	console.log(`YanClaw Gateway running on http://${hostname}:${server.port}`);

	// 5. Start MCP servers
	await startMcp(gw);

	// 6. Load plugins
	await startPlugins(gw);

	// 7. Start channels (Telegram, Discord, Slack)
	await startChannels(gw);

	// 8. Start cron scheduler
	startCron(gw);

	// 8.5. Start heartbeats
	startHeartbeats(gw);

	// 9. Session/media cleanup
	runSessionCleanup(gw);

	// 10. Memory auto-indexer
	await startMemoryIndexer(gw);

	// 11. Hot-reload listener
	configStore.onChange((_newConfig) => {
		console.log("[gateway] Config reloaded");
	});
}

main().catch((err) => {
	console.error("Failed to start gateway:", err);
	process.exit(1);
});
