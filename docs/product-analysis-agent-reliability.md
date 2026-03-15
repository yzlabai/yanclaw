# 产品分析：Agent 可靠性与用户体验

本文档综合分析三个相关问题：工具调用重试机制缺失、后端错误日志不可观测、Agent Hub 产品设计混乱。三者本质上是同一根问题的三个表征——**Agent 系统缺乏生产级可靠性基础设施**。

> **实施状态：✅ 全部完成（2026-03-15）**
> 实施方案：`docs/plans/2026-03-15-agent-reliability-and-ux.md`

---

## 目录

1. [问题全景](#1-问题全景)
2. [问题一：工具调用无重试机制](#2-问题一工具调用无重试机制)
3. [问题二：后端错误日志缺失](#3-问题二后端错误日志缺失)
4. [问题三：Agent Hub 产品设计混乱](#4-问题三agent-hub-产品设计混乱)
5. [三个问题的关联性](#5-三个问题的关联性)
6. [已完成的改进](#6-已完成的改进)
7. [后续改进方向](#7-后续改进方向)

---

## 1. 问题全景

```
问题提出时（v0.10.x）                    解决后（v0.11.0）
────────────────────                    ──────────────────
"Agent 怎么突然不回复了？"    ──→     瞬态错误自动重试 + 频道投递重试
"后台服务出错了看不到日志"    ──→     Pino 结构化日志 + 文件轮转 + correlationId
"Agent Hub 是干嘛的？搞不懂"  ──→     重命名 + 路由绑定 UI + Onboarding 自动绑定
```

这三个问题的共同根因：YanClaw 完成了功能实现（P0-P4 + Phase 6），但缺少**可靠性层**——让功能在生产环境中稳定运行、出错可诊断、对用户友好的基础设施。v0.11.0 版本补齐了这一层。

---

## 2. 问题一：工具调用无重试机制

### 2.1 问题描述

v0.10.x 之前，YanClaw **没有任何工具级重试逻辑**。错误处理策略是"失败即返回"：

| 工具 | 失败处理方式 | 文件位置 |
|------|-------------|---------|
| shell | 返回 `{ exitCode: 1, output: errorMessage }` | `agents/tools/shell.ts` |
| code_exec | 返回 `[TIMEOUT after Xms]` + output | `agents/tools/code-exec.ts` |
| browser_* | 返回 `"Navigation error: ..."` 字符串 | `agents/tools/browser.ts` |
| web_fetch | 返回 `"HTTP 429 Too Many Requests"` 字符串 | `agents/tools/web/fetch.ts` |
| web_search | **唯一有降级逻辑**：Tavily → Brave → DuckDuckGo | `agents/tools/web/search.ts` |
| memory_* | 返回错误字符串 | `agents/tools/memory.ts` |

### 2.2 与 OpenClaw 对比

OpenClaw 实现了**显式的、每请求级别的重试策略**：

```
OpenClaw 重试机制
├── 默认 3 次重试
├── 指数退避 + 10% 抖动
├── 最大延迟 30 秒
├── 瞬态错误分类（429、超时、连接重置）
├── 永久错误不重试（401、配置错误）
├── 尊重 Retry-After 头
└── 按频道自定义延迟（Telegram 400ms、Discord 500ms）
```

### 2.3 高频失败场景

1. **Rate Limit（最常见）**：Telegram/Discord/Slack API 频率限制，连续发送消息触发 429
2. **网络抖动**：短暂 DNS 解析失败、连接超时、TCP Reset 等瞬态错误
3. **web_fetch 超时**：目标网站响应慢（>30s），仅暂时拥堵
4. **浏览器工具超时**：Playwright 操作 30s 超时，页面加载慢时经常发生

### 2.4 设计哲学反思

旧设计："让 LLM 决定如何处理失败"。实践中的问题：
- LLM 不理解"429 Rate Limit 等 2 秒再试就行了"
- LLM 重试 → 触发循环检测器 → 被阻断
- 每次"LLM 重试"消耗一个 step（maxSteps=25），浪费 token

**结论**：瞬态错误应在工具层自动重试，只有持续失败才上报给 LLM。

### 2.5 ✅ 已实现的解决方案

**新增 `agents/tools/retry.ts` 模块**，参考 OpenClaw 的重试策略：

| 方面 | 之前 | 现在 |
|------|------|------|
| 工具调用重试 | ❌ 无 | ✅ 3 次 + 指数退避 + 10% 抖动 |
| 瞬态错误分类 | ❌ 全部当 fatal | ✅ 区分 429/502/503/504/ECONNRESET/ETIMEDOUT |
| 永久错误识别 | ❌ | ✅ 401/403/404/400 不重试 |
| Rate Limit | ❌ 直接失败 | ✅ 解析 `Retry-After` 头 |
| 配置化 | ❌ 无配置 | ✅ `tools.retry`（attempts/backoff/baseDelayMs/maxDelayMs/jitter） |
| 幂等性区分 | ❌ 无 | ✅ 只自动重试幂等工具（web_fetch/search/browser_*/memory_search） |
| 频道投递重试 | ❌ | ✅ 按平台基础延迟（Telegram 400ms / Discord 500ms / Slack 300ms） |

**设计决策**：有副作用的工具（shell、file_write、memory_store）不自动重试，仍由 LLM 决策——这是安全正确的选择。

---

## 3. 问题二：后端错误日志缺失

### 3.1 问题描述

v0.10.x 的日志现状：

| 维度 | 当时状态 |
|------|---------|
| 日志方式 | `console.log/warn/error` 直出 stdout |
| 日志总量 | 191 条 console 语句（37 个文件） |
| 结构化 | ❌ 纯文本，手工前缀（`[agent]`, `[channel]`） |
| 持久化 | ❌ 进程退出即丢失 |
| 日志级别 | ❌ 无 INFO/WARN/ERROR/DEBUG 分级 |
| 关联 ID | ❌ 无请求/会话追踪 ID |
| 日志文件 | ❌ 无文件输出、无轮转 |

### 3.2 关键盲区

**静默失败案例（已修复）：**

```typescript
// 之前：WebSocket 客户端断连 — 无日志
catch { clients.delete(ws) }

// 之前：Auth 失败 — 无审计记录
if (!token) return c.json({ error: "Unauthorized" }, 401)

// 之前：MCP 工具刷新失败 — 工具可能过时
refreshTools().catch(err => console.warn("[mcp]", err.message))
```

**安全盲区（已修复）：**
- 认证失败不记录 → 现在记录到 `log.security()`
- 泄漏检测阻断不记审计 → 现在同时写 `log.security()` + auditLog
- 数据流告警只到 console → 现在持久化到日志文件

### 3.3 ✅ 已实现的解决方案

**引入 Pino 结构化日志系统** (`packages/server/src/logger.ts`)：

| 维度 | 之前 | 现在 |
|------|------|------|
| 日志方式 | `console.*` 直出 | Pino JSON 日志 |
| 持久化 | ❌ 进程退出即丢 | ✅ `~/.yanclaw/logs/` 文件轮转 |
| 结构化 | ❌ 纯文本 | ✅ JSON + 模块标签 + 上下文对象 |
| 日志级别 | ❌ | ✅ fatal/error/warn/info/debug/trace |
| 关联 ID | ❌ | ✅ Agent 运行级 correlationId |
| 模块分类 | 手工 `[xxx]` 前缀 | ✅ 10 个模块 logger（gateway/agent/channel/routing/security/plugin/mcp/cron/config/db） |
| 开发体验 | 不可搜索 | ✅ pretty-print 模式 + JSON 文件可搜索 |
| 配置 | 无 | ✅ `gateway.logging`（level, file, pretty） |

**迁移规模**：171 条 `console.*` 调用 → 结构化 `log.module().level({context}, "message")` 格式，跨 35 个文件。仅保留 `cli.ts`（用户面向 CLI 输出）和 `vault-migrate.ts`（迁移脚本）使用 console。

---

## 4. 问题三：Agent Hub 产品设计混乱

### 4.1 概念模型问题

用户需要理解的概念过多（10 个），且关系不直观：

```
Agent（模板）、Agent Hub（实例）、Channel（频道）、Routing（路由）、
Session（会话）、Model（模型）、Runtime（运行时）、Preference（偏好）、
Tool Policy（工具策略）、Capability（能力）
```

一个正常用户的心智模型：`我有一个 AI 助手 → 它连接了我的 Telegram → 我发消息它就回复`

### 4.2 用户旅程断裂（已修复）

```
之前（v0.10.x）：
步骤 3 → 4 断裂：Channel 连上了但发消息没反应（无 Routing）
步骤 6 → 7 断裂：Agents vs Agent Hub 概念混乱

现在（v0.11.0）：
步骤 3：添加 Telegram → ✅ Onboarding 自动绑定 main Agent
步骤 4：Telegram 发消息 → ✅ main Agent 直接回复
步骤 5：想自定义路由 → ✅ Channels 页面内嵌路由规则编辑器
```

### 4.3 UI 覆盖改善

| 功能 | 之前 | 现在 |
|------|------|------|
| **路由绑定** | 🔴 无 UI，只能编辑 JSON | ✅ Channels 页面内嵌 + `/api/routing` CRUD API |
| **Agent Hub 入口** | 🔴 需 `agentHub.enabled` 配置 | ✅ 侧边栏始终显示"任务" |
| **Agent 任务开关** | 🔴 需编辑配置文件 | ✅ Agent 卡片 `taskEnabled` 开关 |
| 工具策略 | 🟡 只能改配置文件 | 🟡 后续补 UI |
| 能力预设 | 🟡 只能改配置文件 | 🟡 后续补 UI |

### 4.4 ✅ 已实现的命名改进

| 之前 | 现在 | 理由 |
|------|------|------|
| Agents（页面名） | **AI 助手** | 用户语言 |
| Agent Hub（页面名） | **任务** | 直接表达功能 |
| 无 taskEnabled 字段 | Agent 卡片"可执行任务"标记 | 可视化功能开关 |

---

## 5. 三个问题的关联性

```
之前（恶性循环）：                      现在（已打破）：

工具失败(无重试)                        工具失败 → 自动重试 → 成功
    ↓                                          ↓ (仍失败)
用户看到 Agent 不回复                   结构化日志记录 → 可追溯
    ↓                                          ↓
想查日志 → 看不到                       Channels 页面有路由规则
    ↓                                          ↓
觉得配置有问题 → Agent Hub 搞不懂       Onboarding 自动绑定 → 开箱即用
    ↓
用户流失
```

---

## 6. 已完成的改进

### 6.1 结构化日志（Phase 1）

- **新文件**：`packages/server/src/logger.ts` — Pino + pino-pretty + pino-roll
- **配置**：`gateway.logging`（level, file.enabled/maxSize/maxFiles, pretty）
- **迁移**：171 条 console.* → 结构化日志（35 个文件）
- **关联 ID**：每次 Agent 运行生成 `correlationId`（`randomBytes(6).toString("hex")`）

### 6.2 工具调用重试（Phase 2）

- **新文件**：`packages/server/src/agents/tools/retry.ts`
- **配置**：`tools.retry`（enabled, attempts, backoff, baseDelayMs, maxDelayMs, jitter）
- **幂等工具自动重试**：web_fetch, web_search, memory_search, memory_list, browser_navigate, browser_screenshot
- **频道投递重试**：sendWithRetry() 包装，per-platform 基础延迟

### 6.3 路由绑定 UI（Phase 3）

- **新文件**：`packages/server/src/routes/routing.ts` — CRUD API + 路由测试端点
- **前端**：Channels 页面每个频道卡片内嵌路由规则列表（默认 Agent + 自定义绑定 + 添加/删除）
- **Onboarding**：Step 2 添加频道时自动 POST `/api/routing/bindings` 绑定 main Agent
- **完成页面**：显示"你的 AI 助手 (main) 已绑定到以下平台"

### 6.4 Agent Hub UX 重设计（Phase 4）

- **重命名**：Agents → "AI 助手"，Agent Hub → "任务"
- **新字段**：`agentSchema.taskEnabled: boolean`（config + CRUD API + 前端开关）
- **Agent 卡片**：显示"可执行任务"标记
- **编辑器**：新增"允许自主任务"Switch 开关

---

## 7. 后续改进方向

> 以下 5 项已在 v0.12.0 全部完成。实施方案见 `docs/plans/2026-03-15-ux-and-observability-next.md`。

| 任务 | 状态 | 说明 |
|------|------|------|
| **Agent 编辑器增加工具策略 UI** | ✅ v0.12.0 | 预设单选 + 分组 allow/deny + ownerOnly 标记 + `/api/tools/metadata` |
| **Dashboard 错误面板** | ✅ v0.12.0 | ErrorCollector + `/api/system/errors` + 监控页面（统计+列表+自动刷新） |
| **路由优先级可视化调试器** | ✅ v0.12.0 | `resolveRouteDebug()` + `?debug=true` + 测试路由对话框 |
| **Agent 能力编辑器** | ✅ v0.12.0 | 合并到工具策略 UI 的预设选择器 |
| **Block Streaming** | ✅ v0.12.0 | Channel Manager 双模式发送 + Telegram/Discord editMessage |

### 仍可后续改进

| 任务 | 理由 |
|------|------|
| Sentry 集成 | 错误面板已满足当前规模，外部服务增加运维复杂度 |
| OpenTelemetry | 单进程架构不需要分布式追踪 |
| 全局/Channel 级工具策略 UI | 低频操作，JSON 配置可接受 |
| Block Streaming 编辑模式 Rate Limit 保护 | 可后续迭代 |

---

*本文档分析基于 YanClaw 源码（`packages/server/src/`、`packages/web/src/`）和 OpenClaw 参考文档（`tmp/refer/openclaw-docs/`）。v0.11.0 方案：`docs/plans/2026-03-15-agent-reliability-and-ux.md`，v0.12.0 方案：`docs/plans/2026-03-15-ux-and-observability-next.md`。*
