import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getRawDatabase } from "../db/sqlite";
import { getGateway } from "../gateway";
import { chunkCsv, chunkJson, chunkMarkdown, chunkPlainText } from "../memory/chunker";
import { generateEmbedding } from "../memory/embeddings";

export const memoryRoute = new Hono()
	.get("/stats", async (c) => {
		const agentId = c.req.query("agentId");
		const rawDb = getRawDatabase();

		// Total count (optionally filtered by agent)
		const totalRow = agentId
			? rawDb
					.query<{ count: number }, [string]>(
						"SELECT COUNT(*) as count FROM memories WHERE agent_id = ?",
					)
					.get(agentId)
			: rawDb.query<{ count: number }, []>("SELECT COUNT(*) as count FROM memories").get();
		const total = totalRow?.count ?? 0;

		// Count by agent
		const agentRows = agentId
			? rawDb
					.query<{ agent_id: string; count: number }, [string]>(
						"SELECT agent_id, COUNT(*) as count FROM memories WHERE agent_id = ? GROUP BY agent_id",
					)
					.all(agentId)
			: rawDb
					.query<{ agent_id: string; count: number }, []>(
						"SELECT agent_id, COUNT(*) as count FROM memories GROUP BY agent_id",
					)
					.all();
		const byAgent: Record<string, number> = {};
		for (const row of agentRows) {
			byAgent[row.agent_id] = row.count;
		}

		// Count by source
		const sourceRows = agentId
			? rawDb
					.query<{ source: string | null; count: number }, [string]>(
						"SELECT source, COUNT(*) as count FROM memories WHERE agent_id = ? GROUP BY source",
					)
					.all(agentId)
			: rawDb
					.query<{ source: string | null; count: number }, []>(
						"SELECT source, COUNT(*) as count FROM memories GROUP BY source",
					)
					.all();
		const bySource: Record<string, number> = {};
		for (const row of sourceRows) {
			bySource[row.source ?? "unknown"] = row.count;
		}

		// Top tags using json_each to unnest JSON array tags
		const tagQuery = agentId
			? `SELECT j.value as tag, COUNT(*) as count
			   FROM memories m, json_each(m.tags) j
			   WHERE m.tags IS NOT NULL AND m.agent_id = ?
			   GROUP BY j.value
			   ORDER BY count DESC
			   LIMIT 50`
			: `SELECT j.value as tag, COUNT(*) as count
			   FROM memories m, json_each(m.tags) j
			   WHERE m.tags IS NOT NULL
			   GROUP BY j.value
			   ORDER BY count DESC
			   LIMIT 50`;
		const topTags = agentId
			? rawDb.query<{ tag: string; count: number }, [string]>(tagQuery).all(agentId)
			: rawDb.query<{ tag: string; count: number }, []>(tagQuery).all();

		return c.json({ total, byAgent, bySource, topTags });
	})
	.get("/tags", async (c) => {
		const rawDb = getRawDatabase();
		const agentId = c.req.query("agentId");

		const query = agentId
			? `SELECT j.value as tag, COUNT(*) as count
			   FROM memories m, json_each(m.tags) j
			   WHERE m.tags IS NOT NULL AND m.agent_id = ?
			   GROUP BY j.value
			   ORDER BY count DESC`
			: `SELECT j.value as tag, COUNT(*) as count
			   FROM memories m, json_each(m.tags) j
			   WHERE m.tags IS NOT NULL
			   GROUP BY j.value
			   ORDER BY count DESC`;

		const tags = agentId
			? rawDb.query<{ tag: string; count: number }, [string]>(query).all(agentId)
			: rawDb.query<{ tag: string; count: number }, []>(query).all();

		return c.json({ tags });
	})
	.delete(
		"/batch",
		zValidator(
			"json",
			z.object({
				ids: z.array(z.string()).min(1).max(500),
			}),
		),
		async (c) => {
			const { ids } = c.req.valid("json");
			const rawDb = getRawDatabase();

			const placeholders = ids.map(() => "?").join(",");
			const result = rawDb
				.query<never, string[]>(`DELETE FROM memories WHERE id IN (${placeholders})`)
				.run(...ids);

			return c.json({ deleted: (result as unknown as { changes: number }).changes });
		},
	)
	.patch(
		"/batch/tags",
		zValidator(
			"json",
			z.object({
				ids: z.array(z.string()).min(1).max(500),
				addTags: z.array(z.string()).optional(),
				removeTags: z.array(z.string()).optional(),
			}),
		),
		async (c) => {
			const { ids, addTags, removeTags } = c.req.valid("json");
			const rawDb = getRawDatabase();

			let updated = 0;

			for (const id of ids) {
				const row = rawDb
					.query<{ tags: string | null }, [string]>("SELECT tags FROM memories WHERE id = ?")
					.get(id);

				if (!row) continue;

				let tags: string[] = row.tags ? JSON.parse(row.tags) : [];

				if (addTags?.length) {
					const tagSet = new Set(tags);
					for (const t of addTags) tagSet.add(t);
					tags = Array.from(tagSet);
				}

				if (removeTags?.length) {
					const removeSet = new Set(removeTags);
					tags = tags.filter((t) => !removeSet.has(t));
				}

				rawDb
					.query<never, [string, number, string]>(
						"UPDATE memories SET tags = ?, updated_at = ? WHERE id = ?",
					)
					.run(JSON.stringify(tags), Date.now(), id);

				updated++;
			}

			return c.json({ updated });
		},
	)
	.get("/", async (c) => {
		const agentId = c.req.query("agentId") ?? "main";
		const limit = Number(c.req.query("limit") ?? "50");
		const offset = Number(c.req.query("offset") ?? "0");
		const tagsParam = c.req.query("tags");
		const source = c.req.query("source");
		const sortBy = c.req.query("sortBy") ?? "updatedAt";
		const includeShared = c.req.query("includeShared") === "true";

		const gw = getGateway();

		// If no extra filters, use existing MemoryStore methods
		if (!tagsParam && !source && sortBy === "updatedAt" && !includeShared) {
			const entries = await gw.memories.list(agentId, limit, offset);
			const total = await gw.memories.count(agentId);
			return c.json({ entries, total });
		}

		// Build filtered query with raw SQL
		const rawDb = getRawDatabase();
		const conditions: string[] = includeShared
			? ["(m.agent_id = ? OR m.scope = 'shared')"]
			: ["m.agent_id = ?"];
		const params: (string | number)[] = [agentId];

		if (source) {
			conditions.push("m.source = ?");
			params.push(source);
		}

		// Tag filtering: memories must contain ALL specified tags
		if (tagsParam) {
			const filterTags = tagsParam
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean);
			for (const tag of filterTags) {
				conditions.push(`EXISTS (SELECT 1 FROM json_each(m.tags) j WHERE j.value = ?)`);
				params.push(tag);
			}
		}

		const orderCol = sortBy === "createdAt" ? "m.created_at" : "m.updated_at";
		const whereClause = conditions.join(" AND ");

		// Get total count
		const countRow = rawDb
			.query<{ count: number }, (string | number)[]>(
				`SELECT COUNT(*) as count FROM memories m WHERE ${whereClause}`,
			)
			.get(...params);
		const total = countRow?.count ?? 0;

		// Get entries
		const queryParams = [...params, limit, offset];
		const rows = rawDb
			.query<
				{
					id: string;
					agent_id: string;
					content: string;
					tags: string | null;
					source: string | null;
					session_key: string | null;
					created_at: number;
					updated_at: number;
				},
				(string | number)[]
			>(
				`SELECT m.id, m.agent_id, m.content, m.tags, m.source, m.session_key,
				        m.created_at, m.updated_at
				 FROM memories m
				 WHERE ${whereClause}
				 ORDER BY ${orderCol} DESC
				 LIMIT ? OFFSET ?`,
			)
			.all(...queryParams);

		const entries = rows.map((r) => ({
			id: r.id,
			agentId: r.agent_id,
			content: r.content,
			tags: r.tags ? JSON.parse(r.tags) : [],
			source: r.source ?? "user",
			sessionKey: r.session_key,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
		}));

		return c.json({ entries, total });
	})
	.get("/search", async (c) => {
		const agentId = c.req.query("agentId") ?? "main";
		const query = c.req.query("q") ?? "";
		const limit = Number(c.req.query("limit") ?? "10");
		const mode = (c.req.query("mode") ?? "hybrid") as "keyword" | "semantic" | "hybrid";
		const includeShared = c.req.query("includeShared") === "true";

		if (!query) {
			return c.json({ results: [] });
		}

		const gw = getGateway();
		const config = gw.config.get();

		if (mode === "keyword") {
			// FTS only
			try {
				const results = await gw.memories.searchFts(agentId, query, limit, includeShared);
				return c.json({ results });
			} catch {
				return c.json({ results: [] });
			}
		}

		if (mode === "semantic") {
			// Vector only
			if (!config.memory.enabled) {
				return c.json({ results: [], error: "Memory embedding not enabled" });
			}
			try {
				const queryEmbedding = await generateEmbedding(query, config);
				const results = await gw.memories.searchVector(
					agentId,
					queryEmbedding,
					limit,
					includeShared,
				);
				return c.json({ results });
			} catch {
				return c.json({ results: [] });
			}
		}

		// hybrid (default) — existing behavior
		let queryEmbedding: Float32Array | undefined;
		if (config.memory.enabled) {
			try {
				queryEmbedding = await generateEmbedding(query, config);
			} catch {
				// Fall back to FTS only
			}
		}

		const results = await gw.memories.search(agentId, query, queryEmbedding, limit, includeShared);
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
	.get("/:id", async (c) => {
		const id = c.req.param("id");
		const rawDb = getRawDatabase();
		const row = rawDb
			.query<
				{
					id: string;
					agent_id: string;
					content: string;
					tags: string | null;
					source: string | null;
					scope: string;
					created_at: number;
					updated_at: number;
				},
				[string]
			>(
				"SELECT id, agent_id, content, tags, source, scope, created_at, updated_at FROM memories WHERE id = ?",
			)
			.get(id);
		if (!row) return c.json({ error: "Memory not found" }, 404);
		return c.json({
			id: row.id,
			agentId: row.agent_id,
			content: row.content,
			tags: row.tags ? JSON.parse(row.tags) : [],
			source: row.source ?? "user",
			scope: row.scope,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		});
	})
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
	})
	.post("/import", async (c) => {
		const body = await c.req.parseBody();
		const file = body.file;

		if (!(file instanceof File)) {
			return c.json({ error: "No file provided" }, 400);
		}

		const agentId = (body.agentId as string) || "main";
		const tagsRaw = (body.tags as string) || "";
		const tags = tagsRaw
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const source = (body.source as string) || "import";

		const filename = file.name.toLowerCase();
		const text = await file.text();

		let chunks: { title?: string; content: string }[];

		if (filename.endsWith(".md")) {
			chunks = chunkMarkdown(text);
		} else if (filename.endsWith(".json")) {
			try {
				chunks = chunkJson(text);
			} catch {
				return c.json({ error: "Invalid JSON file" }, 400);
			}
		} else if (filename.endsWith(".csv")) {
			chunks = chunkCsv(text);
		} else if (filename.endsWith(".txt")) {
			chunks = chunkPlainText(text);
		} else {
			return c.json({ error: "Unsupported file format. Supported: .md, .txt, .json, .csv" }, 400);
		}

		if (chunks.length === 0) {
			return c.json({ imported: 0, chunks: 0 });
		}

		const gw = getGateway();
		const config = gw.config.get();

		let imported = 0;
		for (const chunk of chunks) {
			const entryTags = chunk.title ? [...tags, `title:${chunk.title}`] : [...tags];

			let embedding: Float32Array | undefined;
			if (config.memory.enabled) {
				try {
					embedding = await generateEmbedding(chunk.content, config);
				} catch {
					// Store without embedding
				}
			}

			await gw.memories.store({
				agentId,
				content: chunk.content,
				tags: entryTags.length > 0 ? entryTags : undefined,
				source,
				embedding,
			});
			imported++;
		}

		return c.json({ imported, chunks: chunks.length });
	});
