import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";
import { generateEmbedding } from "../memory/embeddings";

export const memoryRoute = new Hono()
	.get("/", async (c) => {
		const agentId = c.req.query("agentId") ?? "main";
		const limit = Number(c.req.query("limit") ?? "50");
		const offset = Number(c.req.query("offset") ?? "0");

		const gw = getGateway();
		const entries = await gw.memories.list(agentId, limit, offset);
		const total = await gw.memories.count(agentId);

		return c.json({ entries, total });
	})
	.get("/search", async (c) => {
		const agentId = c.req.query("agentId") ?? "main";
		const query = c.req.query("q") ?? "";
		const limit = Number(c.req.query("limit") ?? "10");

		if (!query) {
			return c.json({ results: [] });
		}

		const gw = getGateway();
		const config = gw.config.get();

		let queryEmbedding: Float32Array | undefined;
		if (config.memory.enabled) {
			try {
				queryEmbedding = await generateEmbedding(query, config);
			} catch {
				// Fall back to FTS only
			}
		}

		const results = await gw.memories.search(agentId, query, queryEmbedding, limit);
		return c.json({ results });
	})
	.post(
		"/",
		zValidator(
			"json",
			z.object({
				agentId: z.string().default("main"),
				content: z.string().min(1),
				tags: z.array(z.string()).optional(),
			}),
		),
		async (c) => {
			const body = c.req.valid("json");
			const gw = getGateway();
			const config = gw.config.get();

			let embedding: Float32Array | undefined;
			if (config.memory.enabled) {
				try {
					embedding = await generateEmbedding(body.content, config);
				} catch {
					// Store without embedding
				}
			}

			const id = await gw.memories.store({
				agentId: body.agentId,
				content: body.content,
				tags: body.tags,
				source: "user",
				embedding,
			});

			return c.json({ id }, 201);
		},
	)
	.patch(
		"/:id",
		zValidator(
			"json",
			z.object({
				content: z.string().min(1).optional(),
				tags: z.array(z.string()).optional(),
			}),
		),
		async (c) => {
			const id = c.req.param("id");
			const body = c.req.valid("json");
			const gw = getGateway();
			const config = gw.config.get();

			let embedding: Float32Array | undefined;
			if (body.content && config.memory.enabled) {
				try {
					embedding = await generateEmbedding(body.content, config);
				} catch {
					// Update without new embedding
				}
			}

			const updated = await gw.memories.update(id, {
				content: body.content,
				tags: body.tags,
				embedding,
			});

			if (!updated) {
				return c.json({ error: "Memory not found" }, 404);
			}

			return c.json({ updated: true });
		},
	)
	.delete("/:id", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();
		const deleted = await gw.memories.delete(id);

		if (!deleted) {
			return c.json({ error: "Memory not found" }, 404);
		}

		return c.json({ deleted: true });
	});
