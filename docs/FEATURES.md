# YanClaw 功能需求文档

> 参考 OpenClaw 功能实现，使用 YanClaw 技术栈

## 概述

YanClaw 是一个本地优先的多通道 AI 助手桌面应用。用户在本机运行 Gateway 服务，通过统一界面与多个 AI 模型对话，并可将 AI 接入 Telegram/Discord/Slack 等消息通道，实现跨平台的智能助手体验。

---

## F1. Gateway 服务（核心）

### F1.1 HTTP + WebSocket 服务器

- Bun.serve() 启动，Hono 路由
- 默认端口 `18789`，支持配置
- REST API `/api/*` 供前端和 CLI 调用
- WebSocket `/api/ws` 实时通信（JSON-RPC 2.0）
- CORS 配置（默认允许 `localhost:1420` Tauri 前端）

### F1.2 JSON-RPC 2.0 协议

WebSocket 上运行标准 JSON-RPC 2.0 协议：

- **请求/响应模式**: 客户端发送带 `id` 的请求，服务端返回结果
- **服务器推送（通知模式）**: 服务端主动推送无 `id` 的事件

方法分组：

| 分组 | 方法 | 说明 |
|------|------|------|
| `chat.*` | send, cancel | 对话管理 |
| `approval.*` | respond | 工具审批 |
| `subscribe` | topics | 事件订阅 |

推送事件：

| 事件 | 说明 |
|------|------|
| `chat.delta` | 流式文本片段 |
| `chat.tool_call` | Agent 发起工具调用 |
| `chat.tool_result` | 工具执行结果 |
| `chat.done` | 回复完成 + Token 用量 |
| `chat.error` | 执行错误 |
| `approval.request` | 工具审批请求 |
| `channel.status` | 通道状态变更 |

### F1.3 认证

- Gateway 启动时生成随机 auth token（crypto random 32 字节 hex）
- 存储在 `~/.yanclaw/auth.token`
- 所有 API 请求需携带 `Authorization: Bearer <token>`
- 前端通过 Tauri IPC `invoke("get_auth_token")` 获取，无需用户手动输入
- 免认证端点：`GET /api/system/health`

### F1.4 配置热重载

- 使用 `fs.watch()` 监听配置文件变更
- 自动检测并重新加载
- 重载范围：通道配置、Cron 任务、模型列表、工具策略、路由规则
- 重载失败时保留旧配置，日志记录错误
- 无需重启 Gateway 即可生效

---

## F2. AI Agent 运行时

### F2.1 多模型支持

通过 Vercel AI SDK 统一接口接入：

| 提供商 | SDK 包 | 模型示例 |
|--------|--------|----------|
| Anthropic | `@ai-sdk/anthropic` | claude-sonnet-4, claude-opus-4 |
| OpenAI | `@ai-sdk/openai` | gpt-4o, o1, o3 |
| Google | `@ai-sdk/google` | gemini-2.5-pro |
| Ollama | `ollama-ai-provider` | llama3, codestral |

- 每个 Agent 可独立配置默认模型
- 运行时可切换模型
- 支持自定义 API Base URL（兼容 OpenAI 格式的第三方服务）

### F2.2 Agent 执行循环（Agentic Loop）

参考 OpenClaw 的 Pi embedded runner 设计：

```
接收消息
  ↓
加载会话历史 (SessionStore)
  ↓
构建上下文 (ContextManager)
  ├─ 系统提示词 + 通道能力提示 + 工具描述 + 记忆上下文
  ↓
检查上下文窗口
  ├─ 超出预算 → 自动压缩历史
  ↓
解析模型 + 认证 Profile (ModelManager)
  ↓
┌─ 流式执行循环 ─────────────────────────────────┐
│  streamText({ model, messages, tools, maxSteps }) │
│                                                    │
│  for await (part of result.fullStream) {           │
│    text-delta  → 推送到前端/通道                   │
│    tool-call   → 策略检查 → 审批 → 执行            │
│    tool-result → 追加到消息 → 继续循环             │
│    finish      → 无更多工具调用? 结束              │
│  }                                                  │
└────────────────────────────────────────────────────┘
  ↓
保存会话 (SessionStore)
  ↓
发送完成事件
```

**关键特性**：

