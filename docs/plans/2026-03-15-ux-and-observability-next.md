---
title: "UX 与可观测性后续改进"
summary: "工具策略 UI、错误面板、路由调试器、能力编辑器、Block Streaming 的功能设计与实施方案"
read_when:
  - 实施工具策略可视化编辑
  - 构建错误监控面板
  - 改进路由调试体验
  - 实现频道分块流式输出
---

# UX 与可观测性后续改进

> 承接 `docs/product-analysis-agent-reliability.md` 第 7 节"后续改进方向"中的 5 项待做功能。
>
> **状态：✅ 全部完成（2026-03-15）** — Biome check 通过，250 测试全部通过。
> 开发日志：`docs/devlogs/2026-03-15-reliability-and-ux.md`

## 需求总览

| # | 功能 | 核心价值 | 工作量 | 状态 |
|---|------|---------|--------|------|
| 1 | Agent 工具策略 UI | 非技术用户可管理工具权限，不再编辑 JSON | 3 天 | ✅ |
| 2 | Dashboard 错误面板 | 聚合近期错误、按模块分组、实时推送 | 2.5 天 | ✅ |
| 3 | 路由优先级调试器 | 回答"这条消息会路由到哪个 Agent？" | 1.5 天 | ✅ |
| 4 | Agent 能力编辑器 | 可视化 Capability Preset，替代手写数组 | 1 天 | ✅（合并到 #1） |
| 5 | Block Streaming | 频道分块流式输出，降低长回复的感知延迟 | 2 天 | ✅ |

---

## 1. Agent 工具策略 UI

### 1.1 问题

当前 Agent 的 `tools.allow/deny` 和 `capabilities` 字段：
- API 不返回也不接受（`GET/PATCH /api/agents` 缺失这两个字段）
- 前端编辑器完全没有相关 UI
- 用户必须手动编辑 JSON 配置文件

### 1.2 现有后端能力

工具系统已实现完整的三层策略引擎：

```
评估顺序（优先级从高到低）：
1. Channel deny → 2. Channel allow → 3. Agent deny → 4. Global deny
→ 5. Agent allow → 6. Global allow → 7. Default policy
```

内置数据结构：

| 数据 | 说明 | 位置 |
|------|------|------|
| `TOOL_GROUPS` | 7 个工具分组（group:exec/file/web/browser/memory/desktop/session） | `tools/index.ts` |
| `CAPABILITY_PRESETS` | 4 个预设（safe-reader/researcher/developer/full-access） | `tools/index.ts` |
| `TOOL_CAPABILITIES` | 21 个工具→能力映射 | `tools/index.ts` |
| `OWNER_ONLY_TOOLS` | 8 个 ownerOnly 工具 | `tools/index.ts` |

### 1.3 设计方案

#### 后端改动

**1. 扩展 Agent CRUD API**

```typescript
// routes/agents.ts — GET 响应新增字段
{
  id, name, model, systemPrompt, runtime, taskEnabled,
  tools: { allow?: string[], deny?: string[] },       // 新增
  capabilities: string | string[],                      // 新增
}

// updateAgentSchema 新增
tools: z.object({
  allow: z.array(z.string()).optional(),
  deny: z.array(z.string()).optional(),
}).optional(),
capabilities: z.union([z.array(z.string()), z.string()]).optional(),
```

**2. 新增工具元数据端点**

```typescript
// GET /api/tools/metadata — 前端 one-shot 拉取
{
  groups: { "group:exec": ["shell", "code_exec"], ... },
  presets: { "safe-reader": ["fs:read", "memory:read"], ... },
  capabilities: { "shell": ["exec:shell"], "file_read": ["fs:read"], ... },
  ownerOnly: ["shell", "file_write", "file_edit", "browser_navigate", ...],
  allTools: ["shell", "file_read", "file_write", "file_edit", "web_search", ...],
}
```

#### 前端设计

在 Agent 编辑对话框中新增 **"工具权限"** 标签页：

