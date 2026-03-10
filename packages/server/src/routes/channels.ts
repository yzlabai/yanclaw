import { Hono } from "hono";
import { getGateway } from "../gateway";

export const channelsRoute = new Hono()
	.get("/", (c) => {
		const gw = getGateway();
		const infos = gw.channelManager.getChannelInfos();

		// Include configured-but-not-connected channels too
		const config = gw.config.get();
		const result = [];

		for (const [type, channelCfg] of Object.entries(config.channels)) {
			if (!channelCfg) continue;
			for (const account of channelCfg.accounts) {
				const info = infos.find((i) => i.type === type && i.accountId === account.id);
				result.push({
					type,
					accountId: account.id,
					enabled: channelCfg.enabled,
					status: info?.status ?? "disconnected",
				});
			}
		}

		return c.json(result);
	})
	.get("/:type/:accountId", (c) => {
		const type = c.req.param("type");
		const accountId = c.req.param("accountId");
		const gw = getGateway();

		const adapter = gw.channelManager.getAdapter(`${type}:${accountId}`);
		if (!adapter) {
			return c.json({ type, accountId, status: "disconnected" });
		}

		return c.json({
			type: adapter.type,
			accountId: adapter.id,
			status: adapter.status,
			capabilities: adapter.capabilities,
		});
	})
	.post("/:type/:accountId/connect", async (c) => {
		const type = c.req.param("type");
		const accountId = c.req.param("accountId");
		const gw = getGateway();

		const adapter = gw.channelManager.getAdapter(`${type}:${accountId}`);
		if (!adapter) {
			return c.json({ error: "Channel not found" }, 404);
		}

		try {
			await adapter.connect();
			return c.json({ status: adapter.status });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Connection failed" }, 500);
		}
	})
	.post("/:type/:accountId/disconnect", async (c) => {
		const type = c.req.param("type");
		const accountId = c.req.param("accountId");
		const gw = getGateway();

		const adapter = gw.channelManager.getAdapter(`${type}:${accountId}`);
		if (!adapter) {
			return c.json({ error: "Channel not found" }, 404);
		}

		await adapter.disconnect();
		return c.json({ status: adapter.status });
	});
