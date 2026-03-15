import type { Database } from "bun:sqlite";
import { log } from "../logger";

export type ErrorModule =
	| "agent"
	| "channel"
	| "security"
	| "plugin"
	| "mcp"
	| "cron"
	| "config"
	| "gateway";

export type ErrorSeverity = "error" | "warn";

export interface ErrorEntry {
	module: ErrorModule;
	severity: ErrorSeverity;
	code?: string;
	message: string;
	context?: Record<string, unknown>;
	stackTrace?: string;
}

export interface StoredError {
	id: number;
	timestamp: string;
	module: string;
	severity: string;
	code: string | null;
	message: string;
	context: string | null;
	stackTrace: string | null;
	createdAt: number;
}

export interface ErrorStats {
	last24h: { error: number; warn: number };
	byModule: Record<string, number>;
}

/**
 * Error collector with ring buffer (real-time) + SQLite (historical).
 * Follows AuditLogger's buffered write pattern.
 */
export class ErrorCollector {
	private db: Database;
	private writeBuffer: ErrorEntry[] = [];
	private flushTimer: ReturnType<typeof setTimeout> | null = null;
	private ringBuffer: StoredError[] = [];
	private ringId = 0;

	private readonly writeBufferLimit = 50;
	private readonly flushIntervalMs = 200;
	private readonly ringCapacity: number;

	constructor(db: Database, ringCapacity = 200) {
		this.db = db;
		this.ringCapacity = ringCapacity;
		this.ensureTable();
	}

	private ensureTable(): void {
		this.db.run(`
			CREATE TABLE IF NOT EXISTS error_logs (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				timestamp TEXT NOT NULL,
				module TEXT NOT NULL,
				severity TEXT NOT NULL,
				code TEXT,
				message TEXT NOT NULL,
				context TEXT,
				stack_trace TEXT,
				created_at INTEGER NOT NULL
			)
		`);
		this.db.run("CREATE INDEX IF NOT EXISTS idx_error_module ON error_logs(module)");
		this.db.run("CREATE INDEX IF NOT EXISTS idx_error_severity ON error_logs(severity)");
		this.db.run("CREATE INDEX IF NOT EXISTS idx_error_created ON error_logs(created_at)");
	}

	/** Collect an error (buffered write + ring buffer). */
	collect(entry: ErrorEntry): void {
		const now = Date.now();
		const stored: StoredError = {
			id: ++this.ringId,
			timestamp: new Date(now).toISOString(),
			module: entry.module,
			severity: entry.severity,
			code: entry.code ?? null,
			message: entry.message,
			context: entry.context ? JSON.stringify(entry.context) : null,
			stackTrace: entry.stackTrace ?? null,
			createdAt: now,
		};

		// Ring buffer (real-time)
		if (this.ringBuffer.length >= this.ringCapacity) {
			this.ringBuffer.shift();
		}
		this.ringBuffer.push(stored);

		// Write buffer (persistence)
		this.writeBuffer.push(entry);
		if (this.writeBuffer.length >= this.writeBufferLimit) {
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
		if (this.writeBuffer.length === 0) return;
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		const entries = [...this.writeBuffer];
		const now = Date.now();
		const stmt = this.db.prepare(
			`INSERT INTO error_logs (timestamp, module, severity, code, message, context, stack_trace, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		);

		const transaction = this.db.transaction(() => {
			for (const entry of entries) {
				stmt.run(
					new Date(now).toISOString(),
					entry.module,
					entry.severity,
					entry.code ?? null,
					entry.message,
					entry.context ? JSON.stringify(entry.context) : null,
					entry.stackTrace ?? null,
					now,
				);
			}
		});

		try {
			transaction();
			this.writeBuffer.splice(0, entries.length);
		} catch (err) {
			log.gateway().error({ err }, "error log flush failed, entries retained");
		}
	}

	/** Get recent errors from ring buffer (fast, in-memory). */
	recent(limit = 50): StoredError[] {
		return this.ringBuffer.slice(-limit).reverse();
	}

	/** Query historical errors from DB. */
	query(filters: {
		module?: string;
		severity?: string;
		since?: number;
		limit?: number;
		offset?: number;
	}): { errors: StoredError[]; total: number } {
		const conditions: string[] = [];
		const params: unknown[] = [];

		if (filters.module) {
			conditions.push("module = ?");
			params.push(filters.module);
		}
		if (filters.severity) {
			conditions.push("severity = ?");
			params.push(filters.severity);
		}
		if (filters.since) {
			conditions.push("created_at >= ?");
			params.push(filters.since);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = filters.limit ?? 50;
		const offset = filters.offset ?? 0;

		const countResult = this.db
			.prepare(`SELECT COUNT(*) as count FROM error_logs ${where}`)
			.get(...params) as { count: number };

		const errors = this.db
			.prepare(
				`SELECT id, timestamp, module, severity, code, message, context,
				 stack_trace as stackTrace, created_at as createdAt
				 FROM error_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
			)
			.all(...params, limit, offset) as StoredError[];

		return { errors, total: countResult.count };
	}

	/** Get summary stats. */
	stats(): ErrorStats {
		const oneDayAgo = Date.now() - 86_400_000;

		const severityCounts = this.db
			.prepare(
				"SELECT severity, COUNT(*) as count FROM error_logs WHERE created_at >= ? GROUP BY severity",
			)
			.all(oneDayAgo) as { severity: string; count: number }[];

		const moduleCounts = this.db
			.prepare(
				"SELECT module, COUNT(*) as count FROM error_logs WHERE created_at >= ? GROUP BY module",
			)
			.all(oneDayAgo) as { module: string; count: number }[];

		const last24h = { error: 0, warn: 0 };
		for (const row of severityCounts) {
			if (row.severity === "error") last24h.error = row.count;
			if (row.severity === "warn") last24h.warn = row.count;
		}

		const byModule: Record<string, number> = {};
		for (const row of moduleCounts) {
			byModule[row.module] = row.count;
		}

		return { last24h, byModule };
	}

	/** Delete error logs older than N days. */
	prune(days: number): number {
		const cutoff = Date.now() - days * 86_400_000;
		const result = this.db.run("DELETE FROM error_logs WHERE created_at < ?", cutoff);
		return result.changes;
	}

	shutdown(): void {
		if (this.writeBuffer.length > 0) this.flush();
	}
}
