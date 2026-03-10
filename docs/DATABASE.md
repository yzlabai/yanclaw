# YanClaw 数据库设计

> 参考 OpenClaw 会话存储设计，使用 Drizzle ORM + bun:sqlite 实现

## 概述

- **数据库**: SQLite（通过 `bun:sqlite` 原生绑定）
- **ORM**: Drizzle ORM（`drizzle-orm/bun-sqlite`），类型安全查询
- **路径**: `~/.yanclaw/data.db`
- **模式**: WAL（Write-Ahead Logging），支持并发读写
- **向量检索**: sqlite-vec 扩展（规划中）

---

## 初始化

```typescript
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema";

const rawDb = new Database(path.join(dataDir, "data.db"));
rawDb.exec("PRAGMA journal_mode=WAL");
rawDb.exec("PRAGMA foreign_keys=ON");
rawDb.exec("PRAGMA busy_timeout=5000");

const db = drizzle(rawDb, { schema });
```

## Drizzle Schema

Schema 定义在 `packages/server/src/db/schema.ts`，使用 Drizzle 的 SQLite builder：

```typescript
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const sessions = sqliteTable("sessions", {
  key: text("key").primaryKey(),
  agentId: text("agent_id").notNull(),
  channel: text("channel"),
  // ...
}, (table) => [
  index("idx_sessions_agent").on(table.agentId),
]);
```

初始表通过 raw SQL migration 创建（兼容已有数据库），Drizzle 仅用于类型安全查询层。

---

## 表结构

### sessions — 会话

存储 Agent 与用户之间的对话会话。

```sql
CREATE TABLE sessions (
  key           TEXT PRIMARY KEY,       -- 会话键: "agent:main:telegram:direct:user_123"
  agent_id      TEXT NOT NULL,          -- Agent ID
  channel       TEXT,                   -- 通道标识 (webchat/telegram/discord/slack)
  peer_kind     TEXT,                   -- 对端类型 (direct/group/channel)
  peer_id       TEXT,                   -- 对端 ID
  peer_name     TEXT,                   -- 对端显示名
  title         TEXT,                   -- 会话标题（自动生成或用户设定）
  message_count INTEGER DEFAULT 0,      -- 消息总数
  token_count   INTEGER DEFAULT 0,      -- 累计 Token 用量
  created_at    INTEGER NOT NULL,       -- 创建时间 (Unix ms)
  updated_at    INTEGER NOT NULL        -- 最后活跃时间 (Unix ms)
);

CREATE INDEX idx_sessions_agent ON sessions(agent_id);
CREATE INDEX idx_sessions_channel ON sessions(channel);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC);
```

**会话键格式**:
- 主会话: `agent:{agentId}:main`
- 直聊: `agent:{agentId}:{channel}:direct:{peerId}`
- 群组: `agent:{agentId}:{channel}:group:{groupId}`
- 话题: `{baseKey}:thread:{threadId}`

### messages — 消息

存储对话消息，包括用户消息、模型回复和工具调用。

```sql
CREATE TABLE messages (
  id            TEXT PRIMARY KEY,       -- 消息 ID (nanoid)
  session_key   TEXT NOT NULL,          -- 关联会话键
  role          TEXT NOT NULL,          -- user / assistant / system / tool
  content       TEXT,                   -- 消息文本内容
  tool_calls    TEXT,                   -- JSON: 工具调用列表 [{name, args, result}]
  attachments   TEXT,                   -- JSON: 附件列表 [{type, url, name}]
  model         TEXT,                   -- 使用的模型 ID
  token_count   INTEGER,               -- 本消息 Token 用量
  created_at    INTEGER NOT NULL,       -- 创建时间 (Unix ms)

  FOREIGN KEY (session_key) REFERENCES sessions(key) ON DELETE CASCADE
);

CREATE INDEX idx_messages_session ON messages(session_key, created_at);
```

**`tool_calls` JSON 格式**:
```json
[
  {
    "id": "call_001",
    "name": "shell",
    "args": { "command": "ls -la" },
    "result": "total 32\ndrwxr-xr-x ...",
    "status": "success",
    "duration": 150
  }
]
```

### agents — Agent 配置持久化

```sql
CREATE TABLE agents (
  id            TEXT PRIMARY KEY,       -- Agent ID
  name          TEXT NOT NULL,          -- 显示名
  model         TEXT NOT NULL,          -- 默认模型
  system_prompt TEXT,                   -- 系统提示词
  workspace_dir TEXT,                   -- 工作目录
  tools_policy  TEXT,                   -- JSON: 工具策略覆盖
  metadata      TEXT,                   -- JSON: 其他元数据
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
```

### cron_jobs — 定时任务

