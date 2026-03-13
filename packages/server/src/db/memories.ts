import { eq } from "drizzle-orm";
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
	scope: "private" | "shared";
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
		scope?: "private" | "shared";
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
			scope: params.scope ?? "private",
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

	/** List memories for an agent, ordered by most recent. Optionally include shared memories. */
	async list(
		agentId: string,
		limit = 50,
		offset = 0,
		opts?: { includeShared?: boolean; tags?: string[]; source?: string; sortBy?: string },
	): Promise<MemoryEntry[]> {
		const rawDb = getRawDatabase();

		const conditions: string[] = [];
		const params: unknown[] = [];

		// Agent scope: own memories + optionally shared
		if (opts?.includeShared) {
			conditions.push("(agent_id = ? OR scope = 'shared')");
		} else {
			conditions.push("agent_id = ?");
		}
		params.push(agentId);

		// Tag filter: memories must contain ALL specified tags
		if (opts?.tags && opts.tags.length > 0) {
			for (const tag of opts.tags) {
				conditions.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE json_each.value = ?)");
				params.push(tag);
			}
		}

		// Source filter
		if (opts?.source) {
			conditions.push("source = ?");
			params.push(opts.source);
		}

		const orderCol = opts?.sortBy === "createdAt" ? "created_at" : "updated_at";
		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

		params.push(limit, offset);

		const rows = rawDb
			.query<RawMemoryRow, unknown[]>(
				`SELECT * FROM memories ${where} ORDER BY ${orderCol} DESC LIMIT ? OFFSET ?`,
			)
			.all(...params);

		return rows.map(rawToMemoryEntry);
	}

	/** Full-text search using FTS5. Optionally include shared memories. */
	async searchFts(
		agentId: string,
		query: string,
		limit = 20,
		includeShared = false,
	): Promise<MemorySearchResult[]> {
		const rawDb = getRawDatabase();

		// Use FTS5 match with BM25 ranking
		const agentFilter = includeShared ? "(m.agent_id = ? OR m.scope = 'shared')" : "m.agent_id = ?";

		const rows = rawDb
			.query<RawMemoryRow & { rank: number }, [string, string, number]>(
				`SELECT m.*, fts.rank
				 FROM memories m
				 JOIN memories_fts fts ON m.rowid = fts.rowid
				 WHERE memories_fts MATCH ?
				   AND ${agentFilter}
				 ORDER BY fts.rank
				 LIMIT ?`,
			)
			.all(query, agentId, limit);

		return rows.map((r) => ({
			...rawToMemoryEntry(r),
			// FTS5 rank is negative (lower = better match), normalize to 0-1
			score: Math.min(1, Math.max(0, 1 + r.rank)),
		}));
	}

	/** Vector similarity search using cosine similarity computed in JS. */
	async searchVector(
		agentId: string,
		queryEmbedding: Float32Array,
		limit = 10,
		includeShared = false,
	): Promise<MemorySearchResult[]> {
		const rawDb = getRawDatabase();

		const agentFilter = includeShared ? "(agent_id = ? OR scope = 'shared')" : "agent_id = ?";

		const rows = rawDb
			.query<RawMemoryRow & { embedding: Buffer }, [string]>(
				`SELECT * FROM memories WHERE ${agentFilter} AND embedding IS NOT NULL`,
			)
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
					...rawToMemoryEntry(r),
					score: cosineSimilarity(queryEmbedding, emb),
				};
			})
			.sort((a, b) => b.score - a.score)
			.slice(0, limit);

		return scored;
	}

	/** Hybrid search: combines FTS5 keyword + vector similarity, with MMR dedup and temporal decay. */
	async search(
		agentId: string,
		query: string,
		queryEmbedding?: Float32Array,
		limit = 10,
		includeShared = false,
	): Promise<MemorySearchResult[]> {
		// Fetch more candidates than needed so MMR has room to filter
		const candidateLimit = limit * 3;
		const results = new Map<string, MemorySearchResult>();

		// FTS5 keyword search
		try {
			const ftsResults = await this.searchFts(agentId, query, candidateLimit, includeShared);
			for (const r of ftsResults) {
				results.set(r.id, r);
			}
		} catch {
			// FTS query syntax error — fall through to vector search
		}

		// Vector search if embedding available
		if (queryEmbedding) {
			const vecResults = await this.searchVector(
				agentId,
				queryEmbedding,
				candidateLimit,
				includeShared,
			);
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

		let candidates = Array.from(results.values());

		// Apply temporal decay: recent memories scored higher (30-day half-life)
		candidates = applyTemporalDecay(candidates);

		// Apply MMR to reduce redundancy in results
		return applyMMR(candidates, 0.7, limit);
	}

	/** Count memories for an agent. Optionally include shared. */
	async count(agentId: string, includeShared = false): Promise<number> {
		const rawDb = getRawDatabase();
		const agentFilter = includeShared ? "(agent_id = ? OR scope = 'shared')" : "agent_id = ?";
		const row = rawDb
			.query<{ cnt: number }, [string]>(`SELECT count(*) as cnt FROM memories WHERE ${agentFilter}`)
			.get(agentId);
		return row?.cnt ?? 0;
	}
}