- **maxSteps**: 最大工具调用轮次（默认 25），防止无限循环
- **流式输出**: token 级别实时推送
- **上下文窗口管理**: 超出 token 预算时自动压缩历史（保留系统消息 + 近期消息）
- **工具结果截断**: 超过 10KB 的输出自动截断

### F2.2b Claude Code Agent SDK 运行时

Agent 可选择使用 Claude Code Agent SDK 作为替代运行时：

- **配置**: `agentConfig.runtime = "claude-code"`
- **能力**: 内置 Read/Edit/Write/Bash/Glob/Grep 等工具，支持 MCP Server、子 Agent
- **权限模式**: `default` / `acceptEdits` / `bypassPermissions`
- **会话恢复**: 通过 SDK session ID 支持多轮对话（内存 Map 存储映射）
- **事件映射**: SDK 消息 → AgentEvent（delta/thinking/tool_call/tool_result/done/error）

```json5
{
  "agents": [{
    "id": "coder",
    "runtime": "claude-code",
    "claudeCode": {
      "allowedTools": ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
      "permissionMode": "acceptEdits",
      "maxTurns": 50,
      "mcpServers": {},
      "agents": {}
    }
  }]
}
```

### F2.3 认证 Profile + 模型故障转移

参考 OpenClaw auth-profiles 系统：

- **多 Profile 支持**: 同一模型可配置多个 API Key / 账号
- **优先级排序**: 按配置顺序依次尝试
- **自动故障转移**:
  - 限流错误 → 短冷却（30s），切换下一个 Profile
  - 认证错误 → 长冷却（5min），切换
  - 余额不足 → 永久冷却该 Profile
  - 超载错误 → 指数退避（250ms → 1500ms），不切换
- **冷却恢复**: 冷却期结束后自动恢复可用
- **最大重试**: 3 + 每个 Profile × 2 次

### F2.4 多 Agent 管理

- 支持创建多个独立 Agent，每个有独立的：
  - 工作目录 (`~/.yanclaw/workspace/{agentId}/`)
  - 系统提示词
  - 模型配置
  - 工具策略
  - 会话空间
- 默认 Agent 名为 `main`（不可删除）
- 通过路由绑定将不同通道/用户/群组/服务器路由到不同 Agent

---

## F3. 工具系统

### F3.1 内置工具

| 工具 | 功能 | 风险等级 | ownerOnly |
|------|------|----------|-----------|
| `shell` | 执行 Shell 命令（Bun.spawn） | 高 | 是 |
| `file_read` | 读取文件内容（支持行号范围） | 低 | 否 |
| `file_write` | 写入/创建文件 | 中 | 是 |
| `file_edit` | diff 编辑（old_string → new_string） | 中 | 是 |
| `web_search` | 网络搜索（Brave/Google API） | 低 | 否 |
| `web_fetch` | 抓取网页内容（SSRF 防护） | 低 | 否 |
| `browser` | 浏览器自动化（Playwright） | 中 | 是 |
| `message` | 向消息通道发送消息 | 低 | 否 |
| `memory_search` | 向量记忆检索 | 低 | 否 |
| `screenshot_desktop` | macOS 桌面截图（screencapture） | 中 | 是 |

### F3.2 工具策略系统

参考 OpenClaw ToolPolicyLike 设计，三层策略合并：

```
全局策略 → Agent 级策略 → 通道级策略
```

策略类型：

```typescript
type ToolPolicy = {
  default: "allow" | "deny";       // 默认行为
  allow?: string[];                 // 允许列表
  alsoAllow?: string[];             // 追加允许（不覆盖 deny）
  deny?: string[];                  // 拒绝列表（优先级最高）
};
```

**工具组**（参考 OpenClaw group 概念）：

| 组名 | 展开 |
|------|------|
| `group:web` | web_search, web_fetch |
| `group:file` | file_read, file_write, file_edit |
| `group:exec` | shell |
| `group:desktop` | screenshot_desktop |
| `group:plugins` | 所有插件注册的工具 |

配置示例：

```json5
{
  "tools": {
    "policy": { "default": "allow", "deny": ["browser"] },
    "byAgent": {
      "code-agent": { "allow": ["group:file", "group:exec"] }
    },
    "byChannel": {
      "telegram": { "deny": ["group:exec"], "allow": ["group:web", "message"] }
    }
  }
}
```