```sql
CREATE TABLE cron_jobs (
  id              TEXT PRIMARY KEY,     -- 任务 ID (nanoid)
  agent_id        TEXT NOT NULL,        -- 执行 Agent
  schedule        TEXT NOT NULL,        -- Cron 表达式或 JSON 间隔
  prompt          TEXT NOT NULL,        -- 发送给 Agent 的提示词
  delivery_targets TEXT NOT NULL,       -- JSON: 投递目标 [{channel, peer}]
  enabled         INTEGER DEFAULT 1,    -- 是否启用 (0/1)
  last_run_at     INTEGER,             -- 上次执行时间
  next_run_at     INTEGER,             -- 下次计划执行时间
  last_result     TEXT,                -- 上次执行结果摘要
  run_count       INTEGER DEFAULT 0,   -- 累计执行次数
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,

  FOREIGN KEY (agent_id) REFERENCES agents(id)
);

CREATE INDEX idx_cron_next ON cron_jobs(enabled, next_run_at);
```

### approvals — 工具审批记录

```sql
CREATE TABLE approvals (
  id            TEXT PRIMARY KEY,       -- 审批 ID
  session_key   TEXT NOT NULL,          -- 关联会话
  tool_name     TEXT NOT NULL,          -- 工具名
  args          TEXT NOT NULL,          -- JSON: 工具参数
  status        TEXT NOT NULL,          -- pending / approved / denied / timeout
  responded_at  INTEGER,               -- 响应时间
  expires_at    INTEGER NOT NULL,       -- 超时时间
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_approvals_pending ON approvals(status) WHERE status = 'pending';
```

### media_files — 媒体文件元数据

```sql
CREATE TABLE media_files (
  id            TEXT PRIMARY KEY,       -- 媒体 ID (nanoid)
  session_key   TEXT,                   -- 关联会话（可选）
  filename      TEXT NOT NULL,          -- 原始文件名
  mime_type     TEXT NOT NULL,          -- MIME 类型
  size          INTEGER NOT NULL,       -- 文件大小 (bytes)
  path          TEXT NOT NULL,          -- 本地存储路径
  source        TEXT,                   -- 来源 (upload/channel/tool)
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER                 -- 过期时间（可选）
);

CREATE INDEX idx_media_session ON media_files(session_key);
CREATE INDEX idx_media_expires ON media_files(expires_at) WHERE expires_at IS NOT NULL;
```

### channel_state — 通道运行状态

```sql
CREATE TABLE channel_state (
  id            TEXT PRIMARY KEY,       -- 通道 ID
  type          TEXT NOT NULL,          -- telegram / discord / slack
  status        TEXT NOT NULL,          -- connected / disconnected / error
  connected_at  INTEGER,               -- 最近连接时间
  message_count INTEGER DEFAULT 0,     -- 累计消息数
  error_message TEXT,                   -- 最近错误信息
  metadata      TEXT,                   -- JSON: 通道特有状态
  updated_at    INTEGER NOT NULL
);
```

---

## 向量表（sqlite-vec）

用于记忆系统的语义检索。

```sql
-- 加载扩展
-- db.loadExtension("sqlite-vec");

-- 向量存储表
CREATE VIRTUAL TABLE memory_vectors USING vec0(
  embedding float[1536]                 -- 向量维度取决于 Embedding 模型
);

-- 向量元数据表
CREATE TABLE memory_chunks (
  rowid         INTEGER PRIMARY KEY,    -- 与 memory_vectors 的 rowid 对应
  source_type   TEXT NOT NULL,          -- file / session / manual
  source_id     TEXT NOT NULL,          -- 来源标识
  content       TEXT NOT NULL,          -- 原文内容
  metadata      TEXT,                   -- JSON: 其他元数据
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_chunks_source ON memory_chunks(source_type, source_id);
```

### 向量检索查询

```sql
-- KNN 最近邻搜索
SELECT
  mc.content,
  mc.source_type,
  mc.source_id,
  mv.distance
FROM memory_vectors mv
JOIN memory_chunks mc ON mc.rowid = mv.rowid
WHERE mv.embedding MATCH ?            -- 查询向量
  AND k = 10                           -- Top-K
ORDER BY mv.distance;
```

### 全文搜索表（FTS5）

```sql
CREATE VIRTUAL TABLE memory_fts USING fts5(
  content,
  source_type,
  source_id,
  tokenize = 'unicode61'
);

-- 混合搜索：先 FTS 粗筛，再向量精排
```

---

## 迁移策略

使用版本化迁移文件，按顺序执行：

```
packages/server/src/db/migrations/
├── 001_init.sql                    # 初始表结构
├── 002_add_vectors.sql             # 向量检索表
├── 003_add_cron.sql                # 定时任务表
└── ...
```

### 迁移管理表

