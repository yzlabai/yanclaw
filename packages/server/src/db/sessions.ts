import { and, asc, count, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { messages, sessions } from "./schema";
import { getDb, getRawDatabase } from "./sqlite";

export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

export class SessionStore {
	ensureSession(params: {
		key: string;
		agentId: string;
		channel?: string;
		peerKind?: string;
		peerId?: string;
		peerName?: string;
	}): void {
		const db = getDb();
		const existing = db
			.select({ key: sessions.key })
			.from(sessions)
			.where(eq(sessions.key, params.key))
			.get();

		if (!existing) {
			const now = Date.now();
			db.insert(sessions)
				.values({
					key: params.key,
					agentId: params.agentId,
					channel: params.channel ?? null,
					peerKind: params.peerKind ?? null,
					peerId: params.peerId ?? null,
					peerName: params.peerName ?? null,
					messageCount: 0,
					tokenCount: 0,
					createdAt: now,
					updatedAt: now,
				})
				.run();
		}
	}

	getSession(key: string): SessionRow | undefined {
		const db = getDb();
		return db.select().from(sessions).where(eq(sessions.key, key)).get();
	}

	listSessions(params?: { agentId?: string; channel?: string; limit?: number; offset?: number }): {
		sessions: SessionRow[];
		total: number;
	} {
		const db = getDb();
		const conditions = [];

		if (params?.agentId) {
			conditions.push(eq(sessions.agentId, params.agentId));
		}
		if (params?.channel) {
			conditions.push(eq(sessions.channel, params.channel));
		}

		const where = conditions.length > 0 ? and(...conditions) : undefined;
		const limit = params?.limit ?? 20;
		const offset = params?.offset ?? 0;

		const [totalResult] = db.select({ count: count() }).from(sessions).where(where).all();

		const rows = db
			.select()
			.from(sessions)
			.where(where)
			.orderBy(desc(sessions.updatedAt))
			.limit(limit)
			.offset(offset)
			.all();

		return { sessions: rows, total: totalResult.count };
	}

	loadMessages(sessionKey: string): MessageRow[] {
		const db = getDb();
		return db
			.select()
			.from(messages)
			.where(eq(messages.sessionKey, sessionKey))
			.orderBy(asc(messages.createdAt))
			.all();
	}

	saveMessages(
		sessionKey: string,
		msgs: Array<{
			role: string;
			content: string | null;
			toolCalls?: unknown[];
			model?: string;
			tokenCount?: number;
		}>,
	): void {
		const rawDb = getRawDatabase();
		const now = Date.now();

		const tx = rawDb.transaction(() => {
			const db = getDb();
			let totalTokens = 0;

			for (const msg of msgs) {
				const id = nanoid();
				const tokenCount = msg.tokenCount ?? 0;
				totalTokens += tokenCount;

				db.insert(messages)
					.values({
						id,
						sessionKey,
						role: msg.role,
						content: msg.content,
						toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
						model: msg.model ?? null,
						tokenCount,
						createdAt: now,
					})
					.run();
			}

			db.update(sessions)
				.set({
					messageCount: sql`${sessions.messageCount} + ${msgs.length}`,
					tokenCount: sql`${sessions.tokenCount} + ${totalTokens}`,
					updatedAt: now,
				})
				.where(eq(sessions.key, sessionKey))
				.run();
		});

		tx();
	}

	updateTitle(key: string, title: string): void {
		const db = getDb();
		db.update(sessions).set({ title, updatedAt: Date.now() }).where(eq(sessions.key, key)).run();
	}

	updateModelOverride(key: string, modelOverride: string | null): boolean {
		const db = getDb();
		const result = db
			.update(sessions)
			.set({ modelOverride, updatedAt: Date.now() })
			.where(eq(sessions.key, key))
			.run();
		return result.changes > 0;
	}

	deleteSession(key: string): boolean {
		const db = getDb();
		const result = db.delete(sessions).where(eq(sessions.key, key)).run();
		return result.changes > 0;
	}

	compact(sessionKey: string, maxTokens: number): number {
		const session = this.getSession(sessionKey);
		if (!session || session.tokenCount <= maxTokens) return 0;

		const db = getDb();
		const rows = db
			.select({
				id: messages.id,
				role: messages.role,
				content: messages.content,
				tokenCount: messages.tokenCount,
			})
			.from(messages)
			.where(eq(messages.sessionKey, sessionKey))
			.orderBy(asc(messages.createdAt))
			.all();

		const tokensToFree = session.tokenCount - maxTokens;
		let accumulated = 0;
		const toDelete: string[] = [];

		for (const msg of rows) {
			if (msg.role === "system") continue;
			// Preserve messages with image references to avoid breaking vision context
			if (msg.content && /!\[.*\]\(|"type"\s*:\s*"image"/.test(msg.content)) continue;
			accumulated += msg.tokenCount;
			toDelete.push(msg.id);
			if (accumulated >= tokensToFree) break;
		}

		if (toDelete.length > 0) {
			db.delete(messages).where(inArray(messages.id, toDelete)).run();
			db.update(sessions)
				.set({
					messageCount: sql`${sessions.messageCount} - ${toDelete.length}`,
					tokenCount: sql`${sessions.tokenCount} - ${accumulated}`,
					updatedAt: Date.now(),
				})
				.where(eq(sessions.key, sessionKey))
				.run();
		}

		return toDelete.length;
	}

	/** Reset a session: clear all messages but keep session metadata. Returns message count deleted. */
	resetSession(key: string): number {
		const db = getDb();
		const result = db.delete(messages).where(eq(messages.sessionKey, key)).run();
		if (result.changes > 0) {
			db.update(sessions)
				.set({ messageCount: 0, tokenCount: 0, updatedAt: Date.now() })
				.where(eq(sessions.key, key))
				.run();
		}
		return result.changes;
	}

	/** Reset sessions idle for more than `idleMs` milliseconds. Returns number of sessions reset. */
	resetIdle(idleMs: number): number {
		const cutoff = Date.now() - idleMs;
		const db = getDb();
		// Find sessions with messages that haven't been updated since cutoff
		const staleSessions = db
			.select({ key: sessions.key })
			.from(sessions)
			.where(and(lt(sessions.updatedAt, cutoff), sql`${sessions.messageCount} > 0`))
			.all();

		let count = 0;
		for (const s of staleSessions) {
			const deleted = this.resetSession(s.key);
			if (deleted > 0) count++;
		}
		return count;
	}

	/** Get the latest user message content for a session (for steering context). */
	getLatestUserMessage(sessionKey: string): string | null {
		const db = getDb();
		const row = db
			.select({ content: messages.content })
			.from(messages)
			.where(and(eq(messages.sessionKey, sessionKey), eq(messages.role, "user")))
			.orderBy(desc(messages.createdAt))
			.limit(1)
			.get();
		return row?.content ?? null;
	}

	/** Get recent messages as CoreMessage format for LLM context. */
	getRecentMessages(
		sessionKey: string,
		limit = 20,
	): Array<{ role: "user" | "assistant"; content: string }> {
		const db = getDb();
		const rows = db
			.select({ role: messages.role, content: messages.content })
			.from(messages)
			.where(eq(messages.sessionKey, sessionKey))
			.orderBy(desc(messages.createdAt))
			.limit(limit)
			.all();
		return rows
			.filter((r) => (r.role === "user" || r.role === "assistant") && r.content)
			.reverse()
			.map((r) => ({
				role: r.role as "user" | "assistant",
				content: r.content ?? "",
			}));
	}

	/** Delete sessions not updated in the last `days` days. Returns number of sessions deleted. */
	pruneStale(days: number): number {
		if (days <= 0) return 0;
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		const db = getDb();
		// Messages cascade-delete via FK
		const result = db.delete(sessions).where(lt(sessions.updatedAt, cutoff)).run();
		if (result.changes > 0) {
			console.log(`[sessions] Pruned ${result.changes} stale session(s) older than ${days} days`);
		}
		return result.changes;
	}
}
