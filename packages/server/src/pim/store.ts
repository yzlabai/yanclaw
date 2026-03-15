import { and, desc, eq, like } from "drizzle-orm";
import { nanoid } from "nanoid";
import { pimItems, pimLinks } from "../db/schema";
import { getDb, getRawDatabase } from "../db/sqlite";
import type { PimCategory, PimItem, PimItemDetail, PimLink } from "./types";

interface QueryOptions {
	category?: PimCategory;
	subtype?: string;
	status?: string;
	q?: string;
	limit?: number;
	offset?: number;
}

interface LinkInput {
	fromId: string;
	toId: string;
	type: string;
	properties?: Record<string, unknown>;
	confidence?: number;
}

export class PimStore {
	// ── Item CRUD ──────────────────────────────────────────

	async create(input: {
		category: PimCategory;
		subtype?: string;
		title: string;
		content?: string;
		properties?: Record<string, unknown>;
		tags?: string[];
		status?: string;
		datetime?: string;
		confidence?: number;
		sourceIds?: string[];
		agentId?: string;
	}): Promise<string> {
		const db = getDb();
		const id = nanoid();
		const now = Date.now();

		await db.insert(pimItems).values({
			id,
			category: input.category,
			subtype: input.subtype ?? null,
			title: input.title,
			content: input.content ?? null,
			properties: JSON.stringify(input.properties ?? {}),
			tags: JSON.stringify(input.tags ?? []),
			status: input.status ?? null,
			datetime: input.datetime ?? null,
			confidence: input.confidence ?? 1.0,
			sourceIds: JSON.stringify(input.sourceIds ?? []),
			agentId: input.agentId ?? null,
			createdAt: now,
			updatedAt: now,
		});

		return id;
	}

	async get(id: string): Promise<PimItem | null> {
		const db = getDb();
		const rows = await db.select().from(pimItems).where(eq(pimItems.id, id)).limit(1);
		return rows[0] ? this.parseRow(rows[0]) : null;
	}

	async update(
		id: string,
		patch: {
			title?: string;
			content?: string;
			properties?: Record<string, unknown>;
			tags?: string[];
			status?: string;
			datetime?: string;
			subtype?: string;
		},
	): Promise<boolean> {
		const db = getDb();
		const values: Record<string, unknown> = { updatedAt: Date.now() };

		if (patch.title !== undefined) values.title = patch.title;
		if (patch.content !== undefined) values.content = patch.content;
		if (patch.properties !== undefined) values.properties = JSON.stringify(patch.properties);
		if (patch.tags !== undefined) values.tags = JSON.stringify(patch.tags);
		if (patch.status !== undefined) values.status = patch.status;
		if (patch.datetime !== undefined) values.datetime = patch.datetime;
		if (patch.subtype !== undefined) values.subtype = patch.subtype;

		const result = await db.update(pimItems).set(values).where(eq(pimItems.id, id));
		return (result as unknown as { changes: number }).changes > 0;
	}

	async delete(id: string): Promise<boolean> {
		const db = getDb();
		// Links are cascade-deleted via FK
		const result = await db.delete(pimItems).where(eq(pimItems.id, id));
		return (result as unknown as { changes: number }).changes > 0;
	}

	// ── Query ─────────────────────────────────────────────

	async query(opts: QueryOptions): Promise<PimItem[]> {
		const db = getDb();
		const conditions = [];

		if (opts.category) conditions.push(eq(pimItems.category, opts.category));
		if (opts.subtype) conditions.push(eq(pimItems.subtype, opts.subtype));
		if (opts.status) conditions.push(eq(pimItems.status, opts.status));
		if (opts.q) conditions.push(like(pimItems.title, `%${opts.q}%`));

		const where = conditions.length > 0 ? and(...conditions) : undefined;
		const rows = await db
			.select()
			.from(pimItems)
			.where(where)
			.orderBy(desc(pimItems.updatedAt))
			.limit(opts.limit ?? 50)
			.offset(opts.offset ?? 0);

		return rows.map((r) => this.parseRow(r));
	}

