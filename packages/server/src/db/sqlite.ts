import { Database } from "bun:sqlite";
import { join } from "node:path";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { resolveDataDir } from "../config/store";
import * as schema from "./schema";

let db: BunSQLiteDatabase<typeof schema> | null = null;
let rawDb: Database | null = null;

export function getDb(): BunSQLiteDatabase<typeof schema> {
	if (!db) {
		throw new Error("Database not initialized. Call initDatabase() first.");
	}
	return db;
}

/** Get the raw bun:sqlite Database for low-level ops. */
export function getRawDatabase(): Database {
	if (!rawDb) {
		throw new Error("Database not initialized. Call initDatabase() first.");
	}
	return rawDb;
}

export function initDatabase(dbPath?: string): BunSQLiteDatabase<typeof schema> {
	const path = dbPath ?? join(resolveDataDir(), "data.db");
	rawDb = new Database(path);

	rawDb.exec("PRAGMA journal_mode=WAL");
	rawDb.exec("PRAGMA foreign_keys=ON");
	rawDb.exec("PRAGMA busy_timeout=5000");

	// Run raw SQL migrations for initial schema
	runMigrations(rawDb);

	db = drizzle(rawDb, { schema });
	return db;
}

function runMigrations(database: Database): void {
	database.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		)
	`);

	const applied = new Set(
		database
			.query<{ version: number }, []>("SELECT version FROM _migrations")
			.all()
			.map((r) => r.version),
	);

	for (const migration of MIGRATIONS) {
		if (!applied.has(migration.version)) {
			database.exec(migration.sql);
			database.run("INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)", [
				migration.version,
				migration.name,
				Date.now(),
			]);
			console.log(`[db] Applied migration ${migration.version}: ${migration.name}`);
		}
	}
}

const MIGRATIONS = [
	{
		version: 1,
		name: "init",
		sql: `
			CREATE TABLE IF NOT EXISTS sessions (
				key           TEXT PRIMARY KEY,
				agent_id      TEXT NOT NULL,
				channel       TEXT,
				peer_kind     TEXT,
				peer_id       TEXT,
				peer_name     TEXT,
				title         TEXT,
				message_count INTEGER DEFAULT 0,
				token_count   INTEGER DEFAULT 0,
				created_at    INTEGER NOT NULL,
				updated_at    INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id);
			CREATE INDEX IF NOT EXISTS idx_sessions_channel ON sessions(channel);
			CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);

			CREATE TABLE IF NOT EXISTS messages (
				id            TEXT PRIMARY KEY,
				session_key   TEXT NOT NULL,
				role          TEXT NOT NULL,
				content       TEXT,
				tool_calls    TEXT,
				attachments   TEXT,
				model         TEXT,
				token_count   INTEGER DEFAULT 0,
				created_at    INTEGER NOT NULL,
				FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE
			);

			CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_key, created_at);

			CREATE TABLE IF NOT EXISTS approvals (
				id            TEXT PRIMARY KEY,
				session_key   TEXT NOT NULL,
				tool_name     TEXT NOT NULL,
				args          TEXT NOT NULL,
				status        TEXT NOT NULL DEFAULT 'pending',
				responded_at  INTEGER,
				expires_at    INTEGER NOT NULL,
				created_at    INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_approvals_pending ON approvals(status)
				WHERE status = 'pending';

			CREATE TABLE IF NOT EXISTS media_files (
				id            TEXT PRIMARY KEY,
				session_key   TEXT,
				filename      TEXT NOT NULL,
				mime_type     TEXT NOT NULL,
				size          INTEGER NOT NULL,
				path          TEXT NOT NULL,
				source        TEXT,
				created_at    INTEGER NOT NULL,
				expires_at    INTEGER
			);

			CREATE INDEX IF NOT EXISTS idx_media_session ON media_files(session_key);
			CREATE INDEX IF NOT EXISTS idx_media_expires ON media_files(expires_at)
				WHERE expires_at IS NOT NULL;
		`,
	},
	{
		version: 2,
		name: "memory_fts",
		sql: `
			CREATE TABLE IF NOT EXISTS memories (
				id            TEXT PRIMARY KEY,
				agent_id      TEXT NOT NULL,
				content       TEXT NOT NULL,
				tags          TEXT,
				source        TEXT,
				session_key   TEXT,
				embedding     BLOB,
				created_at    INTEGER NOT NULL,
				updated_at    INTEGER NOT NULL
			);

			CREATE INDEX IF NOT EXISTS idx_memories_agent ON memories(agent_id);
			CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);

			CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
				content,
				tags,
				content='memories',
				content_rowid='rowid'
			);

			CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
				INSERT INTO memories_fts(rowid, content, tags)
				VALUES (new.rowid, new.content, new.tags);
			END;

			CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
				INSERT INTO memories_fts(memories_fts, rowid, content, tags)
				VALUES ('delete', old.rowid, old.content, old.tags);
			END;

			CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
				INSERT INTO memories_fts(memories_fts, rowid, content, tags)
				VALUES ('delete', old.rowid, old.content, old.tags);
				INSERT INTO memories_fts(rowid, content, tags)
				VALUES (new.rowid, new.content, new.tags);
			END;
		`,
	},
	{
		version: 3,
		name: "audit_logs",
		sql: `
			CREATE TABLE IF NOT EXISTS audit_logs (
				id            INTEGER PRIMARY KEY AUTOINCREMENT,
				timestamp     TEXT NOT NULL,
				actor         TEXT NOT NULL,
				action        TEXT NOT NULL,
				resource      TEXT,
				detail        TEXT,
				session_key   TEXT,
				result        TEXT
			);

			CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
			CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
		`,
	},
];

export function closeDatabase(): void {
	rawDb?.close();
	rawDb = null;
	db = null;
}
