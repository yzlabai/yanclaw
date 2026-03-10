import { blob, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable(
	"sessions",
	{
		key: text("key").primaryKey(),
		agentId: text("agent_id").notNull(),
		channel: text("channel"),
		peerKind: text("peer_kind"),
		peerId: text("peer_id"),
		peerName: text("peer_name"),
		title: text("title"),
		messageCount: integer("message_count").default(0).notNull(),
		tokenCount: integer("token_count").default(0).notNull(),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("idx_sessions_agent").on(table.agentId),
		index("idx_sessions_channel").on(table.channel),
		index("idx_sessions_updated").on(table.updatedAt),
	],
);

export const messages = sqliteTable(
	"messages",
	{
		id: text("id").primaryKey(),
		sessionKey: text("session_key")
			.notNull()
			.references(() => sessions.key, { onDelete: "cascade" }),
		role: text("role").notNull(),
		content: text("content"),
		toolCalls: text("tool_calls"),
		attachments: text("attachments"),
		model: text("model"),
		tokenCount: integer("token_count").default(0).notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("idx_messages_session").on(table.sessionKey, table.createdAt)],
);

export const approvals = sqliteTable(
	"approvals",
	{
		id: text("id").primaryKey(),
		sessionKey: text("session_key").notNull(),
		toolName: text("tool_name").notNull(),
		args: text("args").notNull(),
		status: text("status").notNull().default("pending"),
		respondedAt: integer("responded_at"),
		expiresAt: integer("expires_at").notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [index("idx_approvals_pending").on(table.status)],
);

export const mediaFiles = sqliteTable(
	"media_files",
	{
		id: text("id").primaryKey(),
		sessionKey: text("session_key"),
		filename: text("filename").notNull(),
		mimeType: text("mime_type").notNull(),
		size: integer("size").notNull(),
		path: text("path").notNull(),
		source: text("source"),
		createdAt: integer("created_at").notNull(),
		expiresAt: integer("expires_at"),
	},
	(table) => [
		index("idx_media_session").on(table.sessionKey),
		index("idx_media_expires").on(table.expiresAt),
	],
);

export const auditLogs = sqliteTable(
	"audit_logs",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		timestamp: text("timestamp").notNull(),
		actor: text("actor").notNull(),
		action: text("action").notNull(),
		resource: text("resource"),
		detail: text("detail"),
		sessionKey: text("session_key"),
		result: text("result"),
	},
	(table) => [
		index("idx_audit_timestamp").on(table.timestamp),
		index("idx_audit_action").on(table.action),
	],
);

export const memories = sqliteTable(
	"memories",
	{
		id: text("id").primaryKey(),
		agentId: text("agent_id").notNull(),
		content: text("content").notNull(),
		tags: text("tags"), // JSON array
		source: text("source"), // "auto" | "user" | "tool"
		sessionKey: text("session_key"),
		embedding: blob("embedding"), // Float32Array as buffer
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("idx_memories_agent").on(table.agentId),
		index("idx_memories_updated").on(table.updatedAt),
	],
);