### F3.3 ownerOnly 工具

参考 OpenClaw ownerOnly 概念：

- 高风险工具（shell、file_write 等）标记为 `ownerOnly`
- **WebChat 前端**: 视为 owner，可使用所有工具
- **外部通道**: 默认不是 owner，不可使用 ownerOnly 工具
- 可通过通道配置覆盖：`"ownerIds": ["tg_user_123"]`

### F3.4 执行审批

参考 OpenClaw exec-approval-manager 两阶段设计：

- 审批模式：
  - `off` — 不需要审批，直接执行
  - `on-miss` — 不在 safeBins 白名单中时需审批
  - `always` — 每次都需审批
- **审批流程**:
  1. Agent 发起工具调用
  2. 策略检查通过 → 检查是否需要审批
  3. 需要审批 → 注册审批请求（生成 ID、设置超时）
  4. WebSocket 推送审批请求到前端
  5. 前端显示审批对话框（命令详情 + 批准/拒绝按钮）
  6. 用户操作 → WebSocket 回复审批决策
  7. 超时（默认 5 分钟）→ 自动拒绝
  8. 审批决策记录到 approvals 表

### F3.5 工具沙箱

- 可选 Docker 容器隔离执行
- 文件系统限制：仅允许访问 Agent 工作目录
- 安全二进制白名单：`safeBins` 列表
- web_fetch SSRF 防护：阻止内网地址（127.0.0.1、10.x、192.168.x、172.16-31.x）
- 工具输出截断：默认 10KB，防止上下文窗口溢出

---

## F4. 消息通道

### F4.1 通道抽象层

参考 OpenClaw dock + adapter 设计。每个通道声明自身能力：

```typescript
interface ChannelCapabilities {
  chatTypes: ("direct" | "group" | "channel" | "thread")[];
  supportsPoll: boolean;
  supportsReaction: boolean;
  supportsMedia: boolean;
  supportsThread: boolean;
  supportsNativeCommands: boolean;
  supportsMarkdown: boolean;
  supportsEdit: boolean;
  blockStreaming: boolean;
  maxTextLength: number;
}
```

### F4.2 通道能力对照表

| 能力 | Telegram | Discord | Slack | WebChat |
|------|----------|---------|-------|---------|
| 聊天类型 | direct, group, channel | direct, group, thread | direct, group, thread | direct |
| 投票 | 是 | 否 | 否 | 否 |
| 表情回应 | 是 | 是 | 是 | 否 |
| 媒体附件 | 是 | 是 | 是 | 是 |
| 话题/线程 | 是 | 是 | 是 | 否 |
| 原生命令 | 是 (/command) | 是 (/) | 是 (/) | 否 |
| Markdown | 是 | 是 | Block Kit | 是 |
| 编辑消息 | 是 | 是 | 是 | 否 |
| 单条上限 | 4000 字符 | 2000 字符 | 4000 字符 | 无限制 |
| 阻塞流式 | 否 | 否 | 否 | 否 |

### F4.3 Telegram

- SDK: grammY
- Bot Token 认证
- 支持私聊、群组、超级群组、频道
- 支持 Markdown 格式消息
- 支持文件/图片/语音/视频收发
- @提及触发（群组中需 @bot 才响应）
- 话题/Topics 支持（超级群组）
- 多 Bot 账号支持（不同 Bot → 不同 Agent）
- 原生 /command 支持

### F4.4 Discord

- SDK: discord.js
- Bot Token 认证
- 支持 DM、服务器频道、话题/线程
- 支持 Embed 富文本
- 支持文件/图片附件
- 消息长度分片（> 2000 字符自动拆分）
- 服务器级配置（不同服务器 → 不同 Agent）
- **角色绑定路由**（参考 OpenClaw guild+roles 绑定）：
  - 按 Discord 服务器 + 成员角色路由到不同 Agent
  - 配置示例：`{ "guild": "123", "roles": ["admin"], "agent": "admin-agent" }`

### F4.5 Slack

