# 智能体对话响应机制

本文档详细介绍 YanClaw 智能体从接收用户消息到生成响应的完整流程，涵盖会话管理、上下文压缩、工具调用、安全防护、流式输出等核心机制。

---

## 目录

1. [消息流转全景](#1-消息流转全景)
2. [入口层：HTTP / WebSocket / 频道适配器](#2-入口层)
3. [会话序列化与并发控制](#3-会话序列化与并发控制)
4. [上下文构建流程](#4-上下文构建流程)
5. [模型解析与故障转移](#5-模型解析与故障转移)
6. [系统提示词组装](#6-系统提示词组装)
7. [工具集解析与三层策略过滤](#7-工具集解析与三层策略过滤)
8. [流式执行引擎](#8-流式执行引擎)
9. [安全防护体系](#9-安全防护体系)
10. [循环检测器](#10-循环检测器)
11. [上下文压缩（Compaction）](#11-上下文压缩compaction)
12. [用量追踪](#12-用量追踪)
13. [消息持久化](#13-消息持久化)
14. [频道响应投递](#14-频道响应投递)
15. [实时转向（Steering）](#15-实时转向steering)
16. [错误处理与恢复](#16-错误处理与恢复)
17. [配置参数速查](#17-配置参数速查)
18. [关键文件索引](#18-关键文件索引)

---

## 1. 消息流转全景

```
用户消息
  │
  ├─ HTTP POST /api/chat/send ──┐
  ├─ WebSocket chat.send RPC ───┤
  └─ 频道适配器 onMessage ──────┘
                                │
                        ┌───────▼────────┐
                        │   Auth 鉴权     │  Bearer Token 验证
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  会话序列化     │  同一 session 排队执行
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  加载历史消息   │  SQLite → CoreMessage[]
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  记忆预热       │  FTS5 + 向量检索
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  上下文压缩     │  超预算时触发
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  模型解析       │  场景×偏好 2D 查表
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  系统提示词组装 │  身份+安全+引导+记忆+运行时
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  工具集过滤     │  策略→所有者→能力→审批
                        └───────┬────────┘
                        ┌───────▼────────┐
                        │  streamText()  │  Vercel AI SDK 流式执行
                        │  maxSteps: 25  │  最多 25 轮工具调用
                        └───────┬────────┘
                          │ 流式事件 │
                          ▼         ▼
                   ┌──────────┐ ┌──────────┐
                   │ 安全扫描  │ │ 循环检测  │
                   └────┬─────┘ └────┬─────┘
                        ▼            ▼
                   ┌──────────────────────┐
                   │  yield AgentEvent    │  delta/tool_call/done/error
                   └──────────┬───────────┘
                        ┌─────▼──────┐
                        │ 消息持久化  │  user + assistant → SQLite
                        └─────┬──────┘
                        ┌─────▼──────┐
                        │ 用量记录    │  token 计数 + 成本估算
                        └─────┬──────┘
                        ┌─────▼──────┐
                        │ 转向检查    │  有排队消息则循环执行
                        └─────┬──────┘
                              ▼
                        响应投递至客户端/频道
```

---

## 2. 入口层

### 2.1 HTTP 流式端点

**文件**: `packages/server/src/routes/chat.ts`

```
POST /api/chat/send
Body: { agentId, sessionKey, message, imageUrls?, preference? }
Response: NDJSON 流（每行一个 JSON 事件）
```

使用 Hono 的 `c.stream()` 实现服务端流式推送，每产生一个 `AgentEvent` 就序列化为一行 JSON 写入响应流。客户端逐行解析即可实时获取增量文本、工具调用状态等。

### 2.2 WebSocket JSON-RPC

**文件**: `packages/server/src/routes/ws.ts`

采用 JSON-RPC 2.0 协议，请求方法 `chat.send`，响应通过通知方法推送：

| 通知方法 | 含义 |
|---|---|
| `chat.delta` | LLM 文本增量 |
| `chat.thinking` | 扩展思考（仅部分模型） |
| `chat.tool_call` | 工具调用请求 |
| `chat.tool_result` | 工具执行结果 |
| `chat.done` | 完成，附带 token 用量 |
| `chat.error` | 运行时错误 |
| `chat.aborted` | 被中断（转向/超时） |
| `chat.steering_resume` | 排队消息重放 |

还支持 `chat.steer`（实时转向）和 `chat.cancel`（取消当前运行）。

### 2.3 频道适配器

**文件**: `packages/server/src/channels/manager.ts`

ChannelManager 统一管理 Telegram / Discord / Slack / Feishu 适配器。每个适配器注册 `onMessage` 回调，收到消息后调用 `handleInbound(msg)` 进入路由匹配→智能体执行流程。频道侧不做流式推送，而是等待完整响应后分块发送。

---

## 3. 会话序列化与并发控制

**文件**: `packages/server/src/agents/runtime.ts`

为防止同一会话并发写入导致消息乱序或上下文竞争，AgentRuntime 使用 **Session Lane** 机制：

```
sessionLanes: Map<sessionKey, Promise<void>>
```

- 每次 `run()` 调用先获取当前 session 的 lane Promise
- 若已有运行中任务，`await prevLane` 等待其完成
- 本次任务结束后 `releaseLane()` 释放锁

**保证**：同一会话的消息严格串行处理，无并发竞争。

---

## 4. 上下文构建流程

### 4.1 历史消息加载

```typescript
const storedMessages = sessionStore.loadMessages(sessionKey);
// → CoreMessage[] { role: "user"|"assistant"|"system", content: string }
```

从 `messages` 表按 `createdAt ASC` 加载，转换为 Vercel AI SDK 的 `CoreMessage` 格式。

### 4.2 记忆预热

仅在会话**首条消息**时触发（`storedMessages.length === 0`）：

1. 对用户消息生成 embedding 向量
2. 在 MemoryStore 中执行 FTS5 全文检索 + 余弦相似度排序
3. 取 Top-5 相关记忆，拼入系统提示词的 `[Memory Context]` 段

作用：让智能体在新会话开始时就具备历史知识背景。

### 4.3 上下文压缩（详见第 11 节）

当预估 token 数超过 `contextBudget × triggerRatio` 时自动触发压缩。

---

## 5. 模型解析与故障转移

**文件**: `packages/server/src/agents/model-manager.ts`

### 5.1 二维解析表

ModelManager 通过 **场景 × 偏好** 二维查表解析最终模型：

| 场景 (scene) | 触发条件 |
|---|---|
| chat | 纯文本对话 |
| vision | 消息包含图片 |
| embedding | 生成向量嵌入 |
| stt | 语音转文本 |

| 偏好 (preference) | 含义 |
|---|---|
| default | 平衡 |
| fast | 低延迟优先 |
| quality | 质量优先 |
| cheap | 成本优先 |

解析链：`config.systemModels[scene][preference]` → 场景默认值 → 跨场景回退（vision→chat, summary→chat）。

### 5.2 多配置文件轮询

同一 provider 可配置多组 API Key（profile），ModelManager 在可用 profile 间**轮询**（round-robin），避免单一 key 限流。

### 5.3 故障转移

```
失败计数 ≥ 3  →  进入冷却期（60s）
冷却期间      →  跳过该 profile，使用下一个
成功一次      →  重置失败计数，恢复可用
```

---

## 6. 系统提示词组装

**文件**: `packages/server/src/agents/system-prompt-builder.ts`

系统提示词按以下顺序分层拼接：

| 层级 | 内容 | 说明 |
|---|---|---|
| 1 | Identity | 智能体自定义 systemPrompt 或默认人设 |
| 2 | Safety Guardrails | 硬编码安全规则 |
| 3 | Bootstrap Files | SOUL.md / TOOLS.md / MEMORY.md / CONTEXT.md（完整模式） |
| 4 | Skill Prompts | 插件注入的提示词（带边界标记防注入） |
| 5 | Memory Context | 预热的相关记忆 |
| 6 | Runtime Info | 当前日期、时区、模型、工作目录 |
| 7 | Channel Context | 频道类型提示（完整模式） |
| 8 | Safety Suffix | 提示注入防御后缀 |

Bootstrap 文件有单文件 20,000 字符、总量 150,000 字符的上限，超出时保留 70% 头部 + 20% 尾部并标记截断。

---

## 7. 工具集解析与三层策略过滤

**文件**: `packages/server/src/agents/tools/index.ts`

### 7.1 可用工具清单

| 类别 | 工具 |
|---|---|
| 执行 | shell（或 docker 沙箱）, code_exec（Python/JS 沙箱） |
| 文件 | file_read, file_write, file_edit |
| 网络 | web_search, web_fetch |
| 浏览器 | browser_navigate, browser_screenshot, browser_action |
| 记忆 | memory_store, memory_search, memory_delete |
| 桌面 | screenshot_desktop |
| 会话 | session_list, session_send, session_history |
| MCP | mcp.\<server\>.\<tool\>（外部 MCP 服务器工具） |
| 插件 | \<pluginId\>.\<tool\>（注册的插件工具） |

### 7.2 三层策略过滤

```
全局策略 (global)  →  智能体策略 (agent)  →  频道策略 (channel)
```

每层可配置 `allow` / `deny` 列表，支持通配符和工具组：

| 工具组 | 包含工具 |
|---|---|
| `group:exec` | shell, code_exec |
| `group:file` | file_read, file_write, file_edit |
| `group:web` | web_search, web_fetch |
| `group:browser` | browser_navigate, browser_screenshot, browser_action |
| `group:memory` | memory_store, memory_search, memory_delete |

### 7.3 Owner-Only 限制

以下工具仅所有者（owner）可使用：

`shell`, `file_write`, `file_edit`, `browser_*`, `screenshot_desktop`, `session_send`

非所有者调用时工具不会出现在工具列表中。

### 7.4 能力过滤

智能体有能力预设（capability preset），每个工具需要特定能力：

| 预设 | 可用能力 |
|---|---|
| safe-reader | 只读文件 + 记忆读取 |
| researcher | 只读 + 网络 + 记忆 |
| developer | 文件读写 + 执行 + 网络 + 记忆 |
| full-access | 全部能力 |

### 7.5 审批包装

当 `toolsConfig.exec.ask` 不为 `"off"` 时，shell 工具被包装为需审批流程——执行前发送审批请求，等待用户批准或拒绝。

---

## 8. 流式执行引擎

**文件**: `packages/server/src/agents/runtime.ts`

### 8.1 核心调用

```typescript
const result = streamText({
  model,                    // 解析后的模型实例
  messages,                 // [system, ...history, userMsg]
  tools,                    // 过滤后的工具集
  maxSteps: 25,             // 最多 25 轮工具调用
  abortSignal: signal,      // 支持中断
});
```

使用 Vercel AI SDK 的 `streamText()`，内置 agentic loop：LLM 可在一次请求中连续调用多轮工具（每轮工具结果反馈给 LLM 决定下一步），直到 LLM 输出最终文本或达到 maxSteps 上限。

### 8.2 事件流

```typescript
for await (const part of result.fullStream) {
  switch (part.type) {
    case "text-delta":     // → yield { type: "delta", text }
    case "reasoning":      // → yield { type: "thinking", text }
    case "tool-call":      // → yield { type: "tool_call", name, args }
    case "tool-result":    // → yield { type: "tool_result", name, result, duration }
    case "error":          // → yield { type: "error", message }
  }
}
```

### 8.3 AgentEvent 类型

| 事件 | 含义 |
|---|---|
| `delta` | LLM 输出的文本增量 |
| `thinking` | 扩展思考 token（仅特定模型） |
| `tool_call` | 工具调用请求（名称 + 参数） |
| `tool_result` | 工具执行结果（名称 + 结果 + 耗时） |
| `done` | 完成，附带 token 用量统计 |
| `aborted` | 被中断，附带已生成的部分文本 |
| `error` | 运行时错误 |
| `steering_resume` | 转向后重放排队消息 |

---

## 9. 安全防护体系

### 9.1 凭证泄露检测

在流式输出过程中实时扫描 LLM 生成的文本：

```typescript
const check = leakDetector.scan(fullText + part.textDelta);
if (check.leaked) {
  yield { type: "error", message: "Response blocked: potential credential leak" };
  return;  // 立即终止
}
```

LeakDetector 维护已注册的 API Key、密码等正则模式，一旦 LLM 输出匹配到明文凭证，立即阻断响应。

### 9.2 数据流启发式

工具调用时检查可疑模式：

```typescript
const flowCheck = checkDataFlow(toolName, args);
// 例如：写入 /etc/ 目录、外传凭证到外部 URL
```

当前仅记录警告，不阻断执行。

### 9.3 工具结果注入检测

工具执行返回结果后：

1. **注入模式检测**：扫描结果中是否包含提示注入攻击模式
2. **不可信内容包装**：用边界标记包裹工具输出

```
===BEGIN_TOOL_RESULT===
{工具输出内容}
===END_TOOL_RESULT===
```

防止工具输出中的恶意指令被 LLM 误解为系统指令。

### 9.4 插件钩子

插件可注册 `beforeToolCall` 钩子，在工具执行前拦截并决定是否放行。

---

## 10. 循环检测器

**文件**: `packages/server/src/agents/tools/loop-detector.ts`

防止智能体陷入无效循环，浪费 token。

### 10.1 检测策略

| 策略 | 机制 | 警告阈值 | 阻断阈值 |
|---|---|---|---|
| **相同调用** | 对 `toolName:args` 哈希，计数重复次数 | ≥10 次 | ≥20 次 |
| **乒乓模式** | 检测 A→B→A→B 交替调用模式 | ≥10 轮 | ≥20 轮 |
| **输出停滞** | 同一工具连续 3+ 次产生相同输出 | ≥10 次 | — |
| **断路器** | 单会话累计被阻断次数 | — | ≥30 次 |

### 10.2 处理动作

- **warn**: 记录日志，继续执行
- **block**: 阻止本次工具调用，终止当前运行
- **circuit_break**: 断路器跳闸，立即终止并报错

### 10.3 会话级追踪

每个 session 独立维护：
- 最近 30 次调用的哈希记录
- 累计阻断计数
- 最后活跃时间（空闲 1 小时后自动清理）

---

## 11. 上下文压缩（Compaction）

**文件**: `packages/server/src/agents/compaction.ts`

### 11.1 触发条件

```typescript
needsCompaction(messages, contextBudget, triggerRatio)
// 当预估 token 数 > contextBudget × triggerRatio 时触发
// 默认：128K × 0.8 = 约 102K tokens
```

Token 预估算法：ASCII 字符按 4 字符/token，CJK 字符按 1 字符/token。

### 11.2 压缩流程

```
原始消息列表: [system, msg1, msg2, ..., msg(n-k), ..., msg(n)]
                     │                     │            │
                     └─── 待压缩消息 ──────┘            │
                     │                                  │
                     ▼                                  ▼
              ┌─────────────┐                    保留最近 K 条
              │ 可选：记忆冲刷│
              │ 提取重要事实  │
              │ → MemoryStore│
              └──────┬──────┘
                     ▼
              ┌─────────────┐
              │ LLM 摘要生成 │
              │ 目标：20% 长度│
              └──────┬──────┘
                     ▼
压缩后: [system, summary_msg, msg(n-k+1), ..., msg(n), current_user_msg]
```

### 11.3 记忆冲刷

当 `compaction.memoryFlush` 开启时，压缩前先让 LLM 从即将丢弃的旧消息中提取关键事实（最多 10 条），存入 MemoryStore 并生成 embedding。确保重要信息不会因压缩而永久丢失。

### 11.4 摘要策略

LLM 收到如下指令：

> 将以下对话历史总结为简洁但全面的摘要。要求：
> - 保留所有关键决策、结论和待办事项
> - 保留所有技术细节（代码片段、配置、命令）
> - 保留时间顺序
> - 目标约为原文 20% 长度
> - 使用与原文相同的语言

---

## 12. 用量追踪

**文件**: `packages/server/src/agents/usage-tracker.ts`

### 12.1 记录字段

每次智能体调用完成后记录：

| 字段 | 说明 |
|---|---|
| sessionKey | 会话标识 |
| agentId | 智能体 ID |
| model | 使用的模型 |
| provider | 提供商（anthropic/openai/google/deepseek） |
| inputTokens | 输入 token 数 |
| outputTokens | 输出 token 数 |
| cacheReadTokens | 缓存命中 token 数 |
| cacheWriteTokens | 缓存写入 token 数 |
| estimatedCostUsd | 估算成本（美元） |
| durationMs | 执行耗时 |

### 12.2 成本估算

内置各主流模型定价表，支持缓存折扣计算。例如：
- Claude 3.5 Sonnet：$3/M 输入 + $15/M 输出
- GPT-4o：$2.5/M 输入 + $10/M 输出
- Gemini Pro：$1.25/M 输入 + $10/M 输出

### 12.3 查询 API

- `summary(days)`: 指定天数内总 token 与成本
- `byAgent(days)`: 按智能体分组统计
- `byModel(days)`: 按模型分组统计
- `daily(days)`: 每日成本趋势
- `recent(limit)`: 最近 N 条记录
- `prune(days)`: 清理超期记录

---

## 13. 消息持久化

**文件**: `packages/server/src/db/sessions.ts`

### 13.1 保存时机

流式执行完成后（或中断后），将 user 消息和 assistant 消息一并写入：

```typescript
sessionStore.saveMessages(sessionKey, [
  { role: "user", content: message },
  { role: "assistant", content: fullText, model, tokenCount },
]);
```

### 13.2 事务写入

使用 SQLite 事务确保原子性：

1. 逐条插入 `messages` 表（nanoid 作为主键）
2. 更新 `sessions` 表的 `messageCount`、`tokenCount`、`updatedAt`

### 13.3 自动标题

首次对话完成后异步（fire-and-forget）让 LLM 生成不超过 6 个词的会话标题，更新 `session.title` 供前端展示。

### 13.4 中断保存

若流被中断（steering abort / 超时），已生成的部分文本仍会保存，并在末尾标记 `[interrupted]`。

---

## 14. 频道响应投递

**文件**: `packages/server/src/channels/manager.ts`

### 14.1 文本收集

频道侧不做流式推送。ChannelManager 消费所有 `AgentEvent`，将 `delta` 事件的文本拼接为完整 buffer。

### 14.2 分块发送

不同频道有不同的消息长度限制：

| 频道 | 单消息上限 |
|---|---|
| Telegram | 4096 字符 |
| Discord | 2000 字符 |
| Slack | 4000 字符 |

分块算法优先级：
1. 在 `maxLength` 范围内找换行符断开
2. 回退：找空格断开
3. 回退：硬截断

每个分块通过 `adapter.send()` 发送，支持 Markdown 格式（若频道支持）和消息回复/线程。

---

## 15. 实时转向（Steering）

**文件**: `packages/server/src/agents/steering.ts`

允许用户在智能体执行过程中发送新消息来改变行为方向。

### 15.1 意图分类

```
用户消息 → classifyIntent()
  ├─ "stop"/"cancel"/"停止"  →  cancel（取消）
  ├─ "wait"/"actually"/"不对" →  redirect（重定向）
  └─ 其他                    →  supplement（补充）
```

### 15.2 处理方式

| 意图 | 行为 |
|---|---|
| cancel | 中断当前运行，清空队列，回到空闲状态 |
| redirect | 中断当前运行，用新消息替换，重新开始 |
| supplement | 将消息加入队列，当前运行完成后自动重放 |

### 15.3 重放机制

当前运行结束后检查队列：

```typescript
const next = chatSteering.dequeue(sessionKey);
if (next) {
  yield { type: "steering_resume", message: next };
  // 以排队消息为输入，启动新一轮执行
}
```

---

## 16. 错误处理与恢复

### 16.1 流式中断

```typescript
catch (streamErr) {
  if (signal?.aborted) {
    // 转向中断或超时 → 保存已有文本 + [interrupted]
    yield { type: "aborted", partial: fullText };
  } else {
    // 模型/网络错误 → 上报失败给 ModelManager
    modelManager.reportFailure(provider, profileId);
    throw streamErr;
  }
}
```

### 16.2 ModelManager 故障恢复

```
调用失败 → failCount++
  ├─ failCount < 3  → 下次仍尝试该 profile
  └─ failCount ≥ 3  → 冷却 60s → 期间跳过该 profile
                       → 使用下一个可用 profile
                       → 成功一次后重置 failCount
```

### 16.3 工具执行超时

shell 工具默认 30s 超时，超时后进程被终止，返回超时错误。

---

## 17. 配置参数速查

### 上下文与压缩

| 参数 | 默认值 | 说明 |
|---|---|---|
| `session.contextBudget` | ~131,072 | 上下文窗口 token 上限 |
| `compaction.enabled` | true | 是否启用自动压缩 |
| `compaction.triggerRatio` | 0.8 | 触发压缩的阈值比例 |
| `compaction.keepRecentMessages` | 5-10 | 压缩时保留最近消息数 |
| `compaction.memoryFlush` | true | 压缩前是否冲刷记忆 |
| `session.pruneAfterDays` | 90 | 自动清理过期会话天数 |

### 工具执行

| 参数 | 默认值 | 说明 |
|---|---|---|
| `tools.exec.timeout` | 30,000ms | shell 命令超时 |
| `tools.exec.maxOutput` | 100,000B | 输出截断阈值 |
| `tools.exec.sandbox.enabled` | false | Docker 沙箱隔离 |
| `tools.exec.ask` | "off" | 审批模式（off/on-miss/always） |

### 模型故障转移

| 参数 | 默认值 | 说明 |
|---|---|---|
| `maxFails` | 3 | 触发冷却的失败次数 |
| `cooldownMs` | 60,000 | 冷却持续时间 |

### 循环检测

| 参数 | 默认值 | 说明 |
|---|---|---|
| `historySize` | 30 | 追踪最近调用数 |
| `warningThreshold` | 10 | 警告阈值 |
| `blockThreshold` | 20 | 阻断阈值 |
| `circuitBreaker` | 30 | 断路器阈值 |

---

## 18. 关键文件索引

| 文件 | 职责 |
|---|---|
| `packages/server/src/agents/runtime.ts` | 智能体执行主循环（~605 行） |
| `packages/server/src/agents/model-manager.ts` | 模型解析与故障转移（~318 行） |
| `packages/server/src/agents/compaction.ts` | 上下文压缩算法（~210 行） |
| `packages/server/src/agents/usage-tracker.ts` | Token 用量与成本追踪（~210 行） |
| `packages/server/src/agents/steering.ts` | 实时转向管理（~141 行） |
| `packages/server/src/agents/system-prompt-builder.ts` | 系统提示词分层组装（~187 行） |
| `packages/server/src/agents/tools/loop-detector.ts` | 循环检测器（~219 行） |
| `packages/server/src/agents/tools/index.ts` | 工具集创建与策略过滤（~349 行） |
| `packages/server/src/routes/chat.ts` | HTTP 流式端点（~85 行） |
| `packages/server/src/routes/ws.ts` | WebSocket JSON-RPC（~303 行） |
| `packages/server/src/channels/manager.ts` | 频道消息路由与投递（~360 行） |
| `packages/server/src/db/sessions.ts` | 消息持久化（~250+ 行） |
| `packages/server/src/gateway.ts` | 网关初始化与组件装配（~200+ 行） |
