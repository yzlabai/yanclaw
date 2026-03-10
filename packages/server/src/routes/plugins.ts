import { Hono } from "hono";
import { getGateway } from "../gateway";

export const pluginsRoute = new Hono().get("/", (c) => {
	const gw = getGateway();
	const plugins = gw.pluginRegistry.getAllPlugins().map((p) => ({
		id: p.id,
		name: p.name,
		version: p.version,
		tools: p.tools?.map((t) => t.name) ?? [],
		channels: p.channels?.map((ch) => ch.type) ?? [],
		hasHooks: !!p.hooks,
	}));
	return c.json(plugins);
});
