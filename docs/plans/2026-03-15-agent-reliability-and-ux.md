---
title: "Agent 可靠性与用户体验改进"
summary: "工具重试、结构化日志、Agent Hub UX 重设计的实施方案"
read_when:
  - 实施工具调用重试机制
  - 引入结构化日志系统
  - 改进 Agent Hub 和路由绑定 UI
  - 优化新用户引导流程
---

# Agent 可靠性与用户体验改进

> 基于 `docs/product-analysis-agent-reliability.md` 分析文档，制定具体实施方案。
>
> **状态：✅ 全部完成（2026-03-15）** — Biome check 通过，250 测试全部通过。

## 需求 Review 结论

| 需求 | 现状 | 结论 |
|------|------|------|
| 工具调用重试 | 无任何重试，失败即返回 | ✅ 已实现 |
| 频道投递重试 | 无，send 失败静默丢弃 | ✅ 已实现 |
| 结构化日志 | 191 条 console.* 散布 37 个文件 | ✅ 已替换 |
| 日志持久化 | 无文件输出 | ✅ 已实现 |
| 路由绑定 UI | 无 API、无前端 | ✅ 已实现 |
| 引导流程 Channel 步骤 | 已有但不绑定 Agent | ✅ 已增强 |
| Agent Hub 产品设计 | 命名混乱、默认关闭 | ✅ 已重设计 |

---

## Phase 1: 结构化日志系统（2 天）✅

日志是所有后续改进的基础——没有可观测性，重试逻辑加了也无法验证效果。

### 1.1 新增 `packages/server/src/logger.ts`

```typescript
import pino from "pino";
import { resolve } from "node:path";
import { homedir } from "node:os";

const logDir = resolve(homedir(), ".yanclaw", "logs");

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface LoggerConfig {
	level: LogLevel;
	file: {
		enabled: boolean;
		maxSize: number;   // bytes, default 10MB
		maxFiles: number;  // default 7
	};
	pretty: boolean;       // dev mode pretty-print
}

const DEFAULT: LoggerConfig = {
	level: "info",
	file: { enabled: true, maxSize: 10 * 1024 * 1024, maxFiles: 7 },
	pretty: process.env.NODE_ENV !== "production",
};

export function createLogger(config: Partial<LoggerConfig> = {}) {
	const cfg = { ...DEFAULT, ...config };

	const targets: pino.TransportTargetOptions[] = [];

	if (cfg.pretty) {
		targets.push({ target: "pino-pretty", level: cfg.level, options: { colorize: true } });
	} else {
		targets.push({ target: "pino/file", level: cfg.level, options: { destination: 1 } }); // stdout
	}

	if (cfg.file.enabled) {
		targets.push({
			target: "pino-roll",
			level: cfg.level,
			options: {
				file: resolve(logDir, "gateway"),
				size: `${Math.round(cfg.file.maxSize / 1024)}k`,
				limit: { count: cfg.file.maxFiles },
			},
		});
	}

	return pino({ level: cfg.level, transport: { targets } });
}

// Singleton
let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
	if (!_logger) _logger = createLogger();
	return _logger;
}

export function initLogger(config: Partial<LoggerConfig>): pino.Logger {
	_logger = createLogger(config);
	return _logger;
}

// Module loggers (child instances with module tag)
export const log = {
	gateway: () => getLogger().child({ module: "gateway" }),
	agent: () => getLogger().child({ module: "agent" }),
	channel: () => getLogger().child({ module: "channel" }),
	routing: () => getLogger().child({ module: "routing" }),
	security: () => getLogger().child({ module: "security" }),
	plugin: () => getLogger().child({ module: "plugin" }),
	mcp: () => getLogger().child({ module: "mcp" }),
	cron: () => getLogger().child({ module: "cron" }),
	config: () => getLogger().child({ module: "config" }),
	db: () => getLogger().child({ module: "db" }),
};
```

### 1.2 配置 Schema 新增

```typescript
// packages/server/src/config/schema.ts 的 gatewaySchema 内
logging: z.object({
	level: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
	file: z.object({
		enabled: z.boolean().default(true),
		maxSize: z.number().default(10 * 1024 * 1024),
		maxFiles: z.number().default(7),
	}).default({}),
	pretty: z.boolean().default(true),
}).default({}),
```