	async count(category?: PimCategory): Promise<number> {
		const rawDb = getRawDatabase();
		const q = category
			? rawDb.query<{ c: number }, [string]>(
					"SELECT COUNT(*) as c FROM pim_items WHERE category = ?",
				)
			: rawDb.query<{ c: number }, []>("SELECT COUNT(*) as c FROM pim_items");
		const row = category
			? (q as ReturnType<typeof rawDb.query<{ c: number }, [string]>>).get(category)
			: (q as ReturnType<typeof rawDb.query<{ c: number }, []>>).get();
		return row?.c ?? 0;
	}

	async stats(): Promise<Record<string, number>> {
		const rawDb = getRawDatabase();
		const rows = rawDb
			.query<{ category: string; c: number }, []>(
				"SELECT category, COUNT(*) as c FROM pim_items GROUP BY category",
			)
			.all();
		const result: Record<string, number> = {};
		for (const r of rows) result[r.category] = r.c;
		return result;
	}

	// ── Dedup: find existing item by title + category ─────

	async findByTitle(title: string, category: PimCategory): Promise<PimItem | null> {
		const db = getDb();
		const rows = await db
			.select()
			.from(pimItems)
			.where(and(eq(pimItems.title, title), eq(pimItems.category, category)))
			.limit(1);
		return rows[0] ? this.parseRow(rows[0]) : null;
	}

	/** Find a person or org by alias in their properties (LIKE search on aliases field). */
	async findByAlias(alias: string, category: PimCategory): Promise<PimItem | null> {
		const rawDb = getRawDatabase();
		const row = rawDb
			.query<RawPimRow, [string, string]>(
				`SELECT * FROM pim_items
				 WHERE category = ? AND properties LIKE '%' || ? || '%'
				 LIMIT 1`,
			)
			.get(category, alias);
		return row ? this.parseRawRow(row) : null;
	}

	/** Merge properties into an existing item (for dedup). */
	async mergeProperties(
		id: string,
		newProps: Record<string, unknown>,
		newSourceIds?: string[],
	): Promise<void> {
		const existing = await this.get(id);
		if (!existing) return;

		const merged = { ...existing.properties };
		for (const [k, v] of Object.entries(newProps)) {
			if (v !== undefined && v !== null && v !== "") {
				merged[k] = v;
			}
		}

		const sourceIds = [...new Set([...existing.sourceIds, ...(newSourceIds ?? [])])];

		await this.update(id, {
			properties: merged,
		});

		// Update sourceIds separately via raw update
		const db = getDb();
		await db
			.update(pimItems)
			.set({
				sourceIds: JSON.stringify(sourceIds),
				updatedAt: Date.now(),
			})
			.where(eq(pimItems.id, id));
	}

	// ── Links ─────────────────────────────────────────────

	async createLink(input: LinkInput): Promise<string> {
		const db = getDb();
		const id = nanoid();
		await db.insert(pimLinks).values({
			id,
			fromId: input.fromId,
			toId: input.toId,
			type: input.type,
			properties: JSON.stringify(input.properties ?? {}),
			confidence: input.confidence ?? 1.0,
			createdAt: Date.now(),
		});
		return id;
	}

	async deleteLink(id: string): Promise<boolean> {
		const db = getDb();
		const result = await db.delete(pimLinks).where(eq(pimLinks.id, id));
		return (result as unknown as { changes: number }).changes > 0;
	}

