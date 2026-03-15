# YanClaw 服务端（CLI）

> Gateway 后端服务的启动、配置和 API 使用指南。

---

## 1. 概述

`@yanclaw/server` 是 YanClaw 的核心后端，基于 Bun + Hono 构建。它提供 HTTP REST API、WebSocket 实时通信、AI Agent 运行时、消息通道网关、以及完整的安全体系。

服务端既可作为 Tauri 桌面应用的子进程运行，也可独立以 CLI 方式启动。

---

## 2. 快速开始

### 开发模式

```bash
# 安装依赖
bun install

# 启动开发服务器（watch 模式，端口 18789）
bun run dev:server
```

### 生产模式

```bash
# 编译为独立二进制
bun run --filter @yanclaw/server build:compile

# 运行编译后的二进制
./src-tauri/server/yanclaw-server       # macOS/Linux
./src-tauri/server/yanclaw-server.exe   # Windows
```

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 监听端口（覆盖配置） | `18789` |
| `YANCLAW_CONFIG_PATH` | 配置文件路径 | `~/.yanclaw/config.json5` |
| `ANTHROPIC_API_KEY` | Anthropic API Key | — |
| `OPENAI_API_KEY` | OpenAI API Key | — |
| `GOOGLE_API_KEY` | Google AI API Key | — |

---

## 3. 配置

配置文件位于 `~/.yanclaw/config.json5`，JSON5 格式（支持注释）。首次运行自动创建。

### 核心结构

```json5
{
  // Gateway 设置
  "gateway": {
    "port": 18789,           // 监听端口
    "bind": "loopback",      // loopback（仅本机） | lan（局域网）
    "logging": {
      "level": "info",       // debug | info | warn | error
      "file": { "enabled": true, "maxSize": "10m", "maxFiles": 5 },
      "pretty": true
    }
  },

  // 模型提供商
  "models": {
    "providers": [
      {
        "type": "anthropic",
        "profiles": [{ "id": "main", "apiKey": "${ANTHROPIC_API_KEY}" }]
      }
    ]
  },

  // Agent 列表
  "agents": [
    {
      "id": "main",
      "name": "默认助手",
      "model": "claude-sonnet-4-20250514",
      "systemPrompt": "You are a helpful assistant."
    }
  ],

  // 通道、路由、工具策略、记忆、定时任务、安全...
  // 详见各模块文档
}
```

### 配置热重载

服务端通过 `fs.watch()` 监听配置文件变更，修改后自动生效。重载范围：

- 通道配置（重连适配器）
- 定时任务
- 模型列表
- 工具策略
- 路由规则

重载失败时保留旧配置并记录日志。

### 环境变量展开

配置中支持 `${ENV_VAR}` 语法引用环境变量：

```json5
{ "apiKey": "${ANTHROPIC_API_KEY}" }
```

### Vault 加密存储

敏感凭证可使用 AES-256-GCM 加密存储：

```json5
{ "apiKey": "$vault:anthropic_key" }
```

详见 [security-guide.md](security-guide.md)。

---

## 4. API 概览

### REST 端点

| 路径 | 说明 |
|------|------|
| `POST /api/chat/:agentId/:sessionKey` | 流式对话（SSE） |
| `GET/POST/PATCH/DELETE /api/agents` | Agent CRUD |
| `GET/POST/PATCH/DELETE /api/channels` | 通道管理 |
| `GET/DELETE /api/sessions` | 会话管理 |
| `GET/PATCH /api/config` | 配置读写 |
| `GET/POST/PATCH/DELETE /api/cron` | 定时任务 |
| `GET/POST/DELETE /api/routing` | 路由绑定 CRUD |
| `GET /api/routing/debug` | 路由调试 |
| `POST /api/media/upload` | 媒体上传 |
| `GET /api/media/:id` | 媒体访问 |
| `GET/POST/DELETE /api/memory` | 记忆操作 |
| `GET /api/models/status` | 模型故障转移状态 |
| `GET /api/plugins` | 插件列表 |
| `POST /api/task-loop` | 任务循环控制 |
| `GET /api/pim` | PIM 查询 |
| `GET /api/tools/metadata` | 工具元数据 |
| `GET /api/system/health` | 健康检查（免认证） |
| `GET /api/system/setup` | 是否需要初始设置 |
| `GET /api/system/errors` | 错误监控 |
| `GET /api/audit` | 审计日志 |

### 认证

所有 API（除 `health`）需 Bearer Token：

```
Authorization: Bearer <token>
```

Token 在启动时自动生成，存储于 `~/.yanclaw/auth.token`。

### WebSocket

```
ws://localhost:18789/api/ws?ticket=<one-time-ticket>
```

先通过 `POST /api/ws/ticket`（需 Bearer Token）获取一次性票据，30 秒有效。

WebSocket 上运行 JSON-RPC 2.0 协议，支持：
- `chat.send` / `chat.cancel` — 对话控制
- `approval.respond` — 工具审批
- 服务器推送：`chat.delta`、`chat.tool_call`、`chat.done`、`channel.status` 等

详见 [API.md](API.md)。

---

## 5. 日志

使用 Pino 结构化日志，输出到控制台（pretty 格式）和 `~/.yanclaw/logs/`（JSON 格式，自动轮转）。

### 模块日志器

```typescript
import { log } from "@yanclaw/server/logger";

log.gateway().info("Server started on port %d", port);
log.agent().warn({ agentId, sessionKey }, "Context budget exceeded");
log.channel().error({ error }, "Telegram connection failed");
log.security().info({ action: "vault.decrypt" }, "Credential loaded");
```

可用模块：`gateway`、`agent`、`channel`、`plugin`、`security`、`db`、`cron`、`mcp`。

### CorrelationId

每次 Agent 运行会生成唯一 `correlationId`，贯穿日志和工具调用链路，便于追踪。

---

## 6. 数据目录

```
~/.yanclaw/
├── config.json5       # 配置文件
├── auth.token         # Bearer Token
├── vault.json         # AES-256-GCM 加密凭证
├── data.db            # SQLite 数据库
├── logs/              # Pino 日志（自动轮转）
├── media/             # 媒体文件（按会话目录）
├── plugins/           # 用户安装的插件
├── workspace/         # Agent 工作目录
│   └── {agentId}/
└── server.log         # Tauri 子进程日志
```

---

## 7. 关键源码位置

| 模块 | 路径 |
|------|------|
| 入口 | `packages/server/src/index.ts` |
| 路由组合 | `packages/server/src/app.ts` |
| Gateway 初始化 | `packages/server/src/gateway.ts` |
| 配置 Schema | `packages/server/src/config/schema.ts` |
| 配置 Store | `packages/server/src/config/store.ts` |
| Agent 运行时 | `packages/server/src/agents/runtime.ts` |
| 工具注册 | `packages/server/src/agents/tools/index.ts` |
| 数据库 Schema | `packages/server/src/db/schema.ts` |
| 日志器 | `packages/server/src/logger.ts` |