### 1.3 替换 console 调用

逐模块替换，每个模块用对应的子 logger：

| 模块 | 文件数 | console 数 | 替换为 |
|------|--------|-----------|--------|
| gateway | 1 | 15 | `log.gateway()` |
| agents | 3 | 25 | `log.agent()` |
| channels | 5 | 40 | `log.channel()` |
| routing | 2 | 5 | `log.routing()` |
| security | 6 | 20 | `log.security()` |
| plugins | 2 | 10 | `log.plugin()` |
| mcp | 2 | 15 | `log.mcp()` |
| cron | 1 | 8 | `log.cron()` |
| config | 2 | 12 | `log.config()` |
| db | 2 | 5 | `log.db()` |
| routes | 6 | 15 | `log.gateway()` |
| 其他 | 5 | 21 | `getLogger()` |

替换规则：

```typescript
// Before
console.log("[agent] Session compacted", sessionKey);
console.error("[channel] Send failed:", err.message);
console.warn("[mcp] Tool refresh error:", err);

// After
log.agent().info({ sessionKey }, "session compacted");
log.channel().error({ err, peer: peer.id }, "send failed");
log.mcp().warn({ err }, "tool refresh error");
```

### 1.4 关键位置增加关联 ID

在 `AgentRuntime.run()` 入口生成 `correlationId`，传播到工具调用和频道投递：

```typescript
// runtime.ts — run() 入口
const correlationId = nanoid(12);
const rlog = log.agent().child({ correlationId, sessionKey, agentId });
rlog.info("agent run started");

// 工具调用
rlog.info({ tool: part.toolName, args: truncate(part.args) }, "tool call");
rlog.error({ tool: part.toolName, err }, "tool call failed");

// 频道投递
log.channel().info({ correlationId, channel, peer: peer.id }, "message sent");
```

### 1.5 安全审计补强

```typescript
// middleware/auth.ts — 认证失败时记录
log.security().warn({ ip: c.req.header("x-forwarded-for"), path: c.req.path }, "auth failed");

// security/leak-detector.ts — 泄漏检测时写审计日志
log.security().error({ sessionKey, pattern: matched }, "credential leak blocked");
await auditLog.write({ action: "leak_blocked", detail: matched, sessionKey });
```

### 1.6 依赖

```bash
bun add pino pino-pretty pino-roll
```

### 1.7 测试要点

- 开发模式下 console 输出带颜色的 pretty-print
- `~/.yanclaw/logs/gateway.log` 文件被创建并写入 JSON 日志
- 文件轮转：超过 10MB 后创建 `gateway.1`
- 搜索 `correlationId` 能关联同一 agent run 的所有日志
- `LOG_LEVEL=debug` 能看到更多信息
- 进程重启后历史日志仍可查看

---

## Phase 2: 工具调用重试机制（2 天）✅

参考 OpenClaw `concepts/retry.md` 的设计，在两个层面添加重试：工具执行层（对 LLM 透明）和频道投递层。

### 2.1 新增 `packages/server/src/agents/tools/retry.ts`