```
┌─ 编辑 AI 助手 ──────────────────────────────────────┐
│  [基本信息]  [工具权限]                               │
│                                                       │
│  ── 快速预设 ──────────────────────────────────────   │
│  ○ 不限制           所有工具可用                      │
│  ○ 安全只读         只能读文件和搜索记忆               │
│  ○ 研究员           Web 搜索 + 记忆读写               │
│  ● 开发者           文件读写 + Shell + 沙盒 + Web     │
│  ○ 自定义           使用下方列表精确控制               │
│                                                       │
│  ── 允许的工具 ──────────────────────────────────── │
│  (留空 = 不限制，填写后仅允许这些工具)               │
│                                                       │
│  [🔍 搜索工具...]                                    │
│  ☑ group:file   file_read, file_write, file_edit     │
│  ☑ web_search                                        │
│  ☑ web_fetch                                         │
│  ☑ memory_store                                      │
│  ☐ group:exec   shell, code_exec          🔐 仅 owner│
│                                                       │
│  ── 禁止的工具 ──────────────────────────────────── │
│  (这些工具始终不可用，优先级高于允许列表)            │
│  ☑ browser_navigate                       🔐 仅 owner│
│  ☑ screenshot_desktop                     🔐 仅 owner│
│                                                       │
│  ⚠️ shell 已被禁止，但 group:exec 在允许列表中       │
│                                                       │
│  [取消]                               [保存]         │
└───────────────────────────────────────────────────────┘
```

关键 UI 要素：
- **预设单选**：选择后自动填充 allow/deny 列表（预设 ↔ 自定义联动）
- **工具搜索**：输入关键词过滤工具名
- **分组展开**：group:file 可展开看包含的具体工具
- **ownerOnly 标记**：🔐 图标 + tooltip "仅频道 owner 可使用"
- **冲突检测**：allow 和 deny 有矛盾时显示警告

### 1.4 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `routes/agents.ts` 扩展 GET/PATCH 包含 tools + capabilities | 0.5h |
| 2 | 新增 `routes/tools-metadata.ts`（`GET /api/tools/metadata`） | 1h |
| 3 | 新建 `web/src/components/ToolPolicyEditor.tsx` | 4h |
| 4 | 集成到 `Agents.tsx` 编辑对话框，增加标签页 | 2h |
| 5 | 冲突检测逻辑（allow vs deny 矛盾告警） | 1h |
| 6 | 测试 + 联调 | 1.5h |

---

## 2. Dashboard 错误面板

### 2.1 问题

v0.11.0 引入了 Pino 结构化日志 + 文件持久化，但：
- 日志存在磁盘文件中，无法从 UI 查看
- 没有错误聚合——同类错误重复出现无法归并
- 没有实时推送——用户不知道后台正在出错
- 已有的 `AuditLogger` 记录操作行为，不记录系统错误

### 2.2 方案：混合架构（Ring Buffer + DB）

```
ErrorCollector
├── Ring Buffer（内存，100 条）→ 实时面板 + WebSocket 推送
├── error_logs 表（SQLite）→ 历史查询 + 趋势分析
└── 批量写入（复用 AuditLogger 的 buffer flush 模式）
```

选择混合方案的原因：
- Ring Buffer 零延迟，适合实时面板
- DB 持久化，适合 post-mortem 分析
- 批量写入避免高频错误冲击 SQLite

### 2.3 数据模型

```sql
CREATE TABLE error_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  module TEXT NOT NULL,         -- 'agent'|'channel'|'security'|'plugin'|'mcp'|'cron'|'config'
  severity TEXT NOT NULL,       -- 'error'|'warn'
  code TEXT,                    -- 'CHANNEL_DISCONNECTED'|'TOOL_TIMEOUT'|'MODEL_FAILOVER'|...
  message TEXT NOT NULL,
  context TEXT,                 -- JSON: {sessionKey, agentId, channelId, toolName, correlationId}
  stackTrace TEXT,
  createdAt INTEGER NOT NULL
);

CREATE INDEX idx_error_module ON error_logs(module);
CREATE INDEX idx_error_severity ON error_logs(severity);
CREATE INDEX idx_error_created ON error_logs(createdAt);
```

### 2.4 错误分类体系

| 模块 | 错误码 | 说明 |
|------|--------|------|
| agent | `TOOL_TIMEOUT` | 工具执行超时 |
| agent | `TOOL_FAILED` | 工具执行失败（重试耗尽后） |
| agent | `MODEL_FAILOVER` | 模型 Profile 切换 |
| agent | `LOOP_DETECTED` | 循环检测器触发 |
| agent | `COMPACTION_FAILED` | 上下文压缩失败 |
| channel | `CHANNEL_DISCONNECTED` | 频道断开连接 |
| channel | `SEND_FAILED` | 消息投递失败（重试耗尽后） |
| channel | `RATE_LIMITED` | 触发频率限制 |
| security | `AUTH_FAILED` | 认证失败 |
| security | `LEAK_BLOCKED` | 凭证泄漏被拦截 |
| security | `INJECTION_DETECTED` | 提示注入检测触发 |
| security | `ANOMALY_ALERT` | 异常检测告警 |
| plugin | `HOOK_FAILED` | 插件钩子执行失败 |
| mcp | `SERVER_DISCONNECTED` | MCP 服务器断开 |
| config | `HOT_RELOAD_FAILED` | 配置热重载失败 |

