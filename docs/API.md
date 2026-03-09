# YanClaw API 接口文档

> 参考 OpenClaw Gateway RPC 设计，使用 Hono + Zod 实现

## 概述

Gateway 提供 RESTful HTTP API 和 WebSocket 两种接口。所有 API 路径以 `/api` 为前缀。

- **基础地址**: `http://localhost:18789`
- **认证方式**: `Authorization: Bearer <token>`
- **数据格式**: JSON
- **WebSocket**: `ws://localhost:18789/api/ws`

---

## 认证

所有 API 请求需携带 Bearer Token：

```
Authorization: Bearer <token>
```

Token 在 Gateway 首次启动时自动生成，存储在 `~/.yanclaw/auth.token`。Tauri 前端通过 IPC 自动获取，无需手动输入。

**免认证端点**: `GET /api/system/health`

---

## REST API

### Chat（对话）

#### POST /api/chat/send

发送消息给 Agent 并获取回复。

**请求体**:
```json
{
  "agentId": "main",
  "sessionKey": "agent:main:main",
  "message": "你好"
}
```

**响应**: 流式 SSE（Server-Sent Events）或 JSON

```json
{
  "sessionKey": "agent:main:main",
  "reply": "你好！有什么可以帮你的吗？",
  "toolCalls": [],
  "usage": { "promptTokens": 150, "completionTokens": 42 }
}
```

#### GET /api/chat/stream

SSE 流式端点，用于实时接收 Agent 输出。

**查询参数**: `sessionKey`

**SSE 事件格式**:
```
event: delta
data: {"text": "你好"}

event: tool_call
data: {"name": "shell", "args": {"command": "ls"}}

event: tool_result
data: {"name": "shell", "result": "file1.txt\nfile2.txt"}

event: done
data: {}
```

---

### Agents（Agent 管理）

#### GET /api/agents

列出所有 Agent。

**响应**:
```json
[
  {
    "id": "main",
    "name": "默认助手",
    "model": "claude-sonnet-4-20250514",
    "systemPrompt": "You are a helpful assistant.",
    "workspaceDir": "~/.yanclaw/workspace/main",
    "status": "idle"
  }
]
```

#### POST /api/agents

创建新 Agent。

**请求体**:
```json
{
  "id": "code-agent",
  "name": "代码助手",
  "model": "claude-sonnet-4-20250514",
  "systemPrompt": "You are a coding assistant. Help users write and debug code."
}
```

#### GET /api/agents/:id

获取单个 Agent 详情。

#### PATCH /api/agents/:id

更新 Agent 配置。

**请求体**（部分更新）:
```json
{
  "model": "gpt-4o",
  "systemPrompt": "Updated prompt."
}
```

#### DELETE /api/agents/:id

删除 Agent。`main` Agent 不允许删除。

---

### Channels（通道管理）

#### GET /api/channels

列出所有已配置通道及其状态。

**响应**:
```json
[
  {
    "id": "telegram-main",
    "type": "telegram",
    "name": "Telegram Bot",
    "status": "connected",
    "connectedAt": 1710000000000,
    "messageCount": 1234
  },
  {
    "id": "discord-main",
    "type": "discord",
    "name": "Discord Bot",
    "status": "disconnected"
  }
]
```

#### POST /api/channels

添加新通道。

**请求体**:
```json
{
  "type": "telegram",
  "name": "Telegram Bot",
  "config": {
    "token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
  }
}
```

#### PATCH /api/channels/:id

更新通道配置。

#### DELETE /api/channels/:id

删除通道。先断开连接再删除。

#### POST /api/channels/:id/connect

连接指定通道。

**响应**:
```json
{ "status": "connected" }
```

#### POST /api/channels/:id/disconnect

断开指定通道。

#### GET /api/channels/:id/health

通道健康检查。

**响应**:
```json
{
  "status": "connected",
  "latency": 45,
  "lastMessageAt": 1710000000000
}
```

---

### Messages（消息）

#### POST /api/messages/send

通过指定通道发送消息。

**请求体**:
```json
{
  "channel": "telegram",
  "peer": {
    "kind": "direct",
    "id": "user_123"
  },
  "text": "这是一条消息",
  "attachments": []
}
```

**响应**:
```json
{
  "sent": true,
  "messageId": "msg_abc123"
}
```

---

### Sessions（会话管理）

#### GET /api/sessions

列出所有会话。