```typescript
import { log } from "../../logger";

export interface RetryConfig {
	/** Max attempts including first try. Default 3. */
	attempts: number;
	/** Backoff strategy. Default "exponential". */
	backoff: "exponential" | "linear" | "fixed";
	/** Base delay in ms. Default 1000. */
	baseDelayMs: number;
	/** Max delay cap in ms. Default 30000. */
	maxDelayMs: number;
	/** Jitter ratio 0-1. Default 0.1. */
	jitter: number;
}

const DEFAULT_RETRY: RetryConfig = {
	attempts: 3,
	backoff: "exponential",
	baseDelayMs: 1000,
	maxDelayMs: 30000,
	jitter: 0.1,
};

/** Errors that should NOT be retried. */
const PERMANENT_PATTERNS = [
	/\b(401|403)\b/,          // Auth/authz
	/\b404\b/,                // Not found
	/\b400\b/,                // Bad request
	/permission denied/i,
	/invalid (api.?key|token)/i,
	/EACCES/,
];

/** Errors that SHOULD be retried. */
const TRANSIENT_PATTERNS = [
	/\b429\b/,                // Rate limit
	/\b(502|503|504)\b/,     // Server errors
	/ECONNRESET/,
	/ETIMEDOUT/,
	/ECONNREFUSED/,
	/ENOTFOUND/,
	/socket hang up/i,
	/network/i,
	/timeout/i,
	/temporarily unavailable/i,
];

export function isTransientError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error);
	if (PERMANENT_PATTERNS.some((p) => p.test(msg))) return false;
	return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

/** Parse Retry-After header value to ms. */
export function parseRetryAfter(value: string | null | undefined): number | null {
	if (!value) return null;
	const seconds = Number(value);
	if (!Number.isNaN(seconds)) return seconds * 1000;
	const date = Date.parse(value);
	if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
	return null;
}

export function computeDelay(attempt: number, config: RetryConfig, retryAfterMs?: number | null): number {
	if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, config.maxDelayMs);
	let delay: number;
	switch (config.backoff) {
		case "exponential": delay = config.baseDelayMs * 2 ** attempt; break;
		case "linear": delay = config.baseDelayMs * (attempt + 1); break;
		case "fixed": delay = config.baseDelayMs; break;
	}
	// Apply jitter: delay × (1 ± jitter)
	const jitter = delay * config.jitter * (2 * Math.random() - 1);
	return Math.min(delay + jitter, config.maxDelayMs);
}

/**
 * Wrap an async function with retry logic.
 * Only retries on transient errors. Permanent errors throw immediately.
 */
export async function withRetry<T>(
	fn: () => Promise<T>,
	config: Partial<RetryConfig> = {},
	context?: { tool?: string; correlationId?: string },
): Promise<T> {
	const cfg = { ...DEFAULT_RETRY, ...config };
	const rlog = log.agent();
	let lastError: unknown;

	for (let attempt = 0; attempt < cfg.attempts; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (!isTransientError(err) || attempt >= cfg.attempts - 1) throw err;
			const delay = computeDelay(attempt, cfg);
			rlog.warn(
				{ tool: context?.tool, attempt: attempt + 1, delay, err: String(err), correlationId: context?.correlationId },
				"transient error, retrying",
			);
			await Bun.sleep(delay);
		}
	}
	throw lastError;
}
```

### 2.2 配置 Schema 新增

```typescript
// config/schema.ts — toolsSchema 内
retry: z.object({
	enabled: z.boolean().default(true),
	attempts: z.number().min(1).max(10).default(3),
	backoff: z.enum(["exponential", "linear", "fixed"]).default("exponential"),
	baseDelayMs: z.number().default(1000),
	maxDelayMs: z.number().default(30000),
	jitter: z.number().min(0).max(1).default(0.1),
}).default({}),
```

### 2.3 工具层集成

在 `tools/index.ts` 的 `createTools()` 中，对网络类工具包装重试：

```typescript
// 可安全重试的工具（幂等或只读）
const RETRYABLE_TOOLS = new Set([
	"web_fetch",         // GET 请求，幂等
	"web_search",        // 查询操作，幂等
	"memory_search",     // 只读
	"memory_list",       // 只读
	"browser_navigate",  // 导航，幂等
	"browser_screenshot",// 截图，幂等
]);

// 不重试的工具（有副作用）
// shell, file_write, file_edit, memory_store, memory_delete, code_exec, session_send
// → 这些工具的错误直接返回给 LLM 决策

function wrapWithRetry(tool: CoreTool, name: string, retryConfig: RetryConfig, correlationId?: string) {
	if (!RETRYABLE_TOOLS.has(name)) return tool;
	const original = tool.execute;
	return {
		...tool,
		execute: async (...args) => {
			return withRetry(() => original(...args), retryConfig, { tool: name, correlationId });
		},
	};
}
```

### 2.4 频道投递层重试

在 `channels/manager.ts` 的消息发送处添加重试：

