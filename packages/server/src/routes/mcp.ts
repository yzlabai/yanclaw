import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";

export const mcpRoute = new Hono()
	.get("/servers", (c) => {
		const gw = getGateway();
		const config = gw.config.get();
		const status = gw.mcpClientManager.getStatus();

		const servers = Object.entries(config.mcp?.servers ?? {}).map(([name, cfg]) => ({
			name,
			enabled: cfg.enabled !== false,
			mode: cfg.command ? "stdio" : "http",
			status: status[name]?.status ?? "closed",
			toolCount: status[name]?.toolCount ?? 0,
		}));

		return c.json(servers);
	})
	.get("/servers/:name/tools", async (c) => {
		const name = c.req.param("name");
		const gw = getGateway();

		const tools = await gw.mcpClientManager.listTools(name);
		return c.json({ server: name, tools });
	})
	.post("/servers/:name/start", async (c) => {
		const name = c.req.param("name");
		const gw = getGateway();
		const config = gw.config.get();

		const serverConfig = config.mcp?.servers?.[name];
		if (!serverConfig) {
			return c.json({ error: `MCP server "${name}" not found in config` }, 404);
		}

		await gw.mcpClientManager.start(name, serverConfig);
		const status = gw.mcpClientManager.getStatus();
		return c.json({ name, ...status[name] });
	})
	.post("/servers/:name/stop", async (c) => {
		const name = c.req.param("name");
		const gw = getGateway();

		await gw.mcpClientManager.stop(name);
		return c.json({ name, status: "closed" });
	})
	.post(
		"/registry/search",
		zValidator(
			"json",
			z.object({
				query: z.string(),
				limit: z.number().default(20),
			}),
		),
		async (c) => {
			const { query, limit } = c.req.valid("json");

			try {
				const url = `https://registry.modelcontextprotocol.io/servers?q=${encodeURIComponent(query)}&count=${limit}`;
				const res = await fetch(url, {
					headers: { Accept: "application/json" },
					signal: AbortSignal.timeout(10_000),
				});

				if (!res.ok) {
					return c.json({ servers: [], error: `Registry returned ${res.status}` });
				}

				const data = await res.json();
				return c.json(data);
			} catch (err) {
				return c.json({
					servers: [],
					error: err instanceof Error ? err.message : "Registry search failed",
				});
			}
		},
	);