**查询参数**:
| 参数 | 类型 | 说明 |
|------|------|------|
| `agentId` | string | 按 Agent 筛选 |
| `channel` | string | 按通道筛选 |
| `limit` | number | 每页数量（默认 20） |
| `offset` | number | 偏移量 |
| `sort` | string | 排序字段：`updatedAt`（默认）、`createdAt` |

**响应**:
```json
{
  "sessions": [
    {
      "key": "agent:main:telegram:direct:user_123",
      "agentId": "main",
      "channel": "telegram",
      "peerId": "user_123",
      "peerName": "Alice",
      "messageCount": 42,
      "tokenCount": 15000,
      "createdAt": 1710000000000,
      "updatedAt": 1710100000000
    }
  ],
  "total": 100
}
```

#### GET /api/sessions/:key

获取会话详情（含消息历史）。

**响应**:
```json
{
  "key": "agent:main:telegram:direct:user_123",
  "agentId": "main",
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "帮我查一下天气",
      "createdAt": 1710000000000
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "北京今天晴，25°C...",
      "toolCalls": [
        {
          "name": "web_search",
          "args": { "query": "北京今天天气" },
          "result": "..."
        }
      ],
      "createdAt": 1710000001000
    }
  ]
}
```

#### DELETE /api/sessions/:key

删除会话及其所有消息。

#### POST /api/sessions/:key/export

导出会话为 JSON。

---

### Config（配置）

#### GET /api/config

读取完整配置。敏感字段（API Key 等）会被遮蔽。

**响应**:
```json
{
  "gateway": {
    "port": 18789,
    "bind": "loopback"
  },
  "agents": [{ "id": "main", "name": "默认助手", "model": "..." }],
  "models": {
    "anthropic": { "apiKey": "sk-ant-***" },
    "openai": { "apiKey": "sk-***" }
  },
  "channels": { "...": "..." },
  "routing": { "bindings": [], "default": "main" },
  "tools": { "policy": { "default": "allow" } }
}
```

#### PATCH /api/config

更新部分配置。支持深层合并。

**请求体**:
```json
{
  "models": {
    "anthropic": { "apiKey": "sk-ant-new-key" }
  },
  "tools": {
    "exec": { "ask": "always" }
  }
}
```

**响应**:
```json
{ "updated": true, "reloadRequired": false }
```

---

### Cron（定时任务）

#### GET /api/cron

列出所有定时任务。

**响应**:
```json
[
  {
    "id": "daily-summary",
    "agent": "main",
    "schedule": "0 9 * * *",
    "prompt": "总结昨天的工作进展",
    "deliveryTargets": [
      { "channel": "telegram", "peer": "user_123" }
    ],
    "enabled": true,
    "lastRunAt": 1710000000000,
    "nextRunAt": 1710086400000
  }
]
```

#### POST /api/cron

创建定时任务。

**请求体**:
```json
{
  "agent": "main",
  "schedule": "0 9 * * *",
  "prompt": "检查服务器状态",
  "deliveryTargets": [
    { "channel": "telegram", "peer": "user_123" }
  ],
  "enabled": true
}
```

#### PATCH /api/cron/:id

更新定时任务。

#### DELETE /api/cron/:id

删除定时任务。

#### POST /api/cron/:id/run

立即执行一次定时任务（不影响原调度）。

---

### System（系统）

#### GET /api/system/health

健康检查（免认证）。

**响应**:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "uptime": 3600,
  "gateway": { "port": 18789, "bind": "loopback" }
}
```

#### GET /api/system/status

系统状态概览。

**响应**:
```json
{
  "agents": { "count": 2, "active": 1 },
  "channels": { "total": 3, "connected": 2 },
  "sessions": { "total": 50, "active": 3 },
  "cron": { "total": 5, "enabled": 3 },
  "memory": { "heapUsed": 45000000, "rss": 80000000 },
  "uptime": 3600
}
```

---

### Media（媒体）

#### GET /api/media/:id

获取媒体文件。返回文件流。

**响应头**:
```
Content-Type: image/png
Content-Length: 12345
```

#### POST /api/media/upload

上传媒体文件。

**请求**: `multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| `file` | File | 文件内容 |
| `sessionKey` | string | 关联会话（可选） |

**响应**:
```json
{
  "id": "media_abc123",
  "type": "image/png",
  "size": 12345,
  "url": "/api/media/media_abc123"
}
```

---

## WebSocket API

### 连接

```
ws://localhost:18789/api/ws
```

连接时需在 URL 参数或首条消息中携带认证 Token：

```
ws://localhost:18789/api/ws?token=<token>
```