```typescript
// manager.ts — sendResponse() 或 handleInbound() 的 adapter.send() 调用处
import { withRetry, parseRetryAfter } from "../agents/tools/retry";

// 每个频道类型的默认延迟
const CHANNEL_RETRY_DEFAULTS: Record<string, Partial<RetryConfig>> = {
	telegram: { baseDelayMs: 400 },
	discord: { baseDelayMs: 500 },
	slack: { baseDelayMs: 300 },
};

async function sendWithRetry(adapter: ChannelAdapter, peer: Peer, payload: SendPayload, channelType: string) {
	const retryConfig = CHANNEL_RETRY_DEFAULTS[channelType] ?? {};
	return withRetry(
		() => adapter.send(peer, payload),
		retryConfig,
		{ tool: `channel:${channelType}:send` },
	);
}
```

### 2.5 runtime.ts 集成

在 `streamText()` 的 tool call 错误处理中区分瞬态/永久错误，记录重试信息：

```typescript
// 当前：工具失败 → 直接返回错误字符串
// 改后：幂等工具失败 → withRetry → 仍失败才返回错误字符串
// 副作用工具 → 直接返回（不自动重试，让 LLM 决策）
```

### 2.6 测试要点

- web_fetch 遇到 429 → 等待后自动重试 → 成功返回内容
- web_fetch 遇到 401 → 不重试 → 直接返回错误
- shell 命令失败 → 不自动重试 → 错误返回给 LLM
- Telegram send 遇到 rate limit → 自动重试 → 消息成功发出
- 3 次都失败 → 最终错误返回给 LLM
- 日志中能看到 `"transient error, retrying"` + attempt 编号 + delay

---

## Phase 3: 路由绑定 UI + 引导流程（3 天）✅

这是解决新用户核心断裂（"频道连上了但 Agent 不回复"）的关键。

### 3.1 路由绑定 API

新增 `packages/server/src/routes/routing.ts`：

```typescript
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { GatewayContext } from "../gateway";

const app = new Hono<{ Variables: { gw: GatewayContext } }>();

// GET /api/routing — 获取当前路由配置
app.get("/", (c) => {
	const gw = c.get("gw");
	const { routing } = gw.config.get();
	return c.json(routing);
});

// GET /api/routing/bindings — 获取所有绑定
app.get("/bindings", (c) => {
	const gw = c.get("gw");
	const { routing } = gw.config.get();
	return c.json(routing.bindings ?? []);
});

// POST /api/routing/bindings — 添加绑定
const bindingBody = z.object({
	channel: z.string().optional(),
	account: z.string().optional(),
	peer: z.string().optional(),
	guild: z.string().optional(),
	roles: z.array(z.string()).optional(),
	group: z.string().optional(),
	agent: z.string(),
	dmScope: z.enum(["main", "per-peer", "per-channel-peer"]).optional(),
	priority: z.number().optional(),
});

app.post("/bindings", zValidator("json", bindingBody), async (c) => {
	const gw = c.get("gw");
	const binding = c.req.valid("json");
	const config = gw.config.get();
	const bindings = [...(config.routing.bindings ?? []), binding];
	await gw.config.patch({ routing: { ...config.routing, bindings } });
	return c.json(binding, 201);
});

// DELETE /api/routing/bindings/:index — 按索引删除绑定
app.delete("/bindings/:index", async (c) => {
	const gw = c.get("gw");
	const index = Number(c.req.param("index"));
	const config = gw.config.get();
	const bindings = [...(config.routing.bindings ?? [])];
	if (index < 0 || index >= bindings.length) return c.json({ error: "Not found" }, 404);
	bindings.splice(index, 1);
	await gw.config.patch({ routing: { ...config.routing, bindings } });
	return c.json({ ok: true });
});

// PATCH /api/routing — 更新默认 agent 和 dmScope
app.patch("/", zValidator("json", z.object({
	default: z.string().optional(),
	dmScope: z.enum(["main", "per-peer", "per-channel-peer"]).optional(),
})), async (c) => {
	const gw = c.get("gw");
	const patch = c.req.valid("json");
	const config = gw.config.get();
	await gw.config.patch({ routing: { ...config.routing, ...patch } });
	return c.json({ ok: true });
});

// GET /api/routing/test — 测试路由解析（调试用）
app.get("/test", zValidator("query", z.object({
	channel: z.string(),
	peer: z.string().optional(),
	guild: z.string().optional(),
})), (c) => {
	const gw = c.get("gw");
	const query = c.req.valid("query");
	const result = gw.routing.resolve(gw.config.get(), {
		channel: query.channel,
		peerId: query.peer ?? "test",
		peerName: "test",
	});
	return c.json(result);
});

export default app;
```

