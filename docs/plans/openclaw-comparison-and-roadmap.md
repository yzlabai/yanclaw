# OpenClaw 深度分析与 YanClaw 实现路线图

> 基于 OpenClaw 源码（`D:\ai\works\openclaw`）的逐模块分析，提炼 YanClaw 应学习、改进或差异化的方向。

---

## 目录

1. [心跳机制（Heartbeat）](#1-心跳机制heartbeat)
2. [智能体基础能力（Agent Primitives）](#2-智能体基础能力agent-primitives)
3. [系统上下文（System Context）](#3-系统上下文system-context)
4. [上下文压缩（Compaction）](#4-上下文压缩compaction)
5. [记忆系统（Memory）](#5-记忆系统memory)
6. [会话管理（Session）](#6-会话管理session)
7. [Token 追踪与成本控制](#7-token-追踪与成本控制)
8. [工具审批流程（Tool Approval）](#8-工具审批流程tool-approval)
9. [实现优先级建议](#9-实现优先级建议)

---

## 1. 心跳机制（Heartbeat）

### OpenClaw 做了什么

OpenClaw 的心跳不是 TCP keepalive，而是**定时唤醒智能体执行一个完整推理轮次**：

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `heartbeat.every` | `30m` | 心跳间隔 |
| `heartbeat.activeHours` | 全天 | 活跃时段（HH:MM + IANA 时区），静默时段跳过 |
| `heartbeat.target` | `"last"` | 交付目标：最近外部渠道 / `"none"` 内部执行 / 指定渠道 |
| `heartbeat.lightContext` | `false` | 轻量模式，仅注入 HEARTBEAT.md |
| `heartbeat.ackMaxChars` | `300` | HEARTBEAT_OK 回复最大字符数，超过则正常交付 |

**执行流程**：

```
定时器触发 → 检查 activeHours → 读取 HEARTBEAT.md
  → 如果内容为空 → 跳过（零 API 消耗）
  → 如果有任务 → 先执行低成本确定性检查（邮件/日历/告警）
    → 有异常 → 升级到 LLM 推理
    → 无异常 → 返回 HEARTBEAT_OK（被静默吞掉）
```

**关键设计**：
- **二级成本优化**：先走便宜的确定性检查，再走 LLM
- **会话时间戳保护**：HEARTBEAT_OK 回复不更新 `updatedAt`，不影响空闲过期
- **Transcript 回滚**：OK 回复会截断心跳轮次的 transcript，防止上下文污染
- **Keepalive 看门狗**：60s 短定时器验证主心跳定时器是否存活（解决 macOS 休眠杀定时器问题）

### YanClaw 当前状态

YanClaw 有 `HealthMonitor`（渠道连接健康检测 + 指数退避重连）和 `startCron` 定时任务，但**没有智能体级心跳**。

### YanClaw 应如何实现

**方案：在现有 Cron 基础上扩展 HeartbeatRunner**

```
packages/server/src/infra/heartbeat.ts      ← 核心调度器
packages/server/src/infra/heartbeat-config.ts ← 配置解析
```

**核心设计**：

```typescript
// config.json5 中
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        activeHours: { start: "08:00", end: "23:00", timezone: "Asia/Shanghai" },
        target: "last",        // 最近活跃渠道 | "none" | 渠道ID
        lightContext: false,
        ackToken: "HEARTBEAT_OK",
        ackMaxChars: 300,
        prompt: "检查 HEARTBEAT.md 中的任务列表，按指示执行。如无需处理，回复 HEARTBEAT_OK。"
      }
    }
  }
}
```

**实现要点**：

1. **复用 Cron 基础设施**：HeartbeatRunner 注册为一个特殊 CronJob，共享调度循环
2. **HEARTBEAT.md 空检测**：解析文件，只有标题/空行时跳过（零 API 成本）
3. **会话隔离**：心跳使用独立 session 或复用 agent 的 main session，HEARTBEAT_OK 回复不更新 `updatedAt`
4. **交付路由**：`target: "last"` 查 SessionStore 最近活跃的外部渠道发送；`"none"` 只执行不发送
5. **成本控制**：`lightContext: true` 时系统提示只注入 HEARTBEAT.md 内容，大幅减少 token

**比 OpenClaw 更好的点**：
- OpenClaw 心跳和 Cron 是两套独立系统；YanClaw 统一在 CronManager 下，配置更简洁
- OpenClaw 的 HEARTBEAT.md 是纯文本指令；YanClaw 可以结合结构化的 JSON5 任务定义，支持条件触发

---

## 2. 智能体基础能力（Agent Primitives）

### OpenClaw 内建工具清单

| 类别 | 工具 | 说明 |
|------|------|------|
| **执行** | `exec` | Shell 命令，safeBins 白名单 |
| **文件** | `read`, `write`, `edit`, `apply_patch` | 工作区文件操作 |
| **浏览器** | `browser` | Playwright/CDP 控制 |
| **记忆** | `memory_search`, `memory_get` | 混合搜索 + 定向读取 |
| **会话** | `sessions_list/history/send/spawn` | 跨会话通信、子智能体 |
| **画布** | `canvas.push/eval/snapshot` | A2UI 可视化界面 |
| **设备** | `node.invoke`, `camera.*`, `screen.*` | 物理设备控制 |
| **消息** | `message` | 跨渠道消息发送 |
| **自动化** | `cron`, `gateway` | 定时任务 + 网关管理 |
| **媒体** | `image`, `tts` | 视觉理解 + 语音合成 |

**工具配置档（Profile）**：`minimal` / `coding` / `messaging` / `full`

**SafeBins 机制**：对 `jq`、`grep`、`curl` 等常用命令限制为 stdin-only + 禁止危险参数，绕过审批。

**工具循环检测**：追踪最近 30 次调用的 SHA256 哈希，检测：
- 泛型重复（同一调用 10+ 次）
- 轮询无进展（`process` poll 输出不变）
- 乒乓循环（A→B→A→B...）
- 阈值：10 次警告 / 20 次阻断 / 30 次熔断

### YanClaw 当前状态

已有工具：`shell`、`file_read/write/edit`、`web_search/fetch`、`memory_store/search/delete`、`browser_navigate/screenshot/action`

YanClaw 的 3 层工具策略（global → agent → channel）+ ownerOnly + Docker sandbox 在**安全性上已超越 OpenClaw**。

### YanClaw 应补充的能力

#### 2.1 SafeBins 安全白名单

```typescript
// packages/server/src/agents/tools/safe-bins.ts
const SAFE_BIN_PROFILES: Record<string, SafeBinProfile> = {
  jq:   { maxPositional: 1, deniedFlags: new Set(["--rawfile", "--slurpfile"]) },
  grep: { maxPositional: 0, deniedFlags: new Set(["-f", "-r", "-R"]) },  // stdin-only
  curl: { deniedFlags: new Set(["--proxy", "--proxy-user"]) },
  cut:  { maxPositional: 0 },
  head: { maxPositional: 0 },
  tail: { maxPositional: 0 },
};
```

**价值**：常用管道命令无需每次审批，既安全又流畅。

#### 2.2 工具循环检测

```typescript
// packages/server/src/agents/tools/loop-detector.ts
interface LoopDetectorConfig {
  historySize: number;      // 30
  warningThreshold: number; // 10
  blockThreshold: number;   // 20
  circuitBreaker: number;   // 30
}
```

在现有 `beforeToolCall` 插件钩子中注入循环检测逻辑。

**价值**：防止 agent 陷入无意义循环浪费 token，OpenClaw 用户反馈这是高频问题。

#### 2.3 跨会话通信

```typescript
// 新增工具
sessions_list:    列出当前活跃会话
sessions_send:    向另一个会话发消息（agent-to-agent）
sessions_history: 读取会话历史
```

**价值**：支持多智能体协作场景（如一个 agent 做研究，另一个做执行）。

#### 2.4 工具配置档

```typescript
// config.json5
{
  agents: {
    defaults: {
      toolProfile: "coding",  // minimal | coding | messaging | full
      tools: { allow: [...], deny: [...] }  // 在 profile 基础上微调
    }
  }
}
```

**比 OpenClaw 更好**：OpenClaw 的 profile 是硬编码的 4 种；YanClaw 可以让用户自定义 profile 并组合叠加。

---

## 3. 系统上下文（System Context）

### OpenClaw 的系统提示结构

OpenClaw 在每次 agent run 时动态组装系统提示，固定顺序：

```
1. Identity       — "You are a personal assistant running inside OpenClaw."
2. Tooling        — 当前可用工具列表
3. Tool Style     — 工具调用叙述风格指导
4. Safety         — 权力寻求/监督绕过的安全护栏
5. Skills         — 可用技能列表（按需 read 加载）
6. Memory Recall  — memory_search/memory_get 使用说明
7. Self-Update    — config.apply / update.run 指令
8. Model Aliases  — 模型别名
9. Date & Time    — 用户时区（不注入动态时间，为缓存稳定性）
10. Workspace     — 工作目录
11. Docs          — 文档路径
12. Bootstrap Files — AGENTS.md / SOUL.md / TOOLS.md / IDENTITY.md / USER.md /
                      HEARTBEAT.md / BOOTSTRAP.md / MEMORY.md（按文件注入）
13. Sandbox       — 沙箱环境信息
14. Reply Tags    — 回复标记语法
15. Messaging     — 会话/子智能体/多渠道路由
16. Runtime       — 主机/OS/Node/模型/思考深度
```

**Bootstrap 文件限制**：
- 单文件上限：20,000 chars（70% 头 + 20% 尾 + 10% 截断标记）
- 总上限：150,000 chars
- 子智能体只注入 AGENTS.md + TOOLS.md

**提示模式**：
- `full`：完整注入（主会话）
- `minimal`：精简版（子智能体、Cron 会话）
- `none`：仅 identity 行

### YanClaw 当前状态

YanClaw 的系统提示在 `packages/server/src/agents/runtime.ts` 中构建，包含：
- Agent 身份描述（`agent.systemPrompt`）
- 工具描述（由 Vercel AI SDK 自动注入）
- 渠道/用户上下文

**缺失的关键能力**：
- 没有分层 bootstrap 文件注入
- 没有提示模式区分
- 没有 token 预算管理
- 没有截断策略

### YanClaw 应如何实现

#### 3.1 分层系统提示构建器

```typescript
// packages/server/src/agents/system-prompt-builder.ts

interface SystemPromptConfig {
  mode: "full" | "minimal" | "none";
  bootstrapMaxChars: number;       // 默认 20000
  bootstrapTotalMaxChars: number;  // 默认 150000
}

function buildSystemPrompt(ctx: {
  agent: AgentConfig;
  channel: ChannelInfo;
  session: SessionEntry;
  mode: PromptMode;
  tools: ToolDefinition[];
}): string {
  const sections: string[] = [];

  // 1. Identity
  sections.push(ctx.agent.systemPrompt || DEFAULT_IDENTITY);

  // 2. Safety guardrails
  sections.push(SAFETY_PROMPT);

  // 3. Tool usage guidance
  if (ctx.mode !== "none") {
    sections.push(buildToolGuidance(ctx.tools));
  }

  // 4. Bootstrap files (workspace context)
  if (ctx.mode === "full") {
    sections.push(buildBootstrapContext(ctx.agent, ctx.session));
  }

  // 5. Runtime info
  sections.push(buildRuntimeInfo(ctx));

  // 6. Channel-specific context
  sections.push(buildChannelContext(ctx.channel, ctx.session));

  return sections.filter(Boolean).join("\n\n");
}
```

#### 3.2 Bootstrap 文件机制

```
~/.yanclaw/agents/<agentId>/
├── SOUL.md          ← 身份/性格/价值观
├── TOOLS.md         ← 工具使用指导
├── MEMORY.md        ← 长期记忆
├── HEARTBEAT.md     ← 心跳任务
└── BOOTSTRAP.md     ← 首次运行指导
```

**配置**：
```json5
{
  agents: {
    defaults: {
      bootstrap: {
        maxCharsPerFile: 20000,
        totalMaxChars: 150000,
        truncationRatio: { head: 0.7, tail: 0.2 },  // 截断时保留头尾比例
        files: ["SOUL.md", "TOOLS.md", "MEMORY.md", "HEARTBEAT.md", "BOOTSTRAP.md"]
      }
    }
  }
}
```

**比 OpenClaw 更好**：
- OpenClaw 的 bootstrap 文件列表是硬编码的 8 个；YanClaw 允许用户自定义文件列表和加载顺序
- OpenClaw 的截断是静态的 70/20 比例；YanClaw 可配置
- YanClaw 的 Zod 校验能在配置加载时就检查 bootstrap 文件路径有效性

---

## 4. 上下文压缩（Compaction）

### OpenClaw 的实现

当会话 token 接近上下文窗口时自动触发：

```
token 估算 → 超过阈值（contextWindow - reserve - softThreshold）
  → 记忆冲刷（将重要信息写入 memory/YYYY-MM-DD.md）
  → LLM 摘要（将旧消息总结为紧凑条目）
  → 持久化摘要到 JSONL
  → 用压缩后的上下文重试原始请求
  → 重新注入关键段落（从 AGENTS.md 提取"Session Startup"和"Red Lines"）
```

**关键配置**：
- `compaction.model`：可用更便宜的模型做摘要
- `compaction.identifierPolicy`：`strict` 保留所有 UUID/hash/ID
- `memoryFlush.softThresholdTokens`：4000 tokens 预留给冲刷
- `postCompactionSections`：压缩后重新注入的 AGENTS.md 段落

**对比 Pruning（修剪）**：
- Pruning = 内存中临时裁剪工具输出，不持久化
- Compaction = LLM 摘要 + 持久化写入

### YanClaw 当前状态

YanClaw 只有 `SessionStore.pruneStale(days)` 清理过期会话（默认 90 天），**没有上下文窗口内的压缩机制**。长对话会直接撞到模型的上下文限制。

### YanClaw 应如何实现

#### 4.1 自动压缩引擎

```typescript
// packages/server/src/agents/compaction.ts

interface CompactionConfig {
  enabled: boolean;          // 默认 true
  model?: string;            // 摘要用模型，可选更便宜的
  targetRatio: number;       // 压缩后目标 token 比例，默认 0.4
  reserveTokens: number;     // 预留 token，默认 4096
  identifierPolicy: "strict" | "off";
  memoryFlush: {
    enabled: boolean;        // 默认 true
    softThresholdTokens: number;  // 默认 4000
  };
}

async function compactSession(
  session: SessionEntry,
  messages: Message[],
  config: CompactionConfig,
  modelManager: ModelManager
): Promise<{ summary: string; prunedCount: number }> {
  // 1. 估算当前 token 用量
  const tokenEstimate = estimateTokens(messages);

  // 2. 记忆冲刷（可选）
  if (config.memoryFlush.enabled) {
    await flushMemoryBeforeCompaction(session, messages);
  }

  // 3. 选择摘要模型（可以用便宜模型）
  const summaryModel = config.model || session.model;

  // 4. 分块摘要
  const oldMessages = messages.slice(0, -KEEP_RECENT);
  const summary = await summarizeMessages(oldMessages, summaryModel, {
    identifierPolicy: config.identifierPolicy,
  });

  // 5. 替换旧消息为摘要
  return { summary, prunedCount: oldMessages.length };
}
```

#### 4.2 触发时机

在 `streamText` 调用前检查：

```typescript
// packages/server/src/agents/runtime.ts 的 agent loop 中
const contextUsage = estimateContextUsage(messages, systemPrompt);
if (contextUsage > model.contextWindow * 0.85) {
  const { summary, prunedCount } = await compactSession(session, messages, config);
  messages = [{ role: "system", content: `[会话摘要]\n${summary}` }, ...recentMessages];
  logger.info(`Compacted ${prunedCount} messages into summary`);
}
```

**比 OpenClaw 更好**：
- OpenClaw 的压缩后需要**重试整个请求**，可能浪费一次 API 调用；YanClaw 在发送前检查，避免浪费
- OpenClaw 的 identifier preservation 使用正则匹配；YanClaw 可以利用 Zod schema 做结构化保留
- YanClaw 的压缩可以结合已有的 FTS5 记忆系统，自动将关键信息索引入记忆库

---

## 5. 记忆系统（Memory）

### OpenClaw vs YanClaw 对比

| 维度 | OpenClaw | YanClaw |
|------|----------|---------|
| 存储 | Markdown 文件（`memory/*.md`） | SQLite（FTS5 + embedding BLOB） |
| 索引 | 独立 SQLite（`~/.openclaw/memory/<agentId>.sqlite`） | 内嵌 bun:sqlite |
| 分块 | 400 token / 80 overlap | 需确认当前实现 |
| 文本搜索 | FTS5 BM25 | FTS5 |
| 向量搜索 | cosine via sqlite-vec 或 JS fallback | JS-side cosine similarity |
| 混合权重 | 70% 向量 / 30% 文本（可配） | 需确认 |
| MMR 去重 | ✅ lambda=0.7 Jaccard | ❌ |
| 时间衰减 | ✅ 30 天半衰期，常青文件豁免 | ❌ |
| 本地嵌入 | ✅ GGUF 模型自动下载 | ❌ |
| 会话索引 | ✅ 实验性（delta 100KB/50条） | ❌ |
| 嵌入缓存 | ✅ 50,000 条 | 需确认 |

### YanClaw 应补充的能力

#### 5.1 MMR 去重

```typescript
// packages/server/src/db/memories.ts 中添加

function applyMMR(
  results: SearchResult[],
  lambda: number = 0.7,
  topK: number = 10
): SearchResult[] {
  const selected: SearchResult[] = [];
  const remaining = [...results];

  while (selected.length < topK && remaining.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const relevance = remaining[i].score;
      const maxSim = selected.length === 0 ? 0 :
        Math.max(...selected.map(s => jaccardSimilarity(s.text, remaining[i].text)));
      const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }

    selected.push(remaining.splice(bestIdx, 1)[0]);
  }

  return selected;
}
```

**价值**：避免返回大量语义相近的记忆碎片，提升 recall 质量。

#### 5.2 时间衰减

```typescript
function applyTemporalDecay(
  results: SearchResult[],
  halfLifeDays: number = 30
): SearchResult[] {
  const lambda = Math.LN2 / halfLifeDays;
  const now = Date.now();

  return results.map(r => {
    const ageDays = (now - r.createdAt) / (1000 * 60 * 60 * 24);
    const decay = Math.exp(-lambda * ageDays);
    return { ...r, score: r.score * decay };
  }).sort((a, b) => b.score - a.score);
}
```

#### 5.3 记忆冲刷（Memory Flush）

在上下文压缩前自动将关键信息持久化到记忆库：

```typescript
async function flushMemoryBeforeCompaction(
  session: SessionEntry,
  messages: Message[],
  memoryStore: MemoryStore
): Promise<void> {
  // 用便宜模型提取关键事实
  const facts = await extractKeyFacts(messages, cheapModel);
  for (const fact of facts) {
    await memoryStore.store(fact.content, {
      agentId: session.agentId,
      tags: ["auto-flush", `session:${session.id}`],
    });
  }
}
```

**比 OpenClaw 更好**：
- OpenClaw 冲刷到 Markdown 文件需要重新索引；YanClaw 直接写入 SQLite + FTS5，即时可搜索
- OpenClaw 没有标签系统；YanClaw 可以给自动冲刷的记忆打标签，方便后续筛选

---

## 6. 会话管理（Session）

### OpenClaw 的高级能力

| 能力 | OpenClaw | YanClaw |
|------|----------|---------|
| DM 隔离范围 | `main/per-peer/per-channel-peer/per-account-channel-peer` | `dmScope` 已支持 |
| 线程绑定 | ✅ Discord `/focus`/`/unfocus`，空闲超时 | ❌ |
| 队列模式 | `collect/steer/followup` | ❌ |
| 自动重置 | `reset.mode/atHour/idleMinutes` | ❌（仅 pruneStale） |
| 写锁 | 文件锁 + PID + 看门狗 | ❌ |
| 会话钉模型 | profile pinned per session | ❌ |

### YanClaw 应补充的能力

#### 6.1 会话自动重置

```json5
{
  session: {
    autoReset: {
      idleMinutes: 480,    // 8 小时无活动则重置上下文
      atHour: 4,           // 每天凌晨 4 点重置
    }
  }
}
```

在现有 `SessionStore` 上添加 `resetSession(id)` 方法，清空消息历史但保留元数据。

#### 6.2 线程绑定

```typescript
// packages/server/src/channels/thread-binding.ts

interface ThreadBinding {
  threadId: string;
  agentId: string;
  sessionKey: string;
  createdAt: number;
  idleTimeoutHours: number;  // 默认 24
  maxAgeHours: number;       // 默认 168 (7天)
}
```

支持 Discord 线程自动绑定 agent，解决群聊中多话题混淆问题。

#### 6.3 会话序列化（防并发）

```typescript
// 确保同一会话的请求串行执行
const sessionLanes = new Map<string, Promise<void>>();

async function withSessionLane(sessionKey: string, fn: () => Promise<void>) {
  const prev = sessionLanes.get(sessionKey) ?? Promise.resolve();
  const next = prev.then(fn, fn);  // 无论前一个成功失败都继续
  sessionLanes.set(sessionKey, next);
  await next;
}
```

**价值**：防止同一会话中并发工具调用导致的竞态条件。OpenClaw 在这方面有成熟的 session lane 机制。

---

## 7. Token 追踪与成本控制

### OpenClaw 做了什么

- 每次请求记录 `input/output/cacheRead/cacheWrite` tokens
- 按模型定价表估算 USD 成本
- `/status` 和 `/usage` 命令展示用量
- 每日/每会话/每模型分维度聚合
- 延迟统计（avg、p95、min、max）

### YanClaw 当前状态

**完全没有 token 追踪**。这是一个显著短板。

### YanClaw 应如何实现

#### 7.1 使用量记录

```typescript
// packages/server/src/agents/usage-tracker.ts

interface UsageRecord {
  sessionId: string;
  agentId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  estimatedCostUsd: number;
  durationMs: number;
  timestamp: number;
}

// Drizzle schema
const usageTable = sqliteTable("usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  agentId: text("agent_id").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  cacheReadTokens: integer("cache_read_tokens").default(0),
  cacheWriteTokens: integer("cache_write_tokens").default(0),
  estimatedCostUsd: real("estimated_cost_usd").default(0),
  durationMs: integer("duration_ms").default(0),
  createdAt: integer("created_at").notNull(),
});
```

#### 7.2 成本估算

```typescript
// 模型定价表（USD per 1M tokens）
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead?: number }> = {
  "claude-sonnet-4-6":     { input: 3.0,  output: 15.0, cacheRead: 0.3 },
  "claude-haiku-4-5":      { input: 0.8,  output: 4.0,  cacheRead: 0.08 },
  "gpt-4o":                { input: 2.5,  output: 10.0, cacheRead: 1.25 },
  "gpt-4o-mini":           { input: 0.15, output: 0.6,  cacheRead: 0.075 },
  "deepseek-chat":         { input: 0.27, output: 1.10, cacheRead: 0.07 },
};
```

#### 7.3 API 路由

```typescript
// GET /api/usage/summary?days=7
// GET /api/usage/by-agent?agentId=xxx
// GET /api/usage/by-model?days=30
```

**比 OpenClaw 更好**：
- OpenClaw 存在 JSONL 文件中，查询需遍历；YanClaw 存 SQLite，SQL 聚合查询更快
- YanClaw 可以在 Web UI 的 Dashboard 页面直接展示用量图表
- 可以设置预算告警（OpenClaw 至今没有实现硬预算限制）

---

## 8. 工具审批流程（Tool Approval）

### OpenClaw 的审批体系

```
exec.security:  deny | allowlist | full
exec.ask:       off | on-miss | always
exec.askFallback: deny | allowlist | full（无 UI 时的降级策略）
```

- **审批广播**：发送到所有已连接的 operator 客户端
- **渠道转发**：审批请求可转发到 Slack/Telegram，操作员通过 `/approve <id>` 批准
- **超时处理**：无人审批 → 按 `askFallback` 策略处理
- **SafeBins**：`jq`、`grep` 等限制参数后直接放行

### YanClaw 当前状态

已有 `ApprovalManager`（`packages/server/src/approvals/manager.ts`），支持 WebSocket 实时推送审批请求到 Web UI。

### YanClaw 应补充的能力

#### 8.1 渠道内审批

允许 owner 通过聊天渠道直接审批：

```typescript
// packages/server/src/approvals/channel-approval.ts

// 当 agent 需要审批时，向 owner 所在渠道发送审批请求
async function requestApprovalViaChannel(
  approval: PendingApproval,
  channelManager: ChannelManager,
  ownerBinding: Binding
): Promise<ApprovalDecision> {
  const message = formatApprovalRequest(approval);
  await channelManager.send(ownerBinding.channelId, ownerBinding.userId, message);

  // 等待 owner 回复 /approve 或 /deny
  return waitForApprovalReply(approval.id, APPROVAL_TIMEOUT_MS);
}
```

#### 8.2 SafeBins 快速通道

```json5
{
  tools: {
    exec: {
      safeBins: ["jq", "grep", "curl", "head", "tail", "wc", "sort", "uniq"],
      // 这些命令限制 stdin-only + 禁止危险参数后，跳过审批
    }
  }
}
```

**比 OpenClaw 更好**：
- OpenClaw 的审批是纯文本命令（`/approve <id> allow-once`）；YanClaw 的 Web UI 审批更直观
- OpenClaw 没有审批历史审计；YanClaw 已有 audit logging，可以记录所有审批决策

---

## 9. 实现优先级建议

### P0 — 核心竞争力（立即实现）

| 功能 | 理由 | 工作量 |
|------|------|--------|
| **上下文压缩** | 长对话直接崩溃是致命问题 | 中（3-5天） |
| **Token 追踪** | 用户无法了解成本，无法优化 | 小（1-2天） |
| **工具循环检测** | OpenClaw 用户最高频投诉之一 | 小（1天） |

### P1 — 差异化优势（短期实现）

| 功能 | 理由 | 工作量 |
|------|------|--------|
| **心跳机制** | 主动式 agent 是 OpenClaw 的核心卖点 | 中（2-3天） |
| **系统提示构建器** | 提升 agent 质量的基础设施 | 中（2-3天） |
| **SafeBins** | 改善日常使用流畅度 | 小（1天） |
| **记忆 MMR + 时间衰减** | 提升记忆召回质量 | 小（1-2天） |

### P2 — 锦上添花（中期实现）

| 功能 | 理由 | 工作量 |
|------|------|--------|
| **会话自动重置** | 减少手动干预 | 小（1天） |
| **会话序列化** | 防并发竞态 | 小（1天） |
| **线程绑定** | Discord 群聊场景必需 | 中（2天） |
| **渠道内审批** | 移动端场景便利 | 中（2-3天） |
| **跨会话通信** | 多智能体协作 | 中（3天） |
| **Bootstrap 文件机制** | 高级用户定制 | 中（2天） |
| **工具配置档** | 简化配置 | 小（1天） |

### 不建议做的事情

| 功能 | 理由 |
|------|------|
| 20+ 渠道适配器 | 广度不是 YanClaw 的定位，OpenClaw 的长尾渠道质量参差不齐 |
| 设备节点控制 | 物理设备场景过于 niche，增加攻击面 |
| Canvas / A2UI | 酷但实用性存疑，投入产出比低 |
| SKILL.md 格式兼容 | Markdown-as-code 是 OpenClaw 的设计失误，安全性差 |
| Lobster 工作流引擎 | 过度工程化，YanClaw 的插件钩子已足够 |

---

## 总结

YanClaw 的核心优势在于**安全性、类型安全和工程质量**。OpenClaw 在**智能体自主性（心跳、压缩、上下文管理）** 和**用量可观测性（token 追踪）** 上更成熟。

路线图的核心思路：**学习 OpenClaw 的智能体能力深度，但用 YanClaw 的工程标准来实现**——Zod 校验、SQLite 存储、TypeScript 类型安全、安全第一。

最终目标：OpenClaw 的用户因为安全问题和工程质量来到 YanClaw 时，发现智能体能力也毫不逊色。