	async getLinks(itemId: string): Promise<Array<PimLink & { item: PimItem }>> {
		const rawDb = getRawDatabase();
		// Get links where this item is fromId or toId, with the OTHER item's data
		const rows = rawDb
			.query<
				RawPimRow & {
					link_id: string;
					link_type: string;
					link_props: string;
					link_confidence: number;
					link_created: number;
					direction: string;
				},
				[string, string]
			>(
				`SELECT
					p.*,
					l.id as link_id,
					l.type as link_type,
					l.properties as link_props,
					l.confidence as link_confidence,
					l.created_at as link_created,
					CASE WHEN l.from_id = ? THEN 'outgoing' ELSE 'incoming' END as direction
				FROM pim_links l
				JOIN pim_items p ON (
					CASE WHEN l.from_id = ? THEN l.to_id ELSE l.from_id END = p.id
				)
				WHERE l.from_id = ?1 OR l.to_id = ?1
				ORDER BY l.created_at DESC`,
			)
			.all(itemId, itemId);

		return rows.map((r) => ({
			id: r.link_id,
			fromId: r.direction === "outgoing" ? itemId : r.id,
			toId: r.direction === "outgoing" ? r.id : itemId,
			type: r.link_type,
			properties: safeJsonParse(r.link_props, {}),
			confidence: r.link_confidence,
			createdAt: r.link_created,
			item: this.parseRawRow(r),
		}));
	}

	async getLinksBetween(fromId: string, toId: string): Promise<PimLink[]> {
		const db = getDb();
		const rows = await db
			.select()
			.from(pimLinks)
			.where(and(eq(pimLinks.fromId, fromId), eq(pimLinks.toId, toId)));
		return rows.map((r) => ({
			id: r.id,
			fromId: r.fromId,
			toId: r.toId,
			type: r.type,
			properties: safeJsonParse(r.properties, {}),
			confidence: r.confidence ?? 1.0,
			createdAt: r.createdAt,
		}));
	}

	// ── Inspect (item + all linked items) ─────────────────

	async inspect(id: string): Promise<PimItemDetail | null> {
		const item = await this.get(id);
		if (!item) return null;
		const links = await this.getLinks(id);
		return { ...item, links };
	}

	// ── Timeline (events sorted by datetime) ──────────────

	async timeline(days: number, limit = 50): Promise<PimItem[]> {
		const rawDb = getRawDatabase();
		const now = new Date();
		const start = new Date(now.getTime() - days * 86_400_000).toISOString();

		const rows = rawDb
			.query<RawPimRow, [string, number]>(
				`SELECT * FROM pim_items
				 WHERE category = 'event' AND datetime IS NOT NULL AND datetime >= ?
				 ORDER BY datetime ASC
				 LIMIT ?`,
			)
			.all(start, limit);

		return rows.map((r) => this.parseRawRow(r));
	}

	// ── Ledger summary ────────────────────────────────────

	async ledgerSummary(month: string): Promise<{
		income: number;
		expense: number;
		items: PimItem[];
	}> {
		const rawDb = getRawDatabase();
		const rows = rawDb
			.query<RawPimRow, [string]>(
				`SELECT * FROM pim_items
				 WHERE category = 'ledger' AND datetime LIKE ? || '%'
				 ORDER BY datetime DESC`,
			)
			.all(month);

		const items = rows.map((r) => this.parseRawRow(r));
		let income = 0;
		let expense = 0;

		for (const item of items) {
			const props = item.properties as Record<string, unknown>;
			const amount = Number(props.amount) || 0;
			const direction = String(props.direction ?? "expense");
			if (direction === "income") income += amount;
			else if (direction === "expense") expense += amount;
		}

		return { income, expense, items };
	}

	// ── Match helpers (for preheat) ───────────────────────

	async matchByKeywords(keywords: string[], category?: PimCategory, limit = 5): Promise<PimItem[]> {
		if (keywords.length === 0) return [];
		const rawDb = getRawDatabase();

		const likeClauses = keywords.map(
			() => "(title LIKE '%' || ? || '%' OR properties LIKE '%' || ? || '%')",
		);
		const catClause = category ? "AND category = ?" : "";
		const params: string[] = [];
		for (const kw of keywords) {
			params.push(kw, kw);
		}
		if (category) params.push(category);

		const query = `SELECT * FROM pim_items
			WHERE (${likeClauses.join(" OR ")}) ${catClause}
			ORDER BY updated_at DESC
			LIMIT ?`;
		params.push(String(limit));

		const rows = rawDb.query<RawPimRow, string[]>(query).all(...params);
		return rows.map((r) => this.parseRawRow(r));
	}

	// ── Internal helpers ──────────────────────────────────