注册到 `app.ts`：

```typescript
import routing from "./routes/routing";
app.route("/api/routing", routing);
```

### 3.2 Channels 页面增加路由绑定

改造 `packages/web/src/pages/Channels.tsx`，在每个频道卡片下方显示绑定：

```
┌─────────────────────────────────────────────────────┐
│  🟢 Telegram (@my_bot)                    [断开]    │
│  ───────────────────────────────────────────────     │
│  路由规则:                                          │
│  · 默认 → main                           [编辑]    │
│  · 用户 @alice → research                [× 删除]  │
│  [+ 添加路由规则]                                   │
└─────────────────────────────────────────────────────┘
```

实现要点：

```typescript
// 新增 hooks/useRouting.ts
export function useRouting() {
	const [bindings, setBindings] = useState<Binding[]>([]);

	const fetchBindings = async () => {
		const res = await apiFetch("/api/routing/bindings");
		setBindings(await res.json());
	};

	const addBinding = async (binding: Partial<Binding>) => {
		await apiFetch("/api/routing/bindings", { method: "POST", body: JSON.stringify(binding) });
		await fetchBindings();
	};

	const removeBinding = async (index: number) => {
		await apiFetch(`/api/routing/bindings/${index}`, { method: "DELETE" });
		await fetchBindings();
	};

	return { bindings, fetchBindings, addBinding, removeBinding };
}
```

频道卡片内嵌绑定列表：

```typescript
// Channels.tsx — ChannelCard 内
function ChannelBindings({ channelType, accountId, bindings, agents, onAdd, onRemove }) {
	// 过滤出属于当前频道的 bindings
	const myBindings = bindings.filter(b => b.channel === channelType);
	const defaultAgent = routing.default ?? "main";

	return (
		<div className="mt-3 border-t border-zinc-800 pt-3">
			<div className="text-xs text-zinc-500 mb-2">路由规则</div>
			{/* 默认路由（总是显示） */}
			<div className="flex items-center gap-2 text-sm">
				<span className="text-zinc-400">默认</span>
				<span className="text-zinc-200">→ {defaultAgent}</span>
			</div>
			{/* 自定义绑定 */}
			{myBindings.map((b, i) => (
				<div key={i} className="flex items-center gap-2 text-sm">
					<span className="text-zinc-400">{b.peer ?? b.guild ?? "all"}</span>
					<span className="text-zinc-200">→ {b.agent}</span>
					<button onClick={() => onRemove(i)} className="text-red-400 text-xs">×</button>
				</div>
			))}
			{/* 添加按钮 */}
			<AddBindingButton channelType={channelType} agents={agents} onAdd={onAdd} />
		</div>
	);
}
```

### 3.3 添加绑定对话框

```
┌─ 添加路由规则 ──────────────────────────┐
│                                          │
│  频道: Telegram (@my_bot)  (只读)        │
│                                          │
│  匹配条件:                               │
│  ┌──────────────────────────────┐       │
│  │ ○ 所有消息（频道默认）       │       │
│  │ ○ 指定用户 [________]        │       │
│  │ ○ 指定群组 [________]        │       │
│  └──────────────────────────────┘       │
│                                          │
│  回复的 AI 助手:                         │
│  ┌──────────────────────────────┐       │
│  │ [main ▾]                     │       │
│  └──────────────────────────────┘       │
│                                          │
│  [取消]                     [添加]       │
└──────────────────────────────────────────┘
```

### 3.4 引导流程增强

修改 `packages/web/src/pages/Onboarding.tsx` Step 2（Channels）：

当前 Step 2 只填 Token 连接频道。改进后在连接成功时自动创建 binding：

