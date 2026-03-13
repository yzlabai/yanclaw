import { APP_NAME, VERSION } from "@yanclaw/shared/constants";
import { Hono } from "hono";
import { getGateway } from "../gateway";

const startedAt = Date.now();

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
	.get("/status", async (c) => {
		const gw = getGateway();
		const config = gw.config.get();
		const { total: sessionTotal } = gw.sessions.listSessions({ limit: 0 });

		// Channel connection status grouped by type
		const channelInfos = gw.channelManager.getChannelInfos();
		const channels: Record<string, { status: string; accounts: number }> = {};
		for (const info of channelInfos) {
			const existing = channels[info.type];
			if (existing) {
				existing.accounts++;
				if (info.status === "connected") existing.status = "connected";
			} else {
				channels[info.type] = { status: info.status, accounts: 1 };
			}
		}

		// Memory entry count (sum across all agents)
		let memoryEntries = 0;
		if (config.memory?.enabled) {
			for (const agent of config.agents) {
				memoryEntries += await gw.memories.count(agent.id);
			}
		}

		return c.json({
			name: APP_NAME,
			version: VERSION,
			status: "running",
			uptime: Math.floor((Date.now() - startedAt) / 1000),
			pid: process.pid,
			port: config.gateway.port,
			agents: config.agents.map((a) => ({ id: a.id, name: a.name, model: a.model })),
			channels,
			sessions: { active: sessionTotal },
			memory: {
				enabled: !!config.memory?.enabled,
				entries: memoryEntries,
			},
			cron: { tasks: config.cron.tasks.length },
			stt: { available: gw.sttService.isAvailable(config) },
		});
	})
	.get("/setup", (c) => {
		const config = getGateway().config.get();

		// Setup is complete if at least one model provider is configured with profiles
		const hasProvider = Object.values(config.models.providers).some(
			(p) => p.profiles.some((prof) => !!prof.apiKey) || p.type === "ollama",
		);

		return c.json({ needsSetup: !hasProvider });
	})
	.post("/shutdown", async (c) => {
		const gw = getGateway();

		// Respond first, then shut down
		setTimeout(async () => {
			console.log("[gateway] Shutdown requested via API");
			await gw.mcpClientManager.stopAll();
			await gw.channelManager.disconnectAll();
			gw.channelManager.stopHealthMonitor();
			gw.cronService.stop();
			process.exit(0);
		}, 100);

		return c.json({ message: "Shutting down..." });
	});
