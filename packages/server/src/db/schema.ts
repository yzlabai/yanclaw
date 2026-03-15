import { blob, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
		modelOverride: text("model_override"),
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
		reasoning: text("reasoning"),
		reasoningSignature: text("reasoning_signature"),
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

export const usage = sqliteTable(
	"usage",
	{
		id: integer("id").primaryKey({ autoIncrement: true }),
		sessionKey: text("session_key").notNull(),
		agentId: text("agent_id").notNull(),
		model: text("model").notNull(),
		provider: text("provider").notNull(),
		inputTokens: integer("input_tokens").default(0).notNull(),
		outputTokens: integer("output_tokens").default(0).notNull(),
		cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
		cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
		estimatedCostUsd: real("estimated_cost_usd").default(0).notNull(),
		durationMs: integer("duration_ms").default(0).notNull(),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		index("idx_usage_session").on(table.sessionKey),
		index("idx_usage_agent").on(table.agentId),
		index("idx_usage_created").on(table.createdAt),
		index("idx_usage_model").on(table.model),
	],
);

export const agentExecutions = sqliteTable(
	"agent_executions",
	{
		id: text("id").primaryKey(),
		sessionKey: text("session_key").notNull(),
		agentId: text("agent_id").notNull(),
		status: text("status").notNull(), // "running" | "interrupted" | "completed"
		userMessage: text("user_message").notNull(),
		completedSteps: text("completed_steps"), // JSON array of completed tool call names
		partialResponse: text("partial_response"),
		startedAt: integer("started_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("idx_executions_session").on(table.sessionKey),
		index("idx_executions_status").on(table.status),
	],
);

export const pimItems = sqliteTable(
	"pim_items",
	{
		id: text("id").primaryKey(),
		category: text("category").notNull(), // person, event, thing, place, time, info, org, ledger
		subtype: text("subtype"),
		title: text("title").notNull(),
		content: text("content"),
		properties: text("properties").default("{}"),
		tags: text("tags").default("[]"),
		status: text("status"),
		datetime: text("datetime"),
		confidence: real("confidence").default(1.0),
		sourceIds: text("source_ids").default("[]"),
		agentId: text("agent_id"),
		reminded: integer("reminded").default(0).notNull(), // 0=not reminded, 1=reminded
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("idx_pim_category").on(table.category),
		index("idx_pim_subtype").on(table.subtype),
		index("idx_pim_status").on(table.status),
		index("idx_pim_datetime").on(table.datetime),
		index("idx_pim_title").on(table.title),
		index("idx_pim_created").on(table.createdAt),
	],
);

export const pimLinks = sqliteTable(
	"pim_links",
	{
		id: text("id").primaryKey(),
		fromId: text("from_id")
			.notNull()
			.references(() => pimItems.id, { onDelete: "cascade" }),
		toId: text("to_id")
			.notNull()
			.references(() => pimItems.id, { onDelete: "cascade" }),
		type: text("type").notNull(),
		properties: text("properties").default("{}"),
		confidence: real("confidence").default(1.0),
		createdAt: integer("created_at").notNull(),
	},
	(table) => [
		index("idx_pim_links_from").on(table.fromId),
		index("idx_pim_links_to").on(table.toId),
		index("idx_pim_links_type").on(table.type),
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
		scope: text("scope").notNull().default("private"), // "private" | "shared"
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(table) => [
		index("idx_memories_agent").on(table.agentId),
		index("idx_memories_updated").on(table.updatedAt),
	],
);