```typescript
// Onboarding.tsx — Step 2 提交时
async function handleChannelAdd(type: string, account: ChannelAccount) {
	// 1. 添加频道（已有逻辑）
	await apiFetch("/api/channels", {
		method: "POST",
		body: JSON.stringify({ type, accounts: [account] }),
	});

	// 2. 自动绑定 main agent（新增）
	await apiFetch("/api/routing/bindings", {
		method: "POST",
		body: JSON.stringify({ channel: type, agent: "main" }),
	});

	// 3. 连接频道
	await apiFetch(`/api/channels/${type}/${account.id}/connect`, { method: "POST" });
}
```

Step 3 增加提示文案：

```
✅ 设置完成！

你的 AI 助手 (main) 已绑定到：
  · WebChat（网页对话）
  · Telegram (@my_bot)

在任意平台发送消息即可开始对话。
如需添加更多 AI 助手或自定义路由，前往「AI 助手」和「频道」页面管理。
```

### 3.5 测试要点

- `GET /api/routing/bindings` 返回当前绑定列表
- `POST /api/routing/bindings` 添加后 hot-reload 生效
- Channels 页面每个频道卡片显示对应的路由规则
- 添加路由规则对话框可选 peer/guild/all + agent
- 删除路由规则后频道的消息回退到 default agent
- Onboarding Step 2 添加 Telegram → 自动创建 binding → main agent 能收到消息
- `GET /api/routing/test?channel=telegram&peer=123` 返回正确的路由解析结果

---

## Phase 4: Agent Hub 产品重设计（2 天）✅

### 4.1 重命名

| 当前 | 改为 | 理由 |
|------|------|------|
| Agents 页面 | **AI 助手** | 用户语言，非技术术语 |
| Agent Hub 页面 | **任务中心** | 直接表达功能——管理自主任务 |
| 侧边栏 "Agent Hub" | **任务** | 简短 |

前端文件改动：

```
pages/Agents.tsx       → 页面标题改为 "AI 助手"
pages/AgentHub.tsx     → 页面标题改为 "任务中心"
App.tsx 侧边栏         → "Agents" → "AI 助手"，"Agent Hub" → "任务"
```

### 4.2 Agent 卡片增加"任务"能力开关

在 `pages/Agents.tsx` 的 AgentCard 和 EditDialog 中：

```typescript
// Agent 卡片右上角
<Badge variant={agent.taskEnabled ? "default" : "outline"}>
	{agent.taskEnabled ? "可执行任务" : "仅对话"}
</Badge>

// 编辑对话框新增
<div className="flex items-center justify-between">
	<label>允许自主任务（Agent Hub）</label>
	<Switch checked={form.taskEnabled} onCheckedChange={v => setForm({...form, taskEnabled: v})} />
</div>
```

后端：在 `agentSchema` 中已有 `heartbeat` 和 `runtime` 字段可推导，新增 `taskEnabled` 布尔字段：

```typescript
// config/schema.ts — agentSchema
taskEnabled: z.boolean().default(false),
```

### 4.3 任务中心入口简化

当前 Agent Hub 需要 `agentHub.enabled: true` 才显示。改为：

- 侧边栏始终显示"任务"入口
- 如果没有任何 `taskEnabled: true` 的 agent → 显示引导页：

```
┌─ 任务中心 ──────────────────────────────┐
│                                          │
│  📋 自主任务功能                         │
│                                          │
│  让 AI 助手独立执行多步骤任务：          │
│  编写代码 → 运行测试 → 修复错误 → 提交   │
│                                          │
│  前往「AI 助手」页面，开启某个助手的     │
│  "允许自主任务" 开关即可开始使用。       │
│                                          │
│  [前往 AI 助手页面]                      │
└──────────────────────────────────────────┘
```

- 如果有 `taskEnabled` agent → 显示正常任务列表 + 创建按钮

### 4.4 App.tsx 侧边栏调整