- SDK: @slack/bolt
- Bot Token + App Token 认证（Socket Mode）
- 支持 DM、频道、话题/线程
- 支持 Block Kit 富文本
- 支持文件上传
- 多 Workspace 支持（team 绑定）
- 事件订阅模式

### F4.6 WebChat（内置）

- 内置 Web 聊天界面（即 Tauri 前端的 Chat 页面）
- 无需额外配置，直接可用
- 流式 token 输出
- Markdown 渲染 + 代码高亮
- 工具调用展示（可展开查看详情）
- 文件/图片拖拽发送
- 视为 owner（可使用所有 ownerOnly 工具）

### F4.7 通道健康监控

参考 OpenClaw channel-health-monitor：

- 定期探测通道连接状态（间隔 30s）
- 状态：`connected` | `disconnected` | `error` | `connecting`
- 前端实时显示通道状态指示灯
- 断线自动重连（指数退避 5s → 10s → 30s → 60s → 最大 5min）
- 连续失败 5 次 → 停止自动重连，标记 error
- WebSocket 推送状态变更事件到前端

---

## F5. 消息路由

### F5.1 路由绑定系统

参考 OpenClaw resolve-route 绑定匹配优先级：

| 优先级 | 匹配类型 | 说明 | 示例 |
|--------|----------|------|------|
| 1 | peer | 精确用户 | 用户 Alice → code-agent |
| 2 | group | 精确群组 | 群组 ABC → team-agent |
| 3 | guild + roles | Discord 服务器+角色 | admin 角色 → admin-agent |
| 4 | guild | Discord 服务器 | 服务器 XYZ → game-agent |
| 5 | team | Slack Workspace | WS ABC → work-agent |
| 6 | account | Bot 账号 | bot_prod → main |
| 7 | channel | 通道类型 | telegram → main |
| 8 | default | 全局默认 | — → main |

### F5.2 路由配置

```json5
{
  "routing": {
    "default": "main",
    "dmScope": "per-peer",      // 全局 DM 会话隔离模式

    "bindings": [
      // 精确用户绑定
      { "channel": "telegram", "peer": "user_123", "agent": "work-agent" },

      // Discord 服务器 + 角色绑定
      { "guild": "guild_456", "roles": ["admin"], "agent": "admin-agent" },

      // Discord 服务器绑定
      { "guild": "guild_456", "agent": "game-agent" },

      // Slack Workspace 绑定
      { "team": "T123ABC", "agent": "work-agent" },

      // 通道默认
      { "channel": "slack", "agent": "main" },
    ],

    // 跨平台身份关联（参考 OpenClaw identityLinks）
    "identityLinks": {
      "jane": ["telegram:user_111", "slack:U222", "discord:333"],
      "bob": ["telegram:user_444", "discord:555"]
    }
  }
}
```

### F5.3 DM 会话隔离模式

参考 OpenClaw dmScope：

| 模式 | 会话键格式 | 说明 |
|------|-----------|------|
| `main` | `agent:{agentId}:main` | 所有 DM 共享一个会话 |
| `per-peer` | `agent:{agentId}:direct:{peerId}` | 每个用户独立会话（默认） |
| `per-channel-peer` | `agent:{agentId}:{channel}:direct:{peerId}` | 每个通道+用户独立会话 |
| `per-account-peer` | `agent:{agentId}:{channel}:{accountId}:direct:{peerId}` | 每个 Bot 账号+用户独立会话 |

- 群组会话键：`agent:{agentId}:{channel}:group:{groupId}`
- 话题追加：`{baseKey}:thread:{threadId}`

### F5.4 跨平台身份关联

参考 OpenClaw identityLinks：

- 配置 `identityLinks` 将不同平台的用户映射为同一身份
- 不同平台的消息路由到同一会话
- 示例：Jane 在 Telegram、Slack、Discord 都和同一个 Agent 聊天，共享历史

### F5.5 DM 策略

| 策略 | 说明 | 默认 |
|------|------|------|
| `pairing` | 新用户需发送配对码才能对话 | 是 |
| `allowlist` | 仅允许列表中的用户（支持 ID 和用户名匹配） | |
| `open` | 允许任何人 | |

---

## F6. 会话管理

### F6.1 会话结构