### JSON-RPC 2.0 协议

WebSocket 消息均为 JSON-RPC 2.0 格式。

#### 请求格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "chat.send",
  "params": {
    "agentId": "main",
    "sessionKey": "agent:main:main",
    "message": "你好"
  }
}
```

#### 响应格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": { "status": "streaming" }
}
```

#### 错误格式

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": { "details": "Missing agentId" }
  }
}
```

### 方法列表

| 方法 | 说明 | 参数 |
|------|------|------|
| `chat.send` | 发送消息并开始流式回复 | `agentId`, `sessionKey`, `message` |
| `chat.cancel` | 取消当前生成 | `sessionKey` |
| `approval.respond` | 响应工具审批请求 | `id`, `approved` |
| `subscribe` | 订阅事件主题 | `topics: string[]` |
| `unsubscribe` | 取消订阅 | `topics: string[]` |

### 服务端推送事件（通知）

服务端主动推送的事件没有 `id` 字段：

#### delta — 流式文本片段

```json
{
  "jsonrpc": "2.0",
  "method": "chat.delta",
  "params": {
    "sessionKey": "agent:main:main",
    "text": "你好！"
  }
}
```

#### tool_call — Agent 发起工具调用

```json
{
  "jsonrpc": "2.0",
  "method": "chat.tool_call",
  "params": {
    "sessionKey": "agent:main:main",
    "name": "shell",
    "args": { "command": "ls -la" }
  }
}
```

#### tool_result — 工具执行结果

```json
{
  "jsonrpc": "2.0",
  "method": "chat.tool_result",
  "params": {
    "sessionKey": "agent:main:main",
    "name": "shell",
    "result": "total 32\ndrwxr-xr-x ..."
  }
}
```

#### done — 回复完成

```json
{
  "jsonrpc": "2.0",
  "method": "chat.done",
  "params": {
    "sessionKey": "agent:main:main",
    "usage": { "promptTokens": 150, "completionTokens": 42 }
  }
}
```

#### error — 执行错误

```json
{
  "jsonrpc": "2.0",
  "method": "chat.error",
  "params": {
    "sessionKey": "agent:main:main",
    "message": "Model API rate limited",
    "code": "RATE_LIMITED"
  }
}
```

#### approval_request — 工具审批请求

```json
{
  "jsonrpc": "2.0",
  "method": "approval.request",
  "params": {
    "id": "apr_001",
    "sessionKey": "agent:main:main",
    "tool": "shell",
    "args": { "command": "rm -rf /tmp/test" },
    "timeout": 300
  }
}
```

前端收到后展示审批对话框，用户操作后回复：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "approval.respond",
  "params": { "id": "apr_001", "approved": true }
}
```

#### channel_status — 通道状态变更

```json
{
  "jsonrpc": "2.0",
  "method": "channel.status",
  "params": {
    "channelId": "telegram-main",
    "status": "connected",
    "timestamp": 1710000000000
  }
}
```

---

## 错误码

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误（Zod 校验失败） |
| 401 | 未认证或 Token 无效 |
| 404 | 资源不存在 |
| 409 | 资源冲突（如通道已连接） |
| 422 | 业务逻辑错误（如模型不可用） |
| 500 | 内部错误 |
| 503 | 服务不可用（Gateway 启动中） |

### JSON-RPC 错误码

| 错误码 | 说明 |
|--------|------|
| -32700 | 解析错误（非法 JSON） |
| -32600 | 无效请求 |
| -32601 | 方法不存在 |
| -32602 | 参数错误 |
| -32603 | 内部错误 |
| -32000 | 模型调用失败 |
| -32001 | 工具执行失败 |
| -32002 | 审批超时 |
| -32003 | 通道离线 |
| -32004 | 会话不存在 |

---

## 类型安全调用（前端）

前端通过 Hono RPC Client 调用所有 REST API，类型自动推导：

```typescript
import { hc } from "hono/client";
import type { AppType } from "@yanclaw/server/app";

const api = hc<AppType>("http://localhost:18789");

// GET /api/channels — 返回类型自动推导
const res = await api.api.channels.$get();
const channels = await res.json();

// POST /api/agents — 参数类型自动推导，拼写错误编译期报错
const res2 = await api.api.agents.$post({
  json: { id: "new-agent", name: "新 Agent", model: "gpt-4o" }
});

// PATCH /api/config — 深层合并
const res3 = await api.api.config.$patch({
  json: { models: { anthropic: { apiKey: "sk-ant-..." } } }
});
```
