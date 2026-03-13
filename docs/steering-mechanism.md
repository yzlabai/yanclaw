# 实时转向机制（Steering）

当 AI 智能体正在执行任务时，用户补充发送的消息通过 **Steering（实时转向）** 机制处理。本文档详细介绍其工作原理。

---

## 整体流程

```
用户发消息 A → chat.send → 注册 AbortController → streamText() 开始执行
                                                        │ 执行中...
用户又发消息 B → 前端检测到 isStreaming ─────────────────┤
              → 调用 POST /api/chat/steer              │
              → classifyIntent(B) 判断意图              │
              → 根据意图执行不同动作 ──────────────────── ▼
```

前端在用户发送消息时，若当前处于 `isStreaming` 状态，不走正常的 `chat.send`，而是调用 `chat.steer` 接口将消息交给 SteeringManager 处理。

---

## 三种意图分类

通过关键词匹配（`classifyIntent()`）将用户消息分为三种意图：

| 意图 | 触发关键词 | 行为 |
|---|---|---|
| **cancel** | `stop`, `cancel`, `停止`, `取消`, `算了`, `不用了` | 立即中断当前运行，清空队列，不再执行 |
| **redirect** | `不对`, `重新`, `改为`, `instead`, `actually`, `wait` | 中断当前运行，用新消息替换队列，重新开始 |
| **supplement** | 其他所有消息（默认） | 消息入队，当前运行结束后自动接力执行 |

分类逻辑：
1. 先精确匹配 cancel 关键词集合（含中英文）
2. 再检查消息是否以 redirect 关键词开头
3. 都不匹配则默认为 supplement

---

## 各意图详细行为

### Cancel — 取消当前运行

```
用户: "帮我写个排序算法"     → agent 开始执行
用户: "算了"                → classifyIntent → cancel
                            → abortController.abort()  中断 streamText
                            → pendingMessages = []     清空队列
                            → runtime 捕获 abort → 保存已有文本 + [interrupted]
                            → yield aborted 事件 → 前端停止 streaming 状态
```

服务端处理：
- 调用 `abortController.abort()` 触发 streamText 中断
- 清空 `pendingMessages` 队列，确保不会有后续执行
- 返回 `{ intent: "cancel", queued: false }`

### Redirect — 重定向

```
用户: "帮我写个冒泡排序"     → agent 开始执行
用户: "不对，改为快速排序"   → classifyIntent → redirect
                            → abortController.abort()  中断当前
                            → pendingMessages = ["不对，改为快速排序"]  替换队列
                            → 当前运行结束 → dequeue() 取出排队消息
                            → 发送 steering_resume 事件通知前端
                            → 以新消息重新调用 runMessage()
```

服务端处理：
- 中断当前运行
- **替换**（非追加）队列为新消息
- 返回 `{ intent: "redirect", queued: true }`
- 当前运行结束后自动启动新运行

### Supplement — 补充（最常见）

```
用户: "帮我分析这段代码"     → agent 开始执行
用户: "顺便加上单元测试"     → classifyIntent → supplement
                            → pendingMessages.push("顺便加上单元测试")
                            → agent 继续执行完当前任务（不中断）
                            → 执行完毕 → dequeue() 取出排队消息
                            → 发送 steering_resume 事件
                            → 以排队消息启动新一轮执行
```

服务端处理：
- **不中断**当前运行，仅将消息追加到队列
- 返回 `{ intent: "supplement", queued: true }`
- 支持多条消息排队，按 FIFO 顺序逐条执行

---

## 服务端排队与重放

### 运行结束后的排队检查

HTTP 和 WebSocket 入口都采用相同的递归模式：

```
runMessage(msg):
  1. chatSteering.register(sessionKey)  → 获取 AbortSignal
  2. agentRuntime.run({...signal})       → 流式执行
  3. 消费所有 AgentEvent，推送给客户端
  4. chatSteering.dequeue(sessionKey)    → 检查排队消息
     ├─ 无排队 → unregister(sessionKey) → 结束
     └─ 有排队 → 发送 steering_resume 事件 → runMessage(next)  递归
```