```typescript
interface Session {
  key: string;             // 会话键
  agentId: string;
  channel?: string;
  peerKind?: string;       // direct | group | channel | thread
  peerId?: string;
  peerName?: string;
  title?: string;          // 自动生成或用户设定
  messageCount: number;
  tokenCount: number;      // 累计 Token 用量
  createdAt: number;       // Unix ms
  updatedAt: number;
}
```

### F6.2 持久化（bun:sqlite）

- WAL 模式（并发读写不阻塞）
- 每个会话存储完整消息历史 + 工具调用记录
- 自动压缩：超出 token 预算时智能裁剪早期消息（保留系统消息）
- 批量写入：会话结束后一次性事务写入所有消息
- Prepared Statement 自动缓存

### F6.3 会话维护

参考 OpenClaw session maintenance：

- **自动清理**: 超过 `pruneAfterDays`（默认 90 天）的会话自动清理
- **上下文压缩**: 超过 `contextBudget`（默认 100K tokens）时自动压缩
- **归档**: 可选将完整 transcript 导出到 `~/.yanclaw/sessions/`

### F6.4 会话操作

- 列出所有会话（分页、按 Agent/通道/时间筛选）
- 查看会话详情（消息历史 + 工具调用记录）
- 删除会话（CASCADE 删除关联消息）
- 导出会话（JSON 格式）

---

## F7. 配置系统

### F7.1 配置文件

- 路径：`~/.yanclaw/config.json5`（JSON5 格式，支持注释）
- Zod schema 严格校验 + 默认值填充
- 环境变量替换：`${ANTHROPIC_API_KEY}` → 实际值
- 首次运行自动创建默认配置
- 原子写入（先写临时文件，再 rename）

### F7.2 配置结构

```json5
{
  // Gateway 设置
  "gateway": {
    "port": 18789,
    "bind": "loopback",   // loopback | lan
    "auth": { "token": "auto-generated" }
  },

  // Agent 列表
  "agents": [
    {
      "id": "main",
      "name": "默认助手",
      "model": "claude-sonnet-4-20250514",
      "systemPrompt": "You are a helpful assistant.",
      "workspaceDir": "~/.yanclaw/workspace/main",
      "tools": {
        // Agent 级工具策略覆盖
        "allow": ["group:file", "group:exec", "group:web"]
      }
    }
  ],

  // 模型 API Keys（支持多 Profile）
  "models": {
    "anthropic": {
      "profiles": [
        { "id": "primary", "apiKey": "${ANTHROPIC_API_KEY}" },
        { "id": "backup", "apiKey": "${ANTHROPIC_API_KEY_2}" }
      ]
    },
    "openai": {
      "profiles": [
        { "id": "default", "apiKey": "${OPENAI_API_KEY}" }
      ]
    },
    "google": {
      "profiles": [
        { "id": "default", "apiKey": "${GOOGLE_API_KEY}" }
      ]
    },
    "ollama": {
      "baseUrl": "http://localhost:11434"
    }
  },

  // 通道配置
  "channels": {
    "telegram": {
      "enabled": true,
      "accounts": [
        {
          "id": "bot_prod",
          "token": "${TELEGRAM_BOT_TOKEN}",
          "allowFrom": ["user_123", "user_456"],
          "dmPolicy": "allowlist"
        }
      ]
    },
    "discord": {
      "enabled": false,
      "accounts": [
        { "id": "bot_main", "token": "${DISCORD_BOT_TOKEN}" }
      ]
    },
    "slack": {
      "enabled": false,
      "accounts": [
        {
          "id": "workspace_main",
          "botToken": "${SLACK_BOT_TOKEN}",
          "appToken": "${SLACK_APP_TOKEN}"
        }
      ]
    }
  },

  // 路由
  "routing": {
    "default": "main",
    "dmScope": "per-peer",
    "bindings": [],
    "identityLinks": {}
  },

  // 工具策略
  "tools": {
    "policy": { "default": "allow" },
    "exec": {
      "ask": "on-miss",
      "safeBins": ["ls", "cat", "grep", "find", "echo", "date", "pwd", "wc"]
    },
    "byChannel": {}
  },

  // 定时任务
  "cron": { "tasks": [] },

  // 会话维护
  "session": {
    "contextBudget": 100000,
    "pruneAfterDays": 90
  },

  // 记忆系统
  "memory": {
    "enabled": false,
    "embeddingModel": "text-embedding-3-small"
  }
}
```

