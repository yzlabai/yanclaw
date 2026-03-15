import type { Database } from "bun:sqlite";
import { log } from "../logger";

export interface AuditEntry {
	actor: string;
	action: string;
	resource?: string;
	detail?: Record<string, unknown>;
	sessionKey?: string;
	result?: string;
}

interface StoredAuditEntry {
	id: number;
	timestamp: string;
	actor: string;
	action: string;
	resource: string | null;
	detail: string | null;
	sessionKey: string | null;
	result: string | null;
}

/**
 * Audit logger with buffered writes to SQLite.
 * Flushes every 100ms or when buffer reaches 50 entries.
 */
export class AuditLogger {
	private db: Database;
	private buffer: AuditEntry[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private readonly bufferLimit = 50;
	private readonly flushIntervalMs = 100;

	constructor(db: Database) {
		this.db = db;
		this.ensureTable();
	}

	private ensureTable(): void {
		this.db.run(`
			CREATE TABLE IF NOT EXISTS audit_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				timestamp TEXT NOT NULL,
				actor TEXT NOT NULL,
				action TEXT NOT NULL,
				resource TEXT,
				detail TEXT,
				session_key TEXT,
				result TEXT
			)
		`);
		this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp)`);
		this.db.run(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)`);
	}

	/** Log an audit entry (buffered). */
	log(entry: AuditEntry): void {
		this.buffer.push(entry);
		if (this.buffer.length >= this.bufferLimit) {
			this.flush();
		} else {
			this.scheduleFlush();
		}
	}

	private scheduleFlush(): void {
		if (this.flushTimer) return;
		this.flushTimer = setTimeout(() => {
			this.flushTimer = null;
			this.flush();
		}, this.flushIntervalMs);
	}

	private flush(): void {
		if (this.buffer.length === 0) return;

		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		// Snapshot entries to write, but don't clear buffer yet
		const entries = [...this.buffer];

		const stmt = this.db.prepare(
			`INSERT INTO audit_logs (timestamp, actor, action, resource, detail, session_key, result)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		);

		const transaction = this.db.transaction(() => {
			for (const entry of entries) {
				stmt.run(
					new Date().toISOString(),
					entry.actor,
					entry.action,
					entry.resource ?? null,
					entry.detail ? JSON.stringify(entry.detail) : null,
					entry.sessionKey ?? null,
					entry.result ?? null,
				);
			}
		});

		try {
			transaction();
			// Only clear buffer after successful write
			this.buffer.splice(0, entries.length);
		} catch (err) {
			log.security().error({ err }, "audit flush failed, entries retained for retry");
		}
	}

	/** Query audit logs with optional filters. */
	query(filters: {
		action?: string;
		actor?: string;
		after?: string;
		before?: string;
		limit?: number;
		offset?: number;
	}): { logs: StoredAuditEntry[]; total: number } {
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (filters.action) {
			conditions.push("action = ?");
			params.push(filters.action);
		}
		if (filters.actor) {
			conditions.push("actor = ?");
			params.push(filters.actor);
		}
		if (filters.after) {
			conditions.push("timestamp >= ?");
			params.push(filters.after);
		}
		if (filters.before) {
			conditions.push("timestamp <= ?");
			params.push(filters.before);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = filters.limit ?? 50;
		const offset = filters.offset ?? 0;

		const countResult = this.db
			.prepare(`SELECT COUNT(*) as count FROM audit_logs ${where}`)
			.get(...params) as { count: number };

		const logs = this.db
			.prepare(
				`SELECT id, timestamp, actor, action, resource, detail, session_key as sessionKey, result
				 FROM audit_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
			)
			.all(...params, limit, offset) as StoredAuditEntry[];

		return { logs, total: countResult.count };
	}

	/** Delete audit logs older than N days. Returns number of deleted rows. */
	prune(days: number): number {
		const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
		const result = this.db.run("DELETE FROM audit_logs WHERE timestamp < ?", cutoff);
		return result.changes;
	}

	/** Flush remaining buffer on shutdown. */
	shutdown(): void {
		if (this.buffer.length > 0) {
			this.flush();
		}
	}
}
