import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";
import { PIM_CATEGORIES } from "../pim/types";

const categoryEnum = z.enum(PIM_CATEGORIES as unknown as [string, ...string[]]);

export const pimRoute = new Hono()
	// ── Items ──────────────────────────────────────────

	.get("/items", (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		const category = c.req.query("category") as Parameters<typeof gw.pimStore.query>[0]["category"];
		const subtype = c.req.query("subtype");
		const status = c.req.query("status");
		const q = c.req.query("q");
		const limit = Number(c.req.query("limit")) || 50;
		const offset = Number(c.req.query("offset")) || 0;

		return gw.pimStore
			.query({ category, subtype, status, q, limit, offset })
			.then((items) => c.json(items));
	})

	.get("/items/:id", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		const item = await gw.pimStore.inspect(c.req.param("id"));
		if (!item) return c.json({ error: "Not found" }, 404);
		return c.json(item);
	})

	.post(
		"/items",
		zValidator(
			"json",
			z.object({
				category: categoryEnum,
				subtype: z.string().optional(),
				title: z.string().min(1),
				content: z.string().optional(),
				properties: z.record(z.unknown()).optional(),
				tags: z.array(z.string()).optional(),
				status: z.string().optional(),
				datetime: z.string().optional(),
				confidence: z.number().min(0).max(1).optional(),
				agentId: z.string().optional(),
			}),
		),
		async (c) => {
			const gw = getGateway();
			if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

			const body = c.req.valid("json");
			const id = await gw.pimStore.create(body);
			return c.json({ id }, 201);
		},
	)

	.patch(
		"/items/:id",
		zValidator(
			"json",
			z.object({
				title: z.string().optional(),
				content: z.string().optional(),
				properties: z.record(z.unknown()).optional(),
				tags: z.array(z.string()).optional(),
				status: z.string().optional(),
				datetime: z.string().optional(),
				subtype: z.string().optional(),
			}),
		),
		async (c) => {
			const gw = getGateway();
			if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

			const ok = await gw.pimStore.update(c.req.param("id"), c.req.valid("json"));
			if (!ok) return c.json({ error: "Not found" }, 404);
			return c.json({ ok: true });
		},
	)

	.delete("/items/:id", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		const ok = await gw.pimStore.delete(c.req.param("id"));
		if (!ok) return c.json({ error: "Not found" }, 404);
		return c.json({ ok: true });
	})

	// ── Links ─────────────────────────────────────────

	.get("/links", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		const fromId = c.req.query("from");
		if (!fromId) return c.json({ error: "Missing 'from' query param" }, 400);
		const links = await gw.pimStore.getLinks(fromId);
		return c.json(links);
	})

	.post(
		"/links",
		zValidator(
			"json",
			z.object({
				fromId: z.string(),
				toId: z.string(),
				type: z.string().min(1),
				properties: z.record(z.unknown()).optional(),
			}),
		),
		async (c) => {
			const gw = getGateway();
			if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

			const body = c.req.valid("json");
			const id = await gw.pimStore.createLink(body);
			return c.json({ id }, 201);
		},
	)

	.delete("/links/:id", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		const ok = await gw.pimStore.deleteLink(c.req.param("id"));
		if (!ok) return c.json({ error: "Not found" }, 404);
		return c.json({ ok: true });
	})

	// ── Aggregate views ───────────────────────────────

	.get("/stats", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);
		const stats = await gw.pimStore.stats();
		return c.json(stats);
	})

	.get("/timeline", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		const days = Number(c.req.query("days")) || 7;
		const limit = Number(c.req.query("limit")) || 50;
		const items = await gw.pimStore.timeline(days, limit);
		return c.json(items);
	})

	.get("/ledger/summary", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		const month = c.req.query("month");
		if (!month) return c.json({ error: "Missing 'month' param (YYYY-MM)" }, 400);
		const summary = await gw.pimStore.ledgerSummary(month);
		return c.json(summary);
	})

	.get("/graph", async (c) => {
		const gw = getGateway();
		if (!gw.pimStore) return c.json({ error: "PIM not enabled" }, 503);

		// Return all items except ledger (not network nodes) + all links
		const items = await gw.pimStore.query({ limit: 500 });
		const nodes = items.filter((i) => i.category !== "ledger");

		// Collect links for all nodes
		const linkSet = new Map<string, { fromId: string; toId: string; type: string }>();
		for (const node of nodes) {
			const links = await gw.pimStore.getLinks(node.id);
			for (const link of links) {
				if (!linkSet.has(link.id)) {
					linkSet.set(link.id, { fromId: link.fromId, toId: link.toId, type: link.type });
				}
			}
		}

		return c.json({
			nodes: nodes.map((n) => ({
				id: n.id,
				category: n.category,
				subtype: n.subtype,
				title: n.title,
			})),
			edges: Array.from(linkSet.values()),
		});
	});