```typescript
// 当前 10 个入口 → 精简为 7 个核心入口
const NAV_ITEMS = [
	{ path: "/chat",       label: "对话",     icon: MessageSquare },
	{ path: "/agents",     label: "AI 助手",  icon: Bot },
	{ path: "/channels",   label: "频道",     icon: Radio },
	{ path: "/tasks",      label: "任务",     icon: ListTodo },
	{ path: "/knowledge",  label: "知识库",   icon: Brain },
	{ path: "/settings",   label: "设置",     icon: Settings },
];

// 折叠到"更多"或二级：
// - Sessions → 合并到 Chat 页面侧边栏（已有 session 列表）
// - Skills → 合并到 AI 助手编辑页
// - MCP → 合并到 Settings
// - Cron → 合并到任务中心
```

### 4.5 测试要点

- 侧边栏显示新名称（AI 助手、任务）
- Agent 卡片显示"可执行任务"/"仅对话"标记
- Agent 编辑对话框有任务开关
- 任务页面无 taskEnabled agent 时显示引导
- 任务页面有 taskEnabled agent 时显示任务列表
- 创建任务只能选 taskEnabled 的 agent

---

## 影响范围汇总

| 文件 | Phase | 变更类型 |
|------|-------|---------|
| `server/src/logger.ts` | 1 | **新增** |
| `server/src/config/schema.ts` | 1, 2 | 修改（logging + retry + taskEnabled） |
| `server/src/gateway.ts` | 1 | 修改（initLogger 调用） |
| `server/src/index.ts` | 1 | 修改（替换 console） |
| `server/src/agents/runtime.ts` | 1, 2 | 修改（logger + correlationId + retry 集成） |
| `server/src/agents/tools/retry.ts` | 2 | **新增** |
| `server/src/agents/tools/index.ts` | 2 | 修改（wrapWithRetry） |
| `server/src/channels/manager.ts` | 1, 2 | 修改（logger + sendWithRetry） |
| `server/src/channels/telegram.ts` | 1 | 修改（替换 console） |
| `server/src/channels/discord.ts` | 1 | 修改（替换 console） |
| `server/src/channels/slack.ts` | 1 | 修改（替换 console） |
| `server/src/security/*.ts` | 1 | 修改（替换 console） |
| `server/src/plugins/*.ts` | 1 | 修改（替换 console） |
| `server/src/mcp/*.ts` | 1 | 修改（替换 console） |
| `server/src/routes/routing.ts` | 3 | **新增** |
| `server/src/app.ts` | 3 | 修改（注册 routing 路由） |
| `web/src/pages/Channels.tsx` | 3 | 修改（绑定列表 + 添加对话框） |
| `web/src/pages/Onboarding.tsx` | 3 | 修改（自动绑定 + 完成提示） |
| `web/src/hooks/useRouting.ts` | 3 | **新增** |
| `web/src/pages/Agents.tsx` | 4 | 修改（改名 + taskEnabled 开关） |
| `web/src/pages/AgentHub.tsx` | 4 | 修改（改名 + 引导页） |
| `web/src/App.tsx` | 4 | 修改（侧边栏重组） |

## 依赖关系

```
Phase 1 (日志)  ←──  Phase 2 (重试) 依赖日志记录重试行为
    ↓
Phase 3 (路由UI) ←── 无依赖，可与 Phase 2 并行
    ↓
Phase 4 (UX重设计) ←── 建议在 Phase 3 后做（路由 UI 先就位）
```

## 实施顺序

```
Day 1-2: Phase 1 — 结构化日志（基础设施）
Day 3-4: Phase 2 + Phase 3 并行
  - Phase 2: 重试机制（后端）
  - Phase 3: 路由 API + Channels 页面绑定 UI + Onboarding 增强
Day 5-6: Phase 4 — Agent Hub 重设计（前端重组）
```

## 不做的事情

| 功能 | 理由 |
|------|------|
| Sentry 集成 | Pino + 文件日志已满足当前规模，等用户量增长再加 |
| OpenTelemetry | 过度工程化，当前单进程架构不需要分布式追踪 |
| 路由优先级可视化调试器 | 等路由绑定 UI 上线后看反馈再做 |
| Block streaming（频道分块流式） | 功能独立，不在本次可靠性改进范围内 |
| 会话自动重置 UI | 已有 config 支持，等用户需求再做 UI |
| 完整的 Agent 高级配置 UI | tools/capabilities/bootstrap 只影响高级用户，优先级低 |
