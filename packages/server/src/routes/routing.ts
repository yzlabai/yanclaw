import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { bindingSchema } from "../config/schema";
import { getGateway } from "../gateway";
import { resolveRoute, resolveRouteDebug } from "../routing/resolve";

const addBindingSchema = bindingSchema;

const updateRoutingSchema = z.object({
	default: z.string().optional(),
	dmScope: z.enum(["main", "per-peer", "per-channel-peer", "per-account-peer"]).optional(),
});

const testQuerySchema = z.object({
	channel: z.string(),
	peer: z.string().optional(),
	guild: z.string().optional(),
	account: z.string().optional(),
	debug: z.string().optional(),
});

export const routingRoute = new Hono()
	// GET /api/routing — full routing config
	.get("/", (c) => {
		const config = getGateway().config.get();
		return c.json(config.routing);
	})
	// GET /api/routing/bindings — bindings list
	.get("/bindings", (c) => {
		const config = getGateway().config.get();
		return c.json(config.routing.bindings ?? []);
	})
	// POST /api/routing/bindings — add a binding
	.post("/bindings", zValidator("json", addBindingSchema), async (c) => {
		const gw = getGateway();
		const binding = c.req.valid("json");
		const config = gw.config.get();
		const bindings = [...(config.routing.bindings ?? []), binding];
		await gw.config.patch({ routing: { ...config.routing, bindings } });
		return c.json(binding, 201);
	})
	// DELETE /api/routing/bindings/:index — remove binding by index
	.delete("/bindings/:index", async (c) => {
		const gw = getGateway();
		const index = Number(c.req.param("index"));
		const config = gw.config.get();
		const bindings = [...(config.routing.bindings ?? [])];
		if (index < 0 || index >= bindings.length) {
			return c.json({ error: "Binding not found" }, 404);
		}
		bindings.splice(index, 1);
		await gw.config.patch({ routing: { ...config.routing, bindings } });
		return c.json({ deleted: true });
	})
	// PATCH /api/routing — update default agent and dmScope
	.patch("/", zValidator("json", updateRoutingSchema), async (c) => {
		const gw = getGateway();
		const patch = c.req.valid("json");
		const config = gw.config.get();
		await gw.config.patch({ routing: { ...config.routing, ...patch } });
		return c.json({ ok: true });
	})
	// GET /api/routing/test — test route resolution (add ?debug=true for score breakdown)
	.get("/test", zValidator("query", testQuerySchema), (c) => {
		const gw = getGateway();
		const query = c.req.valid("query");
		const config = gw.config.get();
		const ctx = {
			channel: query.channel,
			accountId: query.account ?? "",
			peerId: query.peer ?? "test-peer",
			peerName: "test",
			guildId: query.guild,
		};
		if (query.debug === "true") {
			return c.json(resolveRouteDebug(config, ctx));
		}
		return c.json(resolveRoute(config, ctx));
	});