### 2.5 API 设计

```typescript
// GET /api/system/errors?module=agent&severity=error&since=2026-03-15&limit=50
// 响应
{
  errors: [
    {
      id: 1,
      timestamp: "2026-03-15T10:30:00Z",
      module: "channel",
      severity: "error",
      code: "SEND_FAILED",
      message: "Telegram send failed after 3 retries",
      context: { channelId: "telegram:bot_prod", peer: "12345", correlationId: "abc123" },
      createdAt: 1710495000,
    },
    // ...
  ],
  total: 42,
  stats: {
    last24h: { error: 12, warn: 30 },
    byModule: { agent: 5, channel: 25, security: 8, plugin: 4 },
  }
}
```

### 2.6 前端设计

新增 Dashboard 页面（或 Settings 子页）：

```
┌─ 系统监控 ─────────────────────────────────────────┐
│                                                      │
│  ── 概览（最近 24h）──────────────────────────────  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │  12      │  │  30      │  │  42      │          │
│  │  错误    │  │  警告    │  │  总计    │          │
│  └──────────┘  └──────────┘  └──────────┘          │
│                                                      │
│  ── 按模块分布 ────────────────────────────────── │
│  agent    ████████░░  5                              │
│  channel  ████████████████████████░░  25              │
│  security ████████████████░░  8                       │
│  plugin   ████████░░  4                              │
│                                                      │
│  ── 最近错误 ──────────────────────────────────── │
│  [全部] [错误] [警告]   🔍 搜索   [模块 ▼]         │
│                                                      │
│  🔴 10:30  channel  SEND_FAILED                     │
│     Telegram send failed after 3 retries             │
│     context: telegram:bot_prod → peer:12345          │
│                                                      │
│  🟡 10:28  agent   MODEL_FAILOVER                   │
│     Profile anthropic:default entered cooldown       │
│     context: session:agent:main:telegram:12345       │
│                                                      │
│  🔴 10:25  security AUTH_FAILED                     │
│     Invalid bearer token from 192.168.1.100          │
│                                                      │
│  [加载更多...]                                       │
└──────────────────────────────────────────────────────┘
```

### 2.7 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `db/schema.ts` 新增 error_logs 表 | 0.5h |
| 2 | `ErrorCollector` 类（ring buffer + DB + flush） | 3h |
| 3 | GatewayContext 注入 + 各模块接入 `errorCollector.collect()` | 2h |
| 4 | `routes/system.ts` 新增 `GET /api/system/errors` | 1h |
| 5 | WebSocket 新增 error 实时推送 | 1h |
| 6 | `web/src/pages/Dashboard.tsx`（或 Settings 子页） | 4h |
| 7 | 侧边栏添加入口（可复用现有 Settings 图标） | 0.5h |
| 8 | 测试 + 联调 | 1h |

---

## 3. 路由优先级调试器

### 3.1 问题

当前 `GET /api/routing/test` 只返回最终匹配结果，不显示：
- 所有候选绑定的排名和得分
- 为什么某个绑定胜出（得分分解）
- 落选绑定的原因

### 3.2 路由评分机制

当前 `bindingScore()` 的评分规则：

```
channel 匹配  → +2
account 匹配  → +2
peer 匹配     → +4（最高权重）
guild 匹配    → +1
group 匹配    → +1
roles 匹配    → +1
不匹配        → -1（立即淘汰）

手动 priority → 覆盖计算得分
```

### 3.3 增强的测试端点

```typescript
// GET /api/routing/test?channel=telegram&peer=12345&debug=true

// 新增 debug 响应
{
  result: { agentId, sessionKey, dmScope, binding },
  debug: {
    candidates: [
      {
        rank: 1,
        score: 8,
        binding: { channel: "telegram", account: "bot_prod", peer: "12345", agent: "researcher" },
        breakdown: { channel: 2, account: 2, peer: 4, guild: 0, group: 0, roles: 0 },
        isWinner: true,
      },
      {
        rank: 2,
        score: 4,
        binding: { channel: "telegram", account: "bot_prod", agent: "main" },
        breakdown: { channel: 2, account: 2, peer: 0, guild: 0, group: 0, roles: 0 },
        isWinner: false,
      },
    ],
    defaultAgent: "main",
    totalBindings: 5,
    matchedBindings: 2,
    rejectedBindings: 3,
  }
}
```

### 3.4 前端设计

在 Channels 页面路由绑定区域增加"测试路由"按钮：