```sql
CREATE TABLE _migrations (
  version       INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  applied_at    INTEGER NOT NULL
);
```

### 迁移执行逻辑

```typescript
async function runMigrations(db: Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )`);

  const applied = db.query("SELECT version FROM _migrations")
    .all()
    .map(r => r.version);

  for (const migration of migrations) {
    if (!applied.includes(migration.version)) {
      db.exec(migration.sql);
      db.run(
        "INSERT INTO _migrations (version, name, applied_at) VALUES (?, ?, ?)",
        [migration.version, migration.name, Date.now()]
      );
    }
  }
}
```

---

## 常用查询模式（Drizzle ORM）

### 加载会话消息

```typescript
import { eq, asc } from "drizzle-orm";

const msgs = db.select()
  .from(messages)
  .where(eq(messages.sessionKey, sessionKey))
  .orderBy(asc(messages.createdAt))
  .all();
```

### 保存 Agent 回复（事务）

```typescript
const rawDb = getRawDatabase();
const tx = rawDb.transaction(() => {
  const db = getDb();
  for (const msg of msgs) {
    db.insert(messages).values({
      id: nanoid(),
      sessionKey,
      role: msg.role,
      content: msg.content,
      toolCalls: msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      model: msg.model ?? null,
      tokenCount: msg.tokenCount ?? 0,
      createdAt: Date.now(),
    }).run();
  }

  db.update(sessions)
    .set({
      messageCount: sql`${sessions.messageCount} + ${msgs.length}`,
      tokenCount: sql`${sessions.tokenCount} + ${totalTokens}`,
      updatedAt: Date.now(),
    })
    .where(eq(sessions.key, sessionKey))
    .run();
});
tx();
```

### 会话压缩

当会话 Token 超出预算时，裁剪早期消息：

```typescript
function compactSession(db: Database, sessionKey: string, maxTokens: number) {
  const session = db.query("SELECT token_count FROM sessions WHERE key = ?").get(sessionKey);
  if (!session || session.token_count <= maxTokens) return;

  // 保留系统消息和最近的消息，删除中间的历史
  const messages = db.query(`
    SELECT id, role, token_count, created_at FROM messages
    WHERE session_key = ? ORDER BY created_at ASC
  `).all(sessionKey);

  let accumulated = 0;
  const toDelete: string[] = [];

  // 从旧到新遍历，标记需要删除的消息
  for (const msg of messages) {
    if (msg.role === "system") continue; // 保留系统消息
    accumulated += msg.token_count || 0;
    if (accumulated > session.token_count - maxTokens) break;
    toDelete.push(msg.id);
  }

  if (toDelete.length > 0) {
    db.run(`DELETE FROM messages WHERE id IN (${toDelete.map(() => "?").join(",")})`, toDelete);
    db.run(`
      UPDATE sessions
      SET message_count = message_count - ?,
          token_count = token_count - ?
      WHERE key = ?
    `, [toDelete.length, accumulated, sessionKey]);
  }
}
```

### 过期媒体清理

```typescript
function cleanExpiredMedia(db: Database) {
  const expired = db.query(`
    SELECT id, path FROM media_files
    WHERE expires_at IS NOT NULL AND expires_at < ?
  `).all(Date.now());

  for (const file of expired) {
    fs.unlinkSync(file.path);
  }

  db.run("DELETE FROM media_files WHERE expires_at IS NOT NULL AND expires_at < ?", [Date.now()]);
  return expired.length;
}
```

---

## 性能优化

### 预编译语句

高频查询使用 `db.query()` 预编译（bun:sqlite 自动缓存 prepared statement）：

```typescript
// 预编译查询，重复调用无需再次解析 SQL
const getSession = db.query("SELECT * FROM sessions WHERE key = ?");
const session = getSession.get(sessionKey);
```

### 批量写入

会话结束后批量写入消息（而非逐条 INSERT），使用事务：

```typescript
const insertBatch = db.transaction((messages) => {
  const stmt = db.query("INSERT INTO messages (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  for (const msg of messages) {
    stmt.run(...Object.values(msg));
  }
});
```

### 索引策略

- 主键查找: 会话键、消息 ID → 主键索引，O(1)
- 会话列表: `idx_sessions_updated` → 按最后活跃时间排序
- 消息加载: `idx_messages_session` → 按会话键+时间复合索引
- 定时任务: `idx_cron_next` → 仅查已启用任务的下次执行时间
- 过期清理: `idx_media_expires` → 部分索引，仅索引有过期时间的记录

### WAL 模式优势

- 读操作不阻塞写操作
- 写操作不阻塞读操作
- 适合 Gateway 场景：频繁读取会话 + 偶尔写入消息
- 自动 checkpoint：WAL 文件达到 1000 页时自动合并
