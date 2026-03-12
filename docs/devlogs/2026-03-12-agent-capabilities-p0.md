# 2026-03-12 Agent 能力增强 P0 — Token 追踪 / 循环检测 / 上下文压缩

## 概述

实现 Agent 能力增强计划的 P0 三项核心功能，补齐 YanClaw 在运行可观测性和长对话稳定性上的短板。

对照文档：`docs/plans/2026-03-12-agent-capabilities-enhancement.md`

## 1. Token 追踪与成本控制

### 动机

用户完全无法了解 API 调用成本。之前只有 session 级的 `tokenCount`（仅 completion tokens），无成本估算、无按模型/agent 维度的聚合。

### 实现

- **DB**: 新增 `usage` 表（migration v5），记录每次 API 调用的 input/output/cache tokens、预估成本（USD）、延迟
- **UsageTracker 类**: 内置 Anthropic/OpenAI/Google/DeepSeek 定价表，支持精确匹配和前缀匹配。提供 5 种聚合查询：summary、byAgent、byModel、daily（图表用）、recent
- **注入点**: `streamText` 完成后（`onFinish`），从 AI SDK 的 `usage` 对象提取 tokens，计算成本后写入 DB
- **API**: 5 个端点挂在 `/api/usage/`，支持 `days` 查询参数
- **生命周期**: 启动时随 audit log 一起按 `pruneAfterDays` 清理过期记录

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/db/schema.ts` | 修改 | 新增 `usage` Drizzle schema |
| `packages/server/src/db/sqlite.ts` | 修改 | Migration v5: `usage_tracking` |
| `packages/server/src/agents/usage-tracker.ts` | 新建 | UsageTracker 类 + 定价表 |
| `packages/server/src/routes/usage.ts` | 新建 | 5 个 API 端点 |
| `packages/server/src/agents/runtime.ts` | 修改 | streamText 后记录 usage |
| `packages/server/src/gateway.ts` | 修改 | 注入 UsageTracker + 启动时清理 |
| `packages/server/src/app.ts` | 修改 | 挂载 `/api/usage` |

---

## 2. 工具循环检测

### 动机

Agent 可能陷入无意义的重复工具调用循环（相同参数反复调用、A→B→A→B 乒乓、输出不变的轮询），浪费 token。这是 OpenClaw 社区最高频投诉之一。

### 实现

- **LoopDetector 类**: 追踪每个 session 最近 30 次调用的 djb2 哈希
- **三级响应**: warn（10 次）→ block（20 次）→ circuit_break（累计 30 次 block）
- **三种检测模式**:
  1. 泛型重复 — 同一 tool + args 组合出现 N 次
  2. 乒乓检测 — A→B→A→B 交替模式
  3. 输出停滞 — 同一工具连续 3+ 次输出哈希相同
- **注入点**: `tool-call` 事件前检查（pre-execution），`tool-result` 后记录输出哈希
- **内存管理**: 每次 check 时驱逐超过 1 小时不活跃的 session 数据

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/tools/loop-detector.ts` | 新建 | LoopDetector 类 |
| `packages/server/src/agents/runtime.ts` | 修改 | tool-call 前注入检测 + tool-result 后记录 |

---

## 3. 上下文压缩（LLM Compaction）

### 动机

之前只有 `SessionStore.compact()` 做简单的按 token 裁剪旧消息（硬删除），没有信息保留。长对话中重要的早期上下文会被丢弃。

### 实现

采用两层压缩策略：

1. **硬裁剪**（已有）: `SessionStore.compact()` 在 DB 层面按 `contextBudget` 删除最老消息，作为安全兜底
2. **LLM 摘要**（新增）: 在构建完 messages 数组后、`streamText` 前，检测 token 用量是否超过 `triggerRatio`（默认 85%），如果超过则：
   - **记忆冲刷**: 先用 LLM 提取关键事实，写入 MemoryStore（带 `auto-flush` 标签，FTS5 即时可搜索）
   - **分块摘要**: 保留 system prompt + 最近 N 条消息 + 当前用户消息，中间旧消息用 LLM 压缩为一段摘要
   - **标识符保护**: `strict` 模式下要求 LLM 保留所有 UUID/hash/路径/URL

### 配置

```json5
{
  session: {
    compaction: {
      enabled: true,
      model: null,             // null = 用 agent 当前模型，可配低成本模型
      triggerRatio: 0.85,
      keepRecentMessages: 10,
      identifierPolicy: "strict",
      memoryFlush: true,
    }
  }
}
```

### 优于 OpenClaw 的设计

- OpenClaw 在压缩后需要**重试整个请求**（多花一次 API 调用）；YanClaw 在发送前检查，避免浪费
- OpenClaw 冲刷到 Markdown 文件需重新索引；YanClaw 直接写入 SQLite + FTS5 即时可搜索
- OpenClaw 无记忆标签；YanClaw 给自动冲刷记忆打 `auto-flush` 标签方便筛选

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/compaction.ts` | 新建 | 压缩引擎核心 |
| `packages/server/src/config/schema.ts` | 修改 | 新增 `session.compaction` 配置 |
| `packages/server/src/agents/runtime.ts` | 修改 | 注入 LLM 压缩流程 |

---

## Review 修复

代码审查发现的问题：
- `compactMessages` 参数中移除了未使用的 `config`
- `UsageTracker.prune()` 清理了冗余的 `gte(createdAt, 0)` 条件
- `LoopDetector` 添加了基于 `lastActivity` 的会话状态驱逐机制（>100 条且空闲 >1 小时自动清理）

## 验证

- Biome lint: 仅剩 2 个预存问题（sessions.ts regex escape + test 文件 non-null assertion）
- Tests: 10 files, 122 passed, 2 skipped
- Server: 可正常启动