```
┌─ 路由测试 ─────────────────────────────────────────┐
│                                                      │
│  频道: [Telegram ▼]  用户ID: [12345     ]           │
│  Guild: [          ]  Group:  [          ]           │
│                                      [🔍 测试]       │
│                                                      │
│  匹配结果：                                          │
│  ┌────────────────────────────────────────────────┐ │
│  │ ⭐ #1  researcher  得分=8                      │ │
│  │   telegram + bot_prod + 12345                  │ │
│  │   channel(+2) account(+2) peer(+4)            │ │
│  │                                                 │ │
│  │    #2  main        得分=4                      │ │
│  │   telegram + bot_prod                          │ │
│  │   channel(+2) account(+2)                     │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│  → 会话 key: agent:researcher:telegram:12345         │
│  → DM 作用域: per-peer                              │
└──────────────────────────────────────────────────────┘
```

### 3.5 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `routing/resolve.ts` 新增 `resolveRouteDebug()` 返回候选列表 + 得分分解 | 2h |
| 2 | `routes/routing.ts` test 端点增加 `debug` 参数 | 0.5h |
| 3 | `web/src/pages/Channels.tsx` 添加路由测试 UI（对话框或折叠面板） | 3h |
| 4 | 测试 + 联调 | 1h |

---

## 4. Agent 能力编辑器

### 4.1 问题

`capabilities` 字段支持预设名（string）或自定义数组（string[]），但前端不展示也不可编辑。

### 4.2 设计

与工具策略 UI（第 1 项）合并实现——预设单选就是能力编辑器的核心。额外增加"自定义能力"选项，展示所有可用能力并可勾选：

```
── 能力预设 ──────────────────────────────────────
○ 不限制 (full-access)      所有能力
○ 安全只读 (safe-reader)    fs:read, memory:read
○ 研究员 (researcher)       fs:read, net:http, memory:read, memory:write
● 开发者 (developer)        fs:read/write, exec:shell/sandbox, net:http, memory:read/write
○ 自定义                    手动选择 ↓

── 当前能力（开发者预设）──────────────────────────
  ☑ fs:read        读取文件
  ☑ fs:write       写入文件
  ☑ exec:shell     执行 Shell 命令
  ☑ exec:sandbox   代码沙盒执行
  ☑ net:http       网络请求（搜索/抓取）
  ☑ memory:read    搜索记忆
  ☑ memory:write   存储记忆
  ☐ browser:*      浏览器操作（导航/截图/交互）
  ☐ session:*      会话通信
  ☐ desktop:*      桌面截图
```

### 4.3 实施步骤

此功能作为工具策略 UI 的一部分实现（第 1 项的"快速预设"区域），不需要单独的工作量估算。独立新增部分仅为：

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | 能力列表数据从 `/api/tools/metadata` 获取（已在第 1 项实现） | 0 |
| 2 | "自定义"模式下的能力勾选 UI | 2h |
| 3 | 预设 ↔ 自定义联动逻辑 | 1h |

---

## 5. Block Streaming（频道分块流式输出）

### 5.1 问题

当前频道消息投递流程：

```
Agent 流式生成 → 全部缓存到 buffer → 生成结束 → 一次性 chunkText + send
```

用户在 Telegram/Discord 上需要等待**完整响应生成后**才能看到第一条消息。长回复（2000+ token）的延迟体感明显。

### 5.2 目标

```
Agent 流式生成 → 每 N 字符发送一个 block → 用户逐步看到回复
```

### 5.3 平台支持分析

| 频道 | maxTextLength | 支持 edit | Block Streaming 收益 |
|------|---------------|-----------|---------------------|
| Discord | 2000 | ✅ `message.edit()` | ⭐⭐⭐ 最受限，长回复必须分多条 |
| Telegram | 4000 | ✅ `editMessageText()` | ⭐⭐⭐ 高频使用 |
| Slack | 4000 | ✅ `chat.update()` | ⭐⭐ 线程缓解分块痛点 |
| WebChat | 无限 | N/A | ☆ 已有 SSE delta 流式 |

### 5.4 两种模式

**模式 A：新消息流**（简单，推荐先做）

每 N 字符发送一条**新消息**，不编辑旧消息：

```
Agent 生成 500 字 → 发送消息 1
Agent 继续生成 500 字 → 发送消息 2
Agent 完成 → 发送消息 3（最终段落）
```

- 优点：无需 edit API，所有平台通用
- 缺点：多条消息，稍显碎片化
- 适用于：Discord（2000 限制下必须分条）

**模式 B：编辑替换**（高级，体验更好）

发送一条消息后持续编辑更新内容：