// ---------------------------------------------------------------------------
// Raw row type for direct SQL queries
// ---------------------------------------------------------------------------

interface RawMemoryRow {
	id: string;
	agent_id: string;
	content: string;
	tags: string | null;
	source: string | null;
	session_key: string | null;
	scope: string | null;
	created_at: number;
	updated_at: number;
}

function rawToMemoryEntry(r: RawMemoryRow): MemoryEntry {
	return {
		id: r.id,
		agentId: r.agent_id,
		content: r.content,
		tags: r.tags ? JSON.parse(r.tags) : [],
		source: r.source ?? "user",
		sessionKey: r.session_key,
		scope: (r.scope as "private" | "shared") ?? "private",
		createdAt: r.created_at,
		updatedAt: r.updated_at,
	};
}

/**
 * Temporal decay: apply exponential decay based on memory age.
 * Half-life of 30 days — memories from 30 days ago get 50% of their score.
 */
function applyTemporalDecay(
	results: MemorySearchResult[],
	halfLifeDays = 30,
): MemorySearchResult[] {
	const lambda = Math.LN2 / halfLifeDays;
	const now = Date.now();

	return results
		.map((r) => {
			const ageDays = (now - r.updatedAt) / (1000 * 60 * 60 * 24);
			const decay = Math.exp(-lambda * ageDays);
			return { ...r, score: r.score * (0.3 + 0.7 * decay) }; // Floor at 30% to avoid zeroing old memories
		})
		.sort((a, b) => b.score - a.score);
}

/**
 * Maximal Marginal Relevance: select diverse results by penalizing redundancy.
 * lambda controls relevance vs diversity tradeoff (1.0 = pure relevance, 0.0 = pure diversity).
 */
function applyMMR(results: MemorySearchResult[], lambda = 0.7, topK = 10): MemorySearchResult[] {
	if (results.length <= topK) return results;

	const selected: MemorySearchResult[] = [];
	const remaining = [...results];

	while (selected.length < topK && remaining.length > 0) {
		let bestIdx = 0;
		let bestScore = -Infinity;

		for (let i = 0; i < remaining.length; i++) {
			const relevance = remaining[i].score;

			// Max similarity to any already-selected result (using Jaccard on text tokens)
			const maxSim =
				selected.length === 0
					? 0
					: Math.max(...selected.map((s) => jaccardSimilarity(s.content, remaining[i].content)));

			const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
			if (mmrScore > bestScore) {
				bestScore = mmrScore;
				bestIdx = i;
			}
		}

		selected.push(remaining.splice(bestIdx, 1)[0]);
	}

	return selected;
}

/** Jaccard similarity on word-level tokens (for MMR diversity). */
function jaccardSimilarity(a: string, b: string): number {
	const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
	const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
	if (wordsA.size === 0 && wordsB.size === 0) return 1;

	let intersection = 0;
	for (const w of wordsA) {
		if (wordsB.has(w)) intersection++;
	}

	const union = wordsA.size + wordsB.size - intersection;
	return union === 0 ? 0 : intersection / union;
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