多条排队消息会逐条取出、逐轮执行，直到队列清空。

### SteeringManager 数据结构

```
active: Map<sessionKey, ActiveRun>

ActiveRun {
  abortController: AbortController   // 用于中断 streamText
  pendingMessages: string[]           // 排队的用户消息（FIFO）
}
```

每个 session 最多一个活跃运行，通过 AbortController 实现中断控制。

---

## 前端处理

### 发送时的分流

前端在用户点击发送时检测当前是否处于流式状态：

```typescript
if (isStreaming && text) {
  // 走 steer 接口，不走 send
  const result = await steerChat(sessionKey, text);
  if (result.intent === "cancel") {
    // 标记消息状态
  }
  // supplement/redirect → 前端显示 pending 状态，等待服务端处理
}
```

用户消息会立即以 `isPending: true` 状态添加到消息列表中，让用户感知到消息已被接收。

### 接收 steering_resume 事件

当服务端开始处理排队消息时，前端收到 `steering_resume` 事件：

1. 找到带 `isPending` 标记的用户消息，取消 pending 标记
2. 新增一个空的 assistant 消息占位（`isStreaming: true`）
3. 后续的 `delta` 事件将填充这个新的 assistant 消息

### 取消后的 UI 恢复

cancel 意图下前端收到 `aborted` 事件后：
- 停止 streaming 状态
- 保留已生成的部分文本（末尾标记 `[interrupted]`）

---

## 并发安全保障

### Session Lane 序列化

`AgentRuntime.run()` 使用 Session Lane 机制确保同一会话不会并发执行两个 agent run：

```
sessionLanes: Map<sessionKey, Promise<void>>

run(params):
  prevLane = sessionLanes.get(sessionKey)
  lanePromise = new Promise(resolve => releaseLane = resolve)
  sessionLanes.set(sessionKey, lanePromise)

  if (prevLane) await prevLane   // 等待前一个运行完成

  try { yield* _runInternal(params) }
  finally { releaseLane() }      // 释放锁
```

即使 redirect 中断了当前运行并启动新运行，也是严格串行的：
1. abort 触发 → 当前 streamText 结束 → 释放 lane
2. 新 run 获取 lane → 开始执行

### 断开连接清理

WebSocket 断开时，自动对该客户端所有活跃 session 调用 `chatSteering.remove()`：
- abort 残留的 AbortController
- 清空未处理的队列
- 从 active Map 中删除

---

## API 端点

| 端点 | 方法 | 用途 |
|---|---|---|
| `/api/chat/send` | POST | 正常发送消息（非 streaming 时） |
| `/api/chat/steer` | POST | streaming 期间发送转向消息 |
| `/api/chat/cancel` | POST | 强制取消当前运行 |
| WebSocket `chat.send` | JSON-RPC | 正常发送（WebSocket 通道） |
| WebSocket `chat.steer` | JSON-RPC | 转向（WebSocket 通道） |
| WebSocket `chat.cancel` | JSON-RPC | 取消（WebSocket 通道） |

---

## 关键文件

| 文件 | 职责 |
|---|---|
| `packages/server/src/agents/steering.ts` | SteeringManager 核心实现，意图分类 |
| `packages/server/src/routes/chat.ts` | HTTP 端点，steer/cancel 路由，递归重放 |
| `packages/server/src/routes/ws.ts` | WebSocket 端点，chat.steer/chat.cancel 处理 |
| `packages/server/src/agents/runtime.ts` | AgentRuntime，Session Lane 序列化，abort 处理 |
| `packages/web/src/pages/Chat.tsx` | 前端分流逻辑，steering_resume 事件处理 |
| `packages/web/src/lib/api.ts` | steerChat() API 封装 |
