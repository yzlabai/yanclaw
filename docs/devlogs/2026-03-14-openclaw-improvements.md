# 2026-03-14 OpenClaw 启发的改进 — 开发记录

## 概述

研究 OpenClaw 项目后，提取可供 YanClaw 参考的功能点，经过需求 review 排除了 6 项已有实现和 2 项过度工程化的需求，最终实现 3 个新功能：Slash Commands、Typing Indicators、Resumable Sessions。

对照计划文档：`docs/plans/2026-03-14-openclaw-inspired-improvements.md`

## 实现内容

### Phase 1: Slash Commands（零 Token 消耗的网关级指令）

在消息到达 agent 之前拦截 `/` 开头的命令，节省 token 开销。

**新增文件：**
- `packages/server/src/channels/slash-commands.ts` — 命令注册与分发

**修改文件：**
- `packages/server/src/channels/manager.ts` — 在消息处理流程中注入 slash command 拦截（step 0.5）

**支持的命令：**

| 命令 | 功能 |
|------|------|
| `/model [id]` | 查看/切换当前会话模型 |
| `/reset` | 清空会话上下文 |
| `/status` | 显示 agent、模型、消息数、token 统计 |
| `/resume` | 恢复中断的任务（Phase 3 联动） |
| `/discard` | 丢弃中断的任务 |
| `/help` | 列出可用命令 |

**设计决策：**
- 复用已有的 `resolveRoute()` 获取 sessionKey，避免重复路由逻辑
- `parseSlashCommand()` 对未注册命令返回 null，消息原样传递给 agent
- `/resume` 返回 `handled: true` 但展示任务上下文信息，后续可扩展为真正的恢复执行

### Phase 2: Typing Indicators（输入状态提示）

agent 处理消息时在聊天平台显示"正在输入"状态，提升用户体验。

**修改文件：**
- `packages/server/src/channels/types.ts` — `ChannelAdapter` 接口新增可选 `sendTyping?(peer): Promise<void>`
- `packages/server/src/channels/telegram.ts` — 实现 `sendChatAction("typing")`
- `packages/server/src/channels/discord.ts` — 实现 `channel.sendTyping()` (try/catch 容错)
- `packages/server/src/channels/manager.ts` — agent 执行前启动 5 秒间隔的 typing timer，`finally` 中清除

**策略：**
- DM 和 thread 始终显示 typing
- Group 消息由 adapter 层的 @mention 检测过滤，无需额外判断

### Phase 3: Resumable Sessions（可恢复执行）

服务器重启后能检测中断的 agent 执行并支持恢复。

**新增文件：**
- `packages/server/src/db/executions.ts` — `ExecutionStore` 类（CRUD + 中断检测 + 清理）

**修改文件：**
- `packages/server/src/db/schema.ts` — 新增 `agentExecutions` 表（id, sessionKey, agentId, status, userMessage, completedSteps, partialResponse, startedAt, updatedAt）
- `packages/server/src/db/sqlite.ts` — 迁移 v8 创建表和索引
- `packages/server/src/agents/runtime.ts` — 在 `_runInternal()` 中集成执行追踪（创建记录 → 工具调用后更新进度 → 完成时标记）
- `packages/server/src/gateway.ts` — `ExecutionStore` 加入 `GatewayContext`，启动时标记遗留 running 为 interrupted，定期清理已完成记录
- `packages/server/src/channels/slash-commands.ts` — `/resume` 和 `/discard` 命令
- `packages/server/src/channels/manager.ts` — `executions` 属性注入到 slash command context

**数据流：**

```
agent 启动 → executionStore.create()
  ↓
每次工具调用完成 → executionStore.updateProgress(steps, partial)
  ↓
agent 完成 → executionStore.complete()

服务器重启 → markRunningAsInterrupted()
  ↓
用户发送 /resume → 展示中断任务上下文
用户发送 /discard → 删除中断记录
```

## 不做的事情

| 需求 | 理由 |
|------|------|
| ContextEngine 插件化 | `compaction.ts` 已有完整实现，无第二种上下文策略的实际需求 |
| Provider 插件化 | `ModelManager` 的 switch-case 已覆盖 5 种 provider，加 registry 抽象无实际收益 |

## 验证

- `bun run test` — 186 tests passed, 2 skipped
- `bunx biome check` — 全部文件 lint 通过，无警告