### F7.3 配置 API

- `GET /api/config` — 读取完整配置（API Key 等敏感字段遮蔽为 `***`）
- `PATCH /api/config` — 深层合并更新部分配置
- 配置变更后自动触发热重载

---

## F8. 定时任务（Cron）

### F8.1 任务定义

```json5
{
  "id": "daily-summary",
  "agent": "main",
  "schedule": "0 9 * * *",               // Cron 表达式
  "prompt": "总结昨天的工作进展",
  "deliveryTargets": [
    { "channel": "telegram", "peer": "user_123" },
    { "channel": "webchat" }              // 也推送到前端
  ],
  "enabled": true
}
```

### F8.2 调度模式

| 模式 | 格式 | 示例 |
|------|------|------|
| Cron 表达式 | `"0 9 * * *"` | 每天 9:00 |
| 间隔 | `{ "every": { "value": 30, "unit": "minutes" } }` | 每 30 分钟 |
| 单次定时 | `{ "at": "2025-03-15T09:00:00Z" }` | 一次性 |

### F8.3 任务执行

1. 到达时间点 → Gateway 自动触发
2. 调用 `AgentRuntime.run()` 执行
3. 收集 Agent 回复
4. 发送到配置的 `deliveryTargets`
5. 记录执行日志（last_run_at, last_result）
6. 计算下次执行时间

### F8.4 任务管理 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/cron | 列出所有任务 |
| POST | /api/cron | 创建任务 |
| PATCH | /api/cron/:id | 更新任务 |
| DELETE | /api/cron/:id | 删除任务 |
| POST | /api/cron/:id/run | 立即执行一次（不影响原调度） |

---

## F9. 媒体处理

### F9.1 支持类型

| 类型 | 格式 | 处理工具 | 上限 |
|------|------|----------|------|
| 图片 | PNG, JPEG, WebP, GIF | sharp | 25MB |
| 音频 | WAV, MP3, M4A, WebM | ffmpeg (Bun.spawn) | 25MB |
| 文档 | PDF | pdf-parse | 25MB |
| 视频 | MP4 | ffmpeg 关键帧提取 | 25MB |

### F9.2 入站处理

1. 通道接收附件 → 下载到 `~/.yanclaw/media/{sessionKey}/`
2. MIME 类型检测 + 大小校验
3. 按类型处理（图片缩放、音频转码、PDF 文本提取）
4. 传递给 Agent 作为上下文附件

### F9.3 出站处理

1. Agent 工具产生附件（截图、生成文件等）
2. Gateway 通过 `/api/media/:id` 端点提供访问
3. 通道适配器转换为平台格式并上传

### F9.4 清理

- 媒体文件 TTL：默认 7 天
- 后台定时清理过期文件（参考 OpenClaw resolveMediaCleanupTtlMs）
- 可配置保留策略

---

## F10. 记忆系统（向量检索）

### F10.1 嵌入存储

- SQLite + sqlite-vec 扩展实现本地向量存储
- 支持多种 Embedding 模型：
  - OpenAI `text-embedding-3-small`
  - Google `text-embedding-004`
  - Ollama 本地模型

### F10.2 混合搜索

- **向量相似度搜索**: 基于 cosine 距离的语义检索
- **全文搜索 (FTS5)**: BM25 关键词匹配
- **混合排序**: 融合两种结果，去重后返回

### F10.3 索引来源

- 工作目录文件（自动监听变更）
- 会话历史（对话记录索引）
- 手动添加的知识库文件

### F10.4 Agent 集成

- Agent 可通过 `memory_search` 工具主动检索记忆
- 会话开始时自动预热相关记忆
- 搜索结果作为上下文注入到系统提示词

---

## F11. 插件系统

### F11.1 插件类型

参考 OpenClaw 五类插件：

| 类型 | 用途 | 示例 |
|------|------|------|
| Channel | 新增消息通道 | Matrix, LINE, 飞书 |
| Tool | 新增 Agent 工具 | 数据库查询, API 调用 |
| Provider | 新增模型提供商 | Azure, AWS Bedrock |
| Memory | 新增记忆后端 | Pinecone, Qdrant |
| Hook | 消息处理钩子 | 日志、过滤、翻译 |

