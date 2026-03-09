import { nanoid } from "nanoid";
import { getDatabase } from "./sqlite";

export interface SessionRow {
	key: string;
	agent_id: string;
	channel: string | null;
	peer_kind: string | null;
	peer_id: string | null;
	peer_name: string | null;
	title: string | null;
	message_count: number;
	token_count: number;
	created_at: number;
	updated_at: number;
}

export interface MessageRow {
	id: string;
	session_key: string;
	role: string;
	content: string | null;
	tool_calls: string | null;
	attachments: string | null;
	model: string | null;
	token_count: number;
	created_at: number;
}

export class SessionStore {
	ensureSession(params: {
		key: string;
		agentId: string;
		channel?: string;
		peerKind?: string;
		peerId?: string;
		peerName?: string;
	}): void {
		const db = getDatabase();
		const existing = db
			.query<{ key: string }, [string]>("SELECT key FROM sessions WHERE key = ?")
			.get(params.key);

		if (!existing) {
			const now = Date.now();
			db.run(
				`INSERT INTO sessions (key, agent_id, channel, peer_kind, peer_id, peer_name, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					params.key,
					params.agentId,
					params.channel ?? null,
					params.peerKind ?? null,
					params.peerId ?? null,
					params.peerName ?? null,
					now,
					now,
				],
			);
		}
	}

	getSession(key: string): SessionRow | null {
		const db = getDatabase();
		return db.query<SessionRow, [string]>("SELECT * FROM sessions WHERE key = ?").get(key);
	}

	listSessions(params?: { agentId?: string; channel?: string; limit?: number; offset?: number }): {
		sessions: SessionRow[];
		total: number;
	} {
		const db = getDatabase();
		const conditions: string[] = [];
		const args: unknown[] = [];

		if (params?.agentId) {
			conditions.push("agent_id = ?");
			args.push(params.agentId);
		}
		if (params?.channel) {
			conditions.push("channel = ?");
			args.push(params.channel);
		}

		const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
		const limit = params?.limit ?? 20;
		const offset = params?.offset ?? 0;

		const total = db
			.query<{ count: number }, unknown[]>(`SELECT COUNT(*) as count FROM sessions ${where}`)
			.get(...args)?.count;

		const sessions = db
			.query<SessionRow, unknown[]>(
				`SELECT * FROM sessions ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
			)
			.all(...args, limit, offset);

		return { sessions, total };
	}

	loadMessages(sessionKey: string): MessageRow[] {
		const db = getDatabase();
		return db
			.query<MessageRow, [string]>(
				"SELECT * FROM messages WHERE session_key = ? ORDER BY created_at ASC",
			)
			.all(sessionKey);
	}

	saveMessages(
		sessionKey: string,
		messages: Array<{
			role: string;
			content: string | null;
			toolCalls?: unknown[];
			model?: string;
			tokenCount?: number;
		}>,
	): void {
		const db = getDatabase();
		const now = Date.now();

		const tx = db.transaction(() => {
			let totalTokens = 0;
			for (const msg of messages) {
				const id = nanoid();
				const tokenCount = msg.tokenCount ?? 0;
				totalTokens += tokenCount;

				db.run(
					`INSERT INTO messages (id, session_key, role, content, tool_calls, model, token_count, created_at)
					 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						id,
						sessionKey,
						msg.role,
						msg.content,
						msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
						msg.model ?? null,
						tokenCount,
						now,
					],
				);
			}

			db.run(
				`UPDATE sessions
				 SET message_count = message_count + ?,
				     token_count = token_count + ?,
				     updated_at = ?
				 WHERE key = ?`,
				[messages.length, totalTokens, now, sessionKey],
			);
		});

		tx();
	}

	deleteSession(key: string): boolean {
		const db = getDatabase();
		const result = db.run("DELETE FROM sessions WHERE key = ?", [key]);
		return result.changes > 0;
	}

	compact(sessionKey: string, maxTokens: number): number {
		const db = getDatabase();
		const session = this.getSession(sessionKey);
		if (!session || session.token_count <= maxTokens) return 0;

		const messages = db
			.query<{ id: string; role: string; token_count: number }, [string]>(
				"SELECT id, role, token_count FROM messages WHERE session_key = ? ORDER BY created_at ASC",
			)
			.all(sessionKey);

		const tokensToFree = session.token_count - maxTokens;
		let accumulated = 0;
		const toDelete: string[] = [];

		for (const msg of messages) {
			if (msg.role === "system") continue;
			accumulated += msg.token_count;
			toDelete.push(msg.id);
			if (accumulated >= tokensToFree) break;
		}

		if (toDelete.length > 0) {
			const placeholders = toDelete.map(() => "?").join(",");
			db.run(`DELETE FROM messages WHERE id IN (${placeholders})`, toDelete);
			db.run(
				`UPDATE sessions SET message_count = message_count - ?, token_count = token_count - ?, updated_at = ? WHERE key = ?`,
				[toDelete.length, accumulated, Date.now(), sessionKey],
			);
		}

		return toDelete.length;
	}
}