	private parseRow(row: typeof pimItems.$inferSelect): PimItem {
		return {
			id: row.id,
			category: row.category as PimCategory,
			subtype: row.subtype,
			title: row.title,
			content: row.content,
			properties: safeJsonParse(row.properties, {}),
			tags: safeJsonParse(row.tags, []),
			status: row.status,
			datetime: row.datetime,
			confidence: row.confidence ?? 1.0,
			sourceIds: safeJsonParse(row.sourceIds, []),
			agentId: row.agentId,
			reminded: row.reminded === 1,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}

	private parseRawRow(row: RawPimRow): PimItem {
		return {
			id: row.id,
			category: row.category as PimCategory,
			subtype: row.subtype,
			title: row.title,
			content: row.content,
			properties: safeJsonParse(row.properties, {}),
			tags: safeJsonParse(row.tags, []),
			status: row.status,
			datetime: row.datetime,
			confidence: row.confidence ?? 1.0,
			sourceIds: safeJsonParse(row.source_ids, []),
			agentId: row.agent_id,
			reminded: (row.reminded ?? 0) === 1,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	// ── Reminder helpers ──────────────────────────────────

	async markReminded(id: string): Promise<void> {
		const db = getDb();
		await db.update(pimItems).set({ reminded: 1 }).where(eq(pimItems.id, id));
	}

	async getUnremindedEvents(opts: {
		subtype?: string;
		status?: string;
		datetimeBefore: string;
	}): Promise<PimItem[]> {
		const rawDb = getRawDatabase();
		const conditions = [
			"category = 'event'",
			"reminded = 0",
			"datetime IS NOT NULL",
			"datetime <= ?",
		];
		const params: string[] = [opts.datetimeBefore];

		if (opts.subtype) {
			conditions.push("subtype = ?");
			params.push(opts.subtype);
		}
		if (opts.status) {
			conditions.push("status = ?");
			params.push(opts.status);
		}

		const rows = rawDb
			.query<RawPimRow, string[]>(
				`SELECT * FROM pim_items WHERE ${conditions.join(" AND ")} ORDER BY datetime ASC LIMIT 20`,
			)
			.all(...params);
		return rows.map((r) => this.parseRawRow(r));
	}

	async getStaleContacts(
		daysSinceLastInteraction: number,
	): Promise<Array<PimItem & { daysSince: number }>> {
		const rawDb = getRawDatabase();
		const cutoff = Date.now() - daysSinceLastInteraction * 86_400_000;

		// Find contacts (person with relation=客户) whose latest linked event is older than cutoff
		const rows = rawDb
			.query<RawPimRow & { last_event_at: number | null }, [number]>(
				`SELECT p.*, MAX(e.updated_at) as last_event_at
				 FROM pim_items p
				 LEFT JOIN pim_links l ON (l.from_id = p.id OR l.to_id = p.id)
				 LEFT JOIN pim_items e ON (
					(CASE WHEN l.from_id = p.id THEN l.to_id ELSE l.from_id END) = e.id
					AND e.category = 'event'
				 )
				 WHERE p.category = 'person'
				   AND p.properties LIKE '%客户%'
				 GROUP BY p.id
				 HAVING last_event_at IS NULL OR last_event_at < ?
				 LIMIT 10`,
			)
			.all(cutoff);

		return rows.map((r) => ({
			...this.parseRawRow(r),
			daysSince: r.last_event_at
				? Math.floor((Date.now() - r.last_event_at) / 86_400_000)
				: daysSinceLastInteraction,
		}));
	}
}

interface RawPimRow {
	id: string;
	category: string;
	subtype: string | null;
	title: string;
	content: string | null;
	properties: string | null;
	tags: string | null;
	status: string | null;
	datetime: string | null;
	confidence: number | null;
	source_ids: string | null;
	agent_id: string | null;
	reminded: number | null;
	created_at: number;
	updated_at: number;
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
	if (!value) return fallback;
	try {
		return JSON.parse(value) as T;
	} catch {
		return fallback;
	}
}
