# 2026-03-12 Agent 能力增强 P2 — 会话增强 / 渠道审批 / 跨会话通信

## 概述

实现 Agent 能力增强计划的 P2 五项功能：会话生命周期管理、并发保护、Discord 线程绑定、渠道内审批和跨会话通信。

对照文档：`docs/plans/2026-03-12-agent-capabilities-enhancement.md`

## 1. 会话自动重置

### 动机

长时间空闲的会话积累大量旧消息，浪费上下文窗口。需要自动清理机制。

### 实现

- **SessionStore.resetSession(key)**: 清空所有消息，保留会话元数据（agentId、channel、peer 等）
- **SessionStore.resetIdle(idleMs)**: 批量重置空闲超过指定时间的会话
- **空闲超时**: 启动时执行一次 + 每 30 分钟定时检查
- **每日定时重置**: 使用 `Intl.DateTimeFormat` 时区感知调度，支持跨午夜计算

### 配置

```json5
{
  session: {
    autoReset: {
      enabled: true,
      idleTimeout: "8h",
      dailyResetTime: "04:00",
      timezone: "Asia/Shanghai",
    }
  }
}
```

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/db/sessions.ts` | 修改 | 新增 resetSession / resetIdle 方法 |
| `packages/server/src/config/schema.ts` | 修改 | session.autoReset 配置项 |
| `packages/server/src/gateway.ts` | 修改 | 启动时重置 + 定时检查 + 每日重置调度 |

---

## 2. 会话序列化（防并发）

### 动机

同一会话的并发请求可能导致消息乱序、工具调用竞态。

### 实现

- **Session Lane**: `AgentRuntime` 内部维护 `Map<string, Promise<void>>` 串行队列
- **`run()` → `_runInternal()`**: 公开的 `run()` 方法先获取 lane 锁，等待前一次执行完成后再调用 `_runInternal()`
- **自动清理**: 执行完毕后如果 lane 仍属于当前请求则删除，避免内存泄漏
- **零配置**: 内置在 AgentRuntime 中，无需额外配置

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/runtime.ts` | 修改 | 添加 sessionLanes + run() 包装 |

---

## 3. 线程绑定（Discord / Slack）

### 动机

Discord 群聊中多个话题混杂在一个会话中，需要每个线程绑定独立会话。

### 实现

- **RouteContext.threadId**: 新增线程 ID 字段
- **buildSessionKey**: 当 `threadId` 存在时，生成 `agent:{agentId}:thread:{threadId}` 会话键
- **ChannelManager**: 从 `msg.peer.threadId` 或 `msg.threadId` 传递线程 ID
- **Discord 适配器**: 已有 `isThread()` 检测和 `threadId` 设置（无需修改）

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/routing/resolve.ts` | 修改 | RouteContext + buildSessionKey 线程支持 |
| `packages/server/src/channels/manager.ts` | 修改 | 传递 threadId 到路由 |

---

## 4. 渠道内审批

### 动机

工具审批只能在 Web UI 完成，Owner 需要打开浏览器才能 approve/deny。需要在 Telegram/Discord/Slack 内直接审批。

### 实现

- **ApprovalManager.channelNotifier**: 新增可选回调，在创建审批请求时同时通知渠道
- **ChannelManager 命令拦截**: 消息处理前检测 `/approve <id>` 和 `/deny <id>` 命令
- **Owner 验证**: 只有 ownerIds 中的用户可以执行审批命令
- **双通道**: WebSocket + 渠道消息两条通知路径，用户从任一渠道审批均可

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/approvals/manager.ts` | 修改 | channelNotifier 回调 + 通知逻辑 |
| `packages/server/src/channels/manager.ts` | 修改 | 命令拦截 + onApprovalCommand 回调 |
| `packages/server/src/gateway.ts` | 修改 | 连接 approvalManager.respond 到 channelManager |

---

## 5. 跨会话通信

### 动机

多 Agent 场景下需要 Agent 之间协作，发现其他会话并发送消息。

### 实现

- **session_list**: 列出活跃会话（支持 agentId 过滤），返回 key/title/channel/messageCount/updatedAt
- **session_send**: 向目标会话发送消息（ownerOnly），内容标记为 `[Cross-session message from ...]`
- **session_history**: 读取其他会话的最近消息历史
- **能力模型**: `session:read` / `session:write` 两种能力
- **安全限制**: `session_send` 为 ownerOnly，防止非 Owner 渠道消息跨会话污染

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/tools/session-comm.ts` | 新建 | 3 个跨会话工具 |
| `packages/server/src/agents/tools/index.ts` | 修改 | 注册工具 + 能力映射 + ownerOnly |
| `packages/server/src/agents/runtime.ts` | 修改 | 传递 sessionStore 到 createToolset |

---

## 验证

- Biome lint: 仅剩 3 个预存问题
- Tests: 10 files, 122 passed, 2 skipped
- Server: 可正常启动
