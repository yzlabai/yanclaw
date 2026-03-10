import { createBunWebSocket } from "hono/bun";
import { app } from "./app";
import { ConfigStore } from "./config";
import { initDatabase } from "./db";
import {
	initGateway,
	runSessionCleanup,
	startChannels,
	startCron,
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

	// 5. Load plugins
	await startPlugins(gw);

	// 6. Start channels (Telegram, Discord, Slack)
	await startChannels(gw);

	// 7. Start cron scheduler
	startCron(gw);

	// 8. Session/media cleanup
	runSessionCleanup(gw);

	// 9. Memory auto-indexer
	await startMemoryIndexer(gw);

	// 10. Hot-reload listener
	configStore.onChange((_newConfig) => {
		console.log("[gateway] Config reloaded");
	});
}

main().catch((err) => {
	console.error("Failed to start gateway:", err);
	process.exit(1);
});
