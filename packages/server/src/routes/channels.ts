import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { channelRegistry } from "../channels/registry";
import { getGateway } from "../gateway";

export const channelsRoute = new Hono()
	.get("/types", (c) => {
		// List all registered channel types with their required fields
		const types = channelRegistry.getTypes().map((type) => {
			const reg = channelRegistry.getRegistration(type);
			return {
				type,
				requiredFields: reg?.requiredFields ?? [],
				capabilities: reg?.capabilities,
			};
		});
		return c.json(types);
	})
	.get("/", (c) => {
		const gw = getGateway();
		const infos = gw.channelManager.getChannelInfos();

		// Include configured-but-not-connected channels too
		const config = gw.config.get();
		const result = [];

		for (const entry of config.channels) {
			for (const account of entry.accounts) {
				const info = infos.find((i) => i.type === entry.type && i.accountId === account.id);
				result.push({
					type: entry.type,
					accountId: account.id,
					enabled: entry.enabled,
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
	})
	.post(
		"/",
		zValidator(
			"json",
			z.object({
				type: z.string(),
				account: z.object({
					id: z.string(),
					token: z.string().optional(),
					botToken: z.string().optional(),
					appToken: z.string().optional(),
					appId: z.string().optional(),
					appSecret: z.string().optional(),
					dmPolicy: z.enum(["open", "allowlist", "pairing"]).default("allowlist"),
				}),
			}),
		),
		async (c) => {
			const { type, account } = c.req.valid("json");
			const gw = getGateway();
			const config = gw.config.get();

			// Add to config
			const channels = [...config.channels];
			let entry = channels.find((ch) => ch.type === type);
			if (!entry) {
				entry = { type, enabled: true, accounts: [] };
				channels.push(entry);
			}

			// Check for duplicate account
			if (entry.accounts.some((a) => a.id === account.id)) {
				return c.json({ error: `Account "${account.id}" already exists for ${type}` }, 409);
			}

			entry.accounts.push({
				...account,
				allowFrom: [],
				ownerIds: [],
			});

			await gw.config.patch({ channels });

			// Try to connect the new adapter
			const adapter = channelRegistry.create(type, account);
			if (adapter) {
				gw.channelManager.register(`${type}:${account.id}`, adapter);
				try {
					await adapter.connect();
				} catch {
					// Connection failed but config is saved
				}
			}

			return c.json(
				{ type, accountId: account.id, status: adapter?.status ?? "disconnected" },
				201,
			);
		},
	)
	.delete("/:type/:accountId", async (c) => {
		const type = c.req.param("type");
		const accountId = c.req.param("accountId");
		const gw = getGateway();

		// Disconnect adapter if active
		const adapter = gw.channelManager.getAdapter(`${type}:${accountId}`);
		if (adapter) {
			await adapter.disconnect();
			gw.channelManager.unregister(`${type}:${accountId}`);
		}

		// Remove from config
		const config = gw.config.get();
		const channels = config.channels
			.map((ch) => {
				if (ch.type !== type) return ch;
				return { ...ch, accounts: ch.accounts.filter((a) => a.id !== accountId) };
			})
			.filter((ch) => ch.accounts.length > 0);

		await gw.config.patch({ channels });

		return c.json({ deleted: true });
	});