### F11.2 插件 SDK

```typescript
import { definePlugin } from "@yanclaw/plugin-sdk";
import { z } from "zod";

export default definePlugin({
  id: "my-plugin",
  name: "My Plugin",
  version: "1.0.0",

  // 注册新工具
  tools: [
    {
      name: "query_db",
      description: "查询数据库",
      parameters: z.object({ sql: z.string() }),
      execute: async ({ sql }) => { /* ... */ },
    }
  ],

  // 生命周期钩子
  hooks: {
    onGatewayStart: async (ctx) => { /* 初始化 */ },
    onGatewayStop: async () => { /* 清理 */ },
    onMessageInbound: async (msg) => { /* 可修改/过滤消息，返回 null 拦截 */ },
    beforeToolCall: async (call) => { /* 可拦截/修改工具调用 */ },
    afterToolCall: async (call, result) => { /* 后处理 */ },
  }
});
```

### F11.3 插件发现与加载

参考 OpenClaw discovery → loader → registry：

1. **发现**: 扫描 `plugins/` 目录 + `node_modules/@yanclaw/plugin-*`
2. **加载**: 动态 `import()` 加载插件入口
3. **注册**: 将工具、通道、钩子注册到全局 Registry
4. **隔离**: 可选 Worker 线程隔离执行（高风险插件）
5. **配置**: 配置文件中启用/禁用 + 传递插件参数

---

## F12. 桌面应用（Tauri v2）

### F12.1 系统托盘

- 显示 Gateway 运行状态（绿色/红色指示灯）
- 托盘菜单：打开主窗口、启动/停止 Gateway、通道状态一览、退出

### F12.2 主窗口页面

| 页面 | 功能 |
|------|------|
| Chat | AI 对话：流式输出、Markdown 渲染、代码高亮、工具调用展示、审批对话框、文件拖拽 |
| Channels | 通道管理：列表 + 状态灯、添加/配置/删除、连接/断开 |
| Sessions | 会话浏览：按通道/Agent/时间筛选、消息历史、删除/导出 |
| Cron | 定时任务：列表、创建/编辑/删除、立即执行 |
| Settings | 设置面板：API Key、模型选择、Gateway 配置、工具策略、系统提示词 |
| Onboarding | 首次引导：分步向导（模型 → 通道 → 高级设置） |

### F12.3 全局快捷键

- `Ctrl+Shift+Y` — 显示/隐藏主窗口
- 可自定义快捷键

### F12.4 Tauri IPC

```rust
// src-tauri/src/commands.rs
#[tauri::command]
async fn get_auth_token() -> Result<String, String> { /* 读取 token */ }

#[tauri::command]
async fn start_gateway(port: u16) -> Result<(), String> {
    // Bun.spawn() 启动 Gateway 子进程
}

#[tauri::command]
async fn stop_gateway() -> Result<(), String> { /* 终止子进程 */ }
```

### F12.5 自动更新

- Tauri updater 内置支持
- 检查更新 + 下载 + 安装（用户确认）

---

## F13. 安全模型

### F13.1 访问控制层级（纵深防御）

```
1. Gateway 认证（Bearer Token + 自动轮转）
   ↓
2. WebSocket 票据认证（一次性 30s ticket）
   ↓
3. 滑动窗口速率限制（全局/chat/approval 三级）
   ↓
4. 通道 DM 策略（pairing / allowlist / open）
   ↓
5. 用户/群组白名单（allowFrom 列表）
   ↓
6. 能力模型（preset 或自定义能力数组，per-agent）
   ↓
7. 工具策略（allow / deny + 工具组）
   ↓
8. ownerOnly 检查（高风险工具仅 owner 可用）
   ↓
9. 数据流启发式检查（shell 外泄 / 敏感路径检测）
   ↓
10. 执行审批（safeBins 白名单 / 用户审批）
    ↓
11. 执行沙箱（Docker 隔离，可选）
```

### F13.2 凭证加密存储（Vault）

