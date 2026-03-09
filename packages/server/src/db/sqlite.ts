import { Database } from "bun:sqlite";
import { join } from "node:path";
import { resolveDataDir } from "../config/store";

let db: Database | null = null;

export function getDatabase(): Database {
	if (!db) {
		throw new Error("Database not initialized. Call initDatabase() first.");
	}
	return db;
}

export function initDatabase(dbPath?: string): Database {
	const path = dbPath ?? join(resolveDataDir(), "data.db");
	db = new Database(path);

	db.exec("PRAGMA journal_mode=WAL");
	db.exec("PRAGMA foreign_keys=ON");
	db.exec("PRAGMA busy_timeout=5000");

	runMigrations(db);
	return db;
}

function runMigrations(db: Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS _migrations (
			version INTEGER PRIMARY KEY,
			name TEXT NOT NULL,
			applied_at INTEGER NOT NULL
		)
	`);

	const applied = new Set(
		db
			.query<{ version: number }, []>("SELECT version FROM _migrations")
			.all()
			.map((r) => r.version),
	);

	for (const migration of MIGRATIONS) {
		if (!applied.has(migration.version)) {
			db.exec(migration.sql);
			db.run("INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)", [
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
			CREATE TABLE sessions (
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

			CREATE INDEX idx_sessions_agent ON sessions(agent_id);
			CREATE INDEX idx_sessions_channel ON sessions(channel);
			CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);

			CREATE TABLE messages (
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

			CREATE INDEX idx_messages_session ON messages(session_key, created_at);

			CREATE TABLE approvals (
				id            TEXT PRIMARY KEY,
				session_key   TEXT NOT NULL,
				tool_name     TEXT NOT NULL,
				args          TEXT NOT NULL,
				status        TEXT NOT NULL DEFAULT 'pending',
				responded_at  INTEGER,
				expires_at    INTEGER NOT NULL,
				created_at    INTEGER NOT NULL
			);

			CREATE INDEX idx_approvals_pending ON approvals(status)
				WHERE status = 'pending';

			CREATE TABLE media_files (
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

			CREATE INDEX idx_media_session ON media_files(session_key);
			CREATE INDEX idx_media_expires ON media_files(expires_at)
				WHERE expires_at IS NOT NULL;
		`,
	},
];

export function closeDatabase(): void {
	db?.close();
	db = null;
}