```
发送消息 "正在思考..." → 编辑为前 500 字 → 编辑为前 1000 字 → 最终内容
```

- 优点：单条消息，流畅体验
- 缺点：需要 edit API、高频编辑可能触发 Rate Limit
- 适用于：Telegram（editMessageText 可靠）

### 5.5 实现方案

#### ChannelAdapter 接口扩展

```typescript
// channels/types.ts
export interface ChannelAdapter {
  // ... 现有方法
  /** 编辑已发送的消息。返回是否成功。 */
  editMessage?(messageId: string, peer: Peer, content: OutboundMessage): Promise<boolean>;
}

// channels/dock.ts — ChannelCapabilities 新增
export interface ChannelCapabilities {
  // ... 现有字段
  /** 是否启用 block streaming（逐块发送到频道） */
  blockStreaming: boolean;
  /** block 最小字符数（不到此阈值不发送） */
  blockMinChars: number;
}
```

#### Channel Manager 流式发送

```typescript
// channels/manager.ts — handleInbound 改造
if (caps.blockStreaming) {
  // 流式模式：边收边发
  let blockBuffer = "";
  const blockThreshold = caps.blockMinChars ?? 300;

  for await (const event of events) {
    if (event.type === "delta" && event.text) {
      blockBuffer += event.text;

      if (blockBuffer.length >= blockThreshold) {
        await sendWithRetry(adapter, msg.peer, {
          text: blockBuffer,
          format: caps.supportsMarkdown ? "markdown" : "plain",
        }, retryConfig);
        blockBuffer = "";
      }
    }
    // ... 其他 event 处理
  }
  // 发送剩余内容
  if (blockBuffer.trim()) {
    await sendWithRetry(adapter, msg.peer, { text: blockBuffer, ... }, retryConfig);
  }
} else {
  // 传统模式：全缓存后发送（当前行为）
}
```

#### 配置

```typescript
// config/schema.ts — channelEntrySchema 或全局
blockStreaming: z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["new-messages", "edit"]).default("new-messages"),
  minChars: z.number().default(300),
}).default({}),
```

### 5.6 实施步骤

| 步骤 | 内容 | 工作量 |
|------|------|--------|
| 1 | `ChannelCapabilities` + `ChannelAdapter` 接口扩展 | 0.5h |
| 2 | `CHANNEL_DOCK` 各频道 blockStreaming 默认值 | 0.5h |
| 3 | `manager.ts` 流式发送逻辑（模式 A：新消息流） | 3h |
| 4 | Telegram adapter `editMessage` 实现 | 1h |
| 5 | Discord adapter `editMessage` 实现 | 1h |
| 6 | 模式 B（edit）集成到 manager.ts | 2h |
| 7 | 配置 schema + 前端开关（Settings 或 Channels 页面） | 1h |
| 8 | 测试（Telegram/Discord 实际效果验证） | 2h |

---

## 依赖关系与实施顺序

```
第 1 项（工具策略 UI）  ←── 第 4 项（能力编辑器）合并实现
         ↓
第 2 项（错误面板）     ←── 无依赖，可并行
         ↓
第 3 项（路由调试器）   ←── 依赖 v0.11.0 的路由 API（已就绪）
         ↓
第 5 项（Block Streaming）←── 无依赖，独立开发
```

推荐并行分组：

```
第一批（前端重点）：第 1+4 项（工具策略 + 能力）+ 第 3 项（路由调试器）
第二批（后端重点）：第 2 项（错误面板）
第三批（频道重点）：第 5 项（Block Streaming）
```

## 总工作量估算

| 功能 | 后端 | 前端 | 合计 |
|------|------|------|------|
| 1. 工具策略 UI | 1.5h | 7h | ~1.5 天 |
| 2. 错误面板 | 7h | 5h | ~2.5 天 |
| 3. 路由调试器 | 2.5h | 3h | ~1 天 |
| 4. 能力编辑器 | 0h（复用 #1） | 3h | ~0.5 天 |
| 5. Block Streaming | 7h | 1h | ~1.5 天 |
| **合计** | **18h** | **19h** | **~7 天** |

## 不做的事情

| 功能 | 理由 |
|------|------|
| Sentry 集成 | 错误面板已满足当前规模，外部服务增加运维复杂度 |
| OpenTelemetry | 单进程架构不需要分布式追踪 |
| 全局工具策略 UI | 低频操作，JSON 配置可接受，等反馈再做 |
| Channel 级工具策略 UI | 同上，按需 JSON 编辑 |
| Block Streaming 编辑模式的 Rate Limit 保护 | 可后续迭代，先发新消息模式 |