- AES-256-GCM 加密所有 API Key
- 密钥通过 machine-id + scryptSync 派生（Windows 注册表 / macOS IOPlatformUUID / Linux dbus）
- 回退方案：生成随机 ID 持久化到 `~/.yanclaw/.machine-id`
- 配置语法 `$vault:key_name` 自动解引用
- CLI 迁移脚本 `vault-migrate.ts`

### F13.3 凭证泄漏检测（LeakDetector）

- 注册所有已知 API Key 的前缀（前 16 字符）
- 实时扫描 LLM 输出文本
- 命中立即阻断响应

### F13.4 WebSocket 票据认证

- `POST /api/ws/ticket` 签发一次性票据（需 Bearer Token）
- 票据 30 秒 TTL，使用后立即销毁
- 解决 WebSocket 无法携带 Authorization header 的问题

### F13.5 速率限制

- 滑动窗口算法，内存 Map 实现
- 三级限制：全局 60/min、chat 10/min、approval 30/min
- 优先使用 auth token 后缀做 key（防 IP 伪造）
- 定时清理过期条目

### F13.6 提示注入防御

- `<tool_result source="...">` 边界标记包裹所有工具返回
- 8 种注入模式正则检测（精确匹配避免误报）
- 系统提示安全后缀（SAFETY_SUFFIX）
- 可配置阻断或仅告警

### F13.7 数据流启发式（DataFlow）

- shell 外泄检测：curl/wget POST、nc/ncat/socat/rsync/scp/sftp/ssh
- 敏感路径写入检测：.bashrc/.profile/.zshrc/.env/.ssh/authorized_keys/crontab
- 敏感路径读取检测：.ssh/.env/passwd/shadow/.aws/.kube
- 可配置为阻断或仅告警

### F13.8 网络白名单（SSRF 防护）

- 私有地址阻断（127.x/10.x/172.16-31.x/192.168.x/::1/localhost）
- 端口豁免列表（如 Ollama 11434、Gateway self）
- Host 白名单支持通配符 `*.example.com`
- 集成到 web_fetch 工具

### F13.9 审计日志

- SQLite 缓冲写入（100ms 或 50 条触发 flush）
- 查询 API `GET /api/audit`（action/actor/时间范围筛选，分页）
- 自动按天数清理（默认 90 天）
- 安全关闭时 flush 残留缓冲

### F13.10 异常频率检测

- 每工具每会话滑动窗口（1 分钟）
- warn / critical 分级阈值（shell 10/20、file_write 30/50、其他 80/100）
- 可配置动作：log / pause / abort
- 定期清理过期计数、会话结束清理

### F13.11 Token 自动轮转

- 可配置轮转间隔（`intervalHours`）
- Grace period 内新旧 token 同时有效
- 先写文件再更新内存（写入失败不轮转）
- 轮转回调通知 Gateway 更新内存配置

### F13.12 能力模型（Capabilities）

- 四种预设：`safe-reader`（只读文件+记忆）、`researcher`（读+网络+记忆）、`developer`（读写+shell+网络+记忆）、`full-access`（全部）
- 自定义能力数组：`["fs:read", "net:http", "memory:read"]`
- Per-agent 配置，与 toolPolicy + ownerOnly 三层叠加过滤

### F13.13 Symlink 防护

- file_read / file_write / file_edit 使用 `realpath()` 二次校验
- 阻止符号链接逃逸 workspace 目录
- 文件不存在时回退到预解析检查（write 场景）

### F13.14 敏感数据保护

- 支持环境变量引用 `${VAR}`（避免明文写入配置文件）
- 支持 Vault 加密引用 `$vault:key_name`
- 前端 API 返回时遮蔽敏感字段
- Gateway 默认绑定 loopback

---

## F14. 引导设置（Onboarding）

### F14.1 首次启动流程

1. 检测无配置文件 → 进入引导流程
2. 选择 AI 模型提供商 + 输入 API Key
3. 可选：配置消息通道（可跳过）
4. 生成默认配置文件
5. 启动 Gateway

### F14.2 设置向导

- 前端提供可视化设置向导
- 分步引导：模型 → 通道 → 高级设置
- 支持跳过非必要步骤

---

## 未来规划

- [ ] 更多通道插件（Matrix, LINE, WhatsApp...）
- [ ] 多用户协作模式
- [ ] 知识库管理增强（web 抓取 + 自动摘要）
