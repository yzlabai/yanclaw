import { desc, eq, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { memories } from "./schema";
import { getDb, getRawDatabase } from "./sqlite";

export interface MemoryEntry {
	id: string;
	agentId: string;
	content: string;
	tags: string[];
	source: string;
	sessionKey: string | null;
	createdAt: number;
	updatedAt: number;
}

export interface MemorySearchResult extends MemoryEntry {
	score: number;
}

export class MemoryStore {
	/** Store a new memory entry. */
	async store(params: {
		agentId: string;
		content: string;
		tags?: string[];
		source?: string;
		sessionKey?: string;
		embedding?: Float32Array;
	}): Promise<string> {
		const db = getDb();
		const id = nanoid();
		const now = Date.now();

		await db.insert(memories).values({
			id,
			agentId: params.agentId,
			content: params.content,
			tags: params.tags ? JSON.stringify(params.tags) : null,
			source: params.source ?? "user",
			sessionKey: params.sessionKey ?? null,
			embedding: params.embedding ? Buffer.from(params.embedding.buffer) : null,
			createdAt: now,
			updatedAt: now,
		});

		return id;
	}

	/** Update an existing memory entry. */
	async update(
		id: string,
		params: {
			content?: string;
			tags?: string[];
			embedding?: Float32Array;
		},
	): Promise<boolean> {
		const db = getDb();
		const values: Record<string, unknown> = { updatedAt: Date.now() };

		if (params.content !== undefined) values.content = params.content;
		if (params.tags !== undefined) values.tags = JSON.stringify(params.tags);
		if (params.embedding !== undefined) values.embedding = Buffer.from(params.embedding.buffer);

		const result = await db.update(memories).set(values).where(eq(memories.id, id));

		return (result as unknown as { changes: number }).changes > 0;
	}

	/** Delete a memory entry. */
	async delete(id: string): Promise<boolean> {
		const db = getDb();
		const result = await db.delete(memories).where(eq(memories.id, id));
		return (result as unknown as { changes: number }).changes > 0;
	}

	/** List memories for an agent, ordered by most recent. */
	async list(agentId: string, limit = 50, offset = 0): Promise<MemoryEntry[]> {
		const db = getDb();
		const rows = await db
			.select()
			.from(memories)
			.where(eq(memories.agentId, agentId))
			.orderBy(desc(memories.updatedAt))
			.limit(limit)
			.offset(offset);

		return rows.map(toMemoryEntry);
	}

	/** Full-text search using FTS5. */
	async searchFts(agentId: string, query: string, limit = 20): Promise<MemorySearchResult[]> {
		const rawDb = getRawDatabase();

		// Use FTS5 match with BM25 ranking
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
					rank: number;
				},
				[string, string, number]
			>(
				`SELECT m.*, fts.rank
				 FROM memories m
				 JOIN memories_fts fts ON m.rowid = fts.rowid
				 WHERE memories_fts MATCH ?
				   AND m.agent_id = ?
				 ORDER BY fts.rank
				 LIMIT ?`,
			)
			.all(query, agentId, limit);

		return rows.map((r) => ({
			id: r.id,
			agentId: r.agent_id,
			content: r.content,
			tags: r.tags ? JSON.parse(r.tags) : [],
			source: r.source ?? "user",
			sessionKey: r.session_key,
			createdAt: r.created_at,
			updatedAt: r.updated_at,
			// FTS5 rank is negative (lower = better match), normalize to 0-1
			score: Math.min(1, Math.max(0, 1 + r.rank)),
		}));
	}

	/** Vector similarity search using cosine similarity computed in JS. */
	async searchVector(
		agentId: string,
		queryEmbedding: Float32Array,
		limit = 10,
	): Promise<MemorySearchResult[]> {
		const rawDb = getRawDatabase();

		// Load all entries with embeddings for this agent
		const rows = rawDb
			.query<
				{
					id: string;
					agent_id: string;
					content: string;
					tags: string | null;
					source: string | null;
					session_key: string | null;
					embedding: Buffer;
					created_at: number;
					updated_at: number;
				},
				[string]
			>("SELECT * FROM memories WHERE agent_id = ? AND embedding IS NOT NULL")
			.all(agentId);

		// Compute cosine similarity in JS
		const scored = rows
			.map((r) => {
				const emb = new Float32Array(
					r.embedding.buffer,
					r.embedding.byteOffset,
					r.embedding.byteLength / 4,
				);
				return {
					id: r.id,
					agentId: r.agent_id,
					content: r.content,
					tags: r.tags ? JSON.parse(r.tags) : [],
					source: r.source ?? "user",
					sessionKey: r.session_key,
					createdAt: r.created_at,
					updatedAt: r.updated_at,
					score: cosineSimilarity(queryEmbedding, emb),
				};
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		return scored;
	}

	/** Hybrid search: combines FTS5 keyword + vector similarity. */
	async search(
		agentId: string,
		query: string,
		queryEmbedding?: Float32Array,
		limit = 10,
	): Promise<MemorySearchResult[]> {
		const results = new Map<string, MemorySearchResult>();

		// FTS5 keyword search
		try {
			const ftsResults = await this.searchFts(agentId, query, limit);
			for (const r of ftsResults) {
				results.set(r.id, r);
			}
		} catch {
			// FTS query syntax error — fall through to vector search
		}

		// Vector search if embedding available
		if (queryEmbedding) {
			const vecResults = await this.searchVector(agentId, queryEmbedding, limit);
			for (const r of vecResults) {
				const existing = results.get(r.id);
				if (existing) {
					// Boost score for entries found by both methods
					existing.score = Math.min(1, existing.score + r.score * 0.5);
				} else {
					results.set(r.id, r);
				}
			}
		}

		return Array.from(results.values())
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);
	}

	/** Count memories for an agent. */
	async count(agentId: string): Promise<number> {
		const db = getDb();
		const result = await db
			.select({ count: sql<number>`count(*)` })
			.from(memories)
			.where(eq(memories.agentId, agentId));
		return result[0]?.count ?? 0;
	}
}

function toMemoryEntry(row: typeof memories.$inferSelect): MemoryEntry {
	return {
		id: row.id,
		agentId: row.agentId,
		content: row.content,
		tags: row.tags ? JSON.parse(row.tags) : [],
		source: row.source ?? "user",
		sessionKey: row.sessionKey,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) return 0;
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	return denom === 0 ? 0 : dot / denom;
}
