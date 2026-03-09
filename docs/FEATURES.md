# YanClaw 功能需求文档

## 概述

YanClaw 是一个本地优先的多通道 AI 助手桌面应用。用户在本机运行 Gateway 服务，通过统一界面与多个 AI 模型对话，并可将 AI 接入 Telegram/Discord/Slack 等消息通道，实现跨平台的智能助手体验。

---

## F1. Gateway 服务（核心）

### F1.1 HTTP + WebSocket 服务器

- 本地启动 Hono HTTP 服务器，默认端口 `18789`
- 内置 WebSocket 端点 `/api/ws`，用于前端实时通信（流式输出、状态推送）
- REST API 供前端和 CLI 调用
- 支持 CORS 配置（默认允许 `localhost:1420` Tauri 前端）

### F1.2 JSON-RPC 协议

- WebSocket 上运行 JSON-RPC 2.0 协议
- 支持请求/响应模式和服务器推送（通知模式）
- 方法分组：`chat.*`、`channels.*`、`agents.*`、`sessions.*`、`config.*`、`cron.*`、`system.*`

### F1.3 认证

- Gateway 启动时生成随机 auth token，存储在本地
- 所有 API 请求需携带 `Authorization: Bearer <token>`
- 前端通过 Tauri IPC 获取 token，无需用户手动输入

### F1.4 配置热重载

- 配置文件变更时自动检测并重新加载
- 重载范围：通道配置、Cron 任务、模型列表、工具策略
- 无需重启 Gateway 即可生效

---

## F2. AI Agent 运行时

### F2.1 多模型支持

- 通过 Vercel AI SDK 统一接口接入多模型：
  - Anthropic Claude (claude-sonnet-4, claude-opus-4 等)
  - OpenAI (gpt-4o, o1, o3 等)
  - Google Gemini (gemini-2.5-pro 等)
  - Ollama 本地模型
- 每个 Agent 可独立配置默认模型
- 运行时可切换模型

### F2.2 Agent 执行循环

- 接收用户消息 → 加载会话历史 → 调用模型 → 执行工具 → 返回结果
- 支持多轮工具调用（agentic loop）：模型可连续调用多个工具直到完成任务
- 流式输出：token 级别的实时推送到前端
- 上下文窗口管理：超出时自动压缩历史

### F2.3 模型故障转移

- 按优先级尝试多个 Auth Profile
- 遇到认证错误、限流、余额不足时自动切换到下一个
- 冷却机制：失败的 Profile 暂时冻结，定时恢复
- 最大重试次数限制

### F2.4 多 Agent 管理

- 支持创建多个独立 Agent，每个有独立的：
  - 工作目录
  - 系统提示词
  - 模型配置
  - 工具策略
  - 会话空间
- 默认 Agent 名为 `main`
- 通过路由规则将不同通道/用户绑定到不同 Agent

---

## F3. 工具系统

### F3.1 内置工具

| 工具 | 功能 | 风险等级 |
|------|------|----------|
| `shell` | 执行 Shell 命令 | 高 |
| `file_read` | 读取文件内容 | 低 |
| `file_write` | 写入/创建文件 | 中 |
| `file_edit` | 编辑文件（diff 方式） | 中 |
| `web_search` | 网络搜索 | 低 |
| `web_browser` | 浏览器自动化（Playwright） | 中 |
| `message` | 向消息通道发送消息 | 低 |

### F3.2 工具策略

- **全局策略**：默认允许/拒绝 + 白名单/黑名单
- **Agent 级策略**：覆盖全局策略
- **通道级策略**：特定通道可限制可用工具
- 策略合并顺序：全局 → Agent → 通道

### F3.3 执行审批

- 高风险工具（如 `shell`）可配置为需要用户审批
- 审批模式：
  - `off` — 不需要审批
  - `on-miss` — 不在白名单中时需审批
  - `always` — 每次都需审批
- 前端显示审批对话框，用户可查看命令详情后批准/拒绝
- 审批有超时机制（默认 5 分钟）

### F3.4 工具沙箱

- 可选 Docker 容器隔离执行
- 文件系统限制：仅允许访问工作目录
- 安全二进制白名单：`safeBins` 列表

---

## F4. 会话管理

### F4.1 会话结构

- 会话键格式：`agent:{agentId}:{scope}`
  - 主会话：`agent:main:main`
  - 按用户隔离：`agent:main:direct:{peerId}`
  - 按通道隔离：`agent:main:telegram:direct:{peerId}`
  - 群组会话：`agent:main:discord:group:{groupId}`
  - 话题会话：`{baseKey}:thread:{threadId}`

### F4.2 持久化

- SQLite 存储（bun:sqlite）
- 每个会话存储完整消息历史 + 工具调用记录
- 自动压缩：超出 token 预算时智能裁剪早期消息
- 会话元数据：创建时间、最后活跃时间、消息数、token 用量

### F4.3 会话操作

- 列出所有会话（分页）
- 查看会话详情（消息历史）
- 删除会话
- 导出会话（JSON）

---

## F5. 消息路由

### F5.1 路由规则

当消息从通道到达时，按以下优先级匹配路由：

1. **精确用户绑定** — 特定用户 → 特定 Agent
2. **群组/频道绑定** — 特定群组 → 特定 Agent
3. **通道默认绑定** — 某通道的所有消息 → 某 Agent
4. **全局默认** — 未匹配时使用默认 Agent

### F5.2 路由配置

```json5
{
  "routing": {
    "bindings": [
      { "channel": "telegram", "peer": "user_123", "agent": "work-agent" },
      { "channel": "discord", "guild": "guild_456", "agent": "game-agent" },
      { "channel": "slack", "agent": "main" }
    ],
    "default": "main"
  }
}
```

### F5.3 DM 策略

- `pairing` — 新用户需发送配对码才能对话（默认）
- `allowlist` — 仅允许列表中的用户
- `open` — 允许任何人

---

## F6. 消息通道

### F6.1 通道抽象层

所有通道实现统一接口：

```typescript
interface Channel {
  id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(target: Peer, content: MessageContent): Promise<void>;
  onMessage(handler: (msg: InboundMessage) => void): void;
  getStatus(): ChannelStatus;
}
```

### F6.2 Telegram

- 通过 grammY SDK 接入
- Bot Token 认证
- 支持私聊、群组、超级群组
- 支持 Markdown 格式消息
- 支持文件/图片/语音收发
- @提及触发（群组中需 @bot 才响应）
- 多 Bot 账号支持

### F6.3 Discord

- 通过 discord.js 接入
- Bot Token 认证
- 支持 DM、服务器频道、话题
- 支持 Embed 富文本
- 支持文件/图片附件
- 消息长度分片（>2000 字符自动拆分）
- 服务器级配置（不同服务器不同 Agent）
- 角色绑定路由

### F6.4 Slack

- 通过 @slack/bolt 接入
- Bot Token + App Token 认证
- 支持 DM、频道、话题
- 支持 Block Kit 富文本
- 支持文件上传
- 多 Workspace 支持
- 事件订阅模式

### F6.5 WebChat（内置）

- 内置 Web 聊天界面（即 Tauri 前端的 Chat 页面）
- 无需额外配置，直接可用
- 支持流式输出、Markdown 渲染、代码高亮

### F6.6 通道健康监控

- 定期探测通道连接状态
- 状态：`connected` | `disconnected` | `error` | `connecting`
- 前端实时显示通道状态指示灯
- 断线自动重连（指数退避）

---

## F7. 配置系统

### F7.1 配置文件

- 路径：`~/.yanclaw/config.json5`（JSON5 格式，支持注释）
- Zod schema 严格校验
- 首次运行自动创建默认配置

### F7.2 配置结构

```json5
{
  // Gateway 设置
  "gateway": {
    "port": 18789,
    "bind": "loopback",  // loopback | lan
    "auth": { "token": "auto-generated" }
  },

  // Agent 列表
  "agents": [
    {
      "id": "main",
      "name": "默认助手",
      "model": "claude-sonnet-4-20250514",
      "systemPrompt": "You are a helpful assistant.",
      "workspaceDir": "~/.yanclaw/workspace/main"
    }
  ],

  // 模型 API Keys
  "models": {
    "anthropic": { "apiKey": "sk-ant-..." },
    "openai": { "apiKey": "sk-..." },
    "google": { "apiKey": "..." }
  },

  // 通道配置
  "channels": {
    "telegram": { "enabled": true, "token": "bot_token" },
    "discord": { "enabled": false, "token": "" },
    "slack": { "enabled": false, "botToken": "", "appToken": "" }
  },

  // 路由
  "routing": {
    "bindings": [],
    "default": "main"
  },

  // 工具策略
  "tools": {
    "policy": { "default": "allow" },
    "exec": { "ask": "on-miss", "safeBins": ["ls", "cat", "grep"] }
  },

  // Cron 任务
  "cron": { "tasks": [] }
}
```

### F7.3 配置 API

- `GET /api/config` — 读取完整配置（脱敏）
- `PATCH /api/config` — 更新部分配置
- 通道 API Key 等敏感字段返回时遮蔽

---

## F8. 定时任务（Cron）

### F8.1 任务定义

```json5
{
  "id": "daily-summary",
  "agent": "main",
  "schedule": "0 9 * * *",       // 每天 9:00
  "prompt": "总结昨天的工作进展",
  "deliveryTargets": [
    { "channel": "telegram", "peer": "user_123" }
  ],
  "enabled": true
}
```

### F8.2 调度模式

- Cron 表达式：`"0 9 * * *"`
- 间隔模式：`{ "every": { "value": 30, "unit": "minutes" } }`
- 单次定时：`{ "at": "2025-03-15T09:00:00Z" }`

### F8.3 任务执行

- 到达时间点时，Gateway 自动触发 Agent 执行
- Agent 执行结果发送到配置的 `deliveryTargets`
- 支持发送到多个通道/用户
- 执行日志记录

### F8.4 任务管理 API

- `GET /api/cron` — 列出所有任务
- `POST /api/cron` — 创建任务
- `PATCH /api/cron/:id` — 更新任务
- `DELETE /api/cron/:id` — 删除任务
- `POST /api/cron/:id/run` — 立即执行一次

---

## F9. 媒体处理

### F9.1 支持类型

| 类型 | 格式 | 处理 |
|------|------|------|
| 图片 | PNG, JPEG, WebP, GIF | 缩放、格式转换 (sharp) |
| 音频 | WAV, MP3, M4A, WebM | 转码 (ffmpeg) |
| 文档 | PDF | 文本提取 |
| 视频 | MP4 | 关键帧提取 |

### F9.2 入站处理

1. 通道接收附件 → 下载到本地临时目录
2. MIME 类型检测 + 大小校验（默认上限 25MB）
3. 按类型处理（图片缩放、音频转码等）
4. 存储到 `~/.yanclaw/media/{sessionKey}/`
5. 传递给 Agent 作为上下文

### F9.3 出站处理

1. Agent 工具产生附件（截图、生成文件等）
2. Gateway 通过 `/media/:id` 端点提供访问
3. 通道适配器转换为平台格式并上传

### F9.4 清理

- 媒体文件 TTL：默认 7 天
- 后台定时清理过期文件
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

- **向量相似度搜索**：基于 cosine 距离的语义检索
- **全文搜索 (FTS)**：BM25 关键词匹配
- **混合排序**：融合两种结果，去重后返回

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

| 类型 | 用途 | 示例 |
|------|------|------|
| Channel | 新增消息通道 | Matrix, LINE, Feishu |
| Tool | 新增 Agent 工具 | 数据库查询, API 调用 |
| Provider | 新增模型提供商 | Azure, AWS Bedrock |
| Memory | 新增记忆后端 | Pinecone, Qdrant |
| Hook | 消息处理钩子 | 日志、过滤、翻译 |

### F11.2 插件 SDK

```typescript
import { definePlugin } from "@yanclaw/plugin-sdk";

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
    onGatewayStart: async (ctx) => { /* ... */ },
    onMessageInbound: async (msg) => { /* 可修改/过滤消息 */ },
    beforeToolCall: async (toolCall) => { /* 可拦截/修改工具调用 */ },
  }
});
```

### F11.3 插件加载

- 从 `plugins/` 目录自动发现
- 从 npm 安装：`bun add @yanclaw/plugin-xxx`
- Worker 线程隔离执行（可选）
- 配置文件中启用/禁用

---

## F12. 桌面应用（Tauri）

### F12.1 系统托盘

- 显示 Gateway 运行状态（绿色/红色指示灯）
- 托盘菜单：
  - 打开主窗口
  - 启动/停止 Gateway
  - 通道状态一览
  - 退出应用

### F12.2 主窗口

- **Chat 页面** — AI 对话界面
  - 流式 token 输出
  - Markdown 渲染 + 代码高亮
  - 工具调用展示（可展开查看详情）
  - 文件/图片拖拽发送
  - 会话切换

- **Channels 页面** — 通道管理
  - 通道列表 + 连接状态
  - 添加/配置/删除通道
  - 连接/断开操作

- **Settings 页面** — 设置面板
  - API Key 管理（Anthropic/OpenAI/Google）
  - 模型选择
  - Gateway 端口/绑定配置
  - 工具策略配置
  - 系统提示词编辑

- **Cron 页面** — 定时任务管理
  - 任务列表
  - 创建/编辑/删除任务
  - 立即执行

- **Sessions 页面** — 会话浏览
  - 会话列表（按通道/Agent/时间筛选）
  - 查看会话消息历史
  - 删除/导出会话

### F12.3 全局快捷键

- `Ctrl+Shift+Y` — 显示/隐藏主窗口
- 可自定义快捷键

### F12.4 自动更新

- Tauri updater 内置支持
- 检查更新 + 下载 + 安装（用户确认）

---

## F13. 安全模型

### F13.1 访问控制层级

```
1. Gateway 认证（Bearer Token）
   ↓
2. 通道 DM 策略（pairing / allowlist / open）
   ↓
3. 用户/群组白名单（allowFrom 列表）
   ↓
4. 工具策略（allow / deny / 需审批）
   ↓
5. 执行沙箱（Docker 隔离，可选）
```

### F13.2 敏感数据保护

- API Key 存储在本地配置文件，不上传
- 前端展示时遮蔽敏感字段
- 配置文件权限建议 `600`（仅用户可读写）

### F13.3 网络安全

- Gateway 默认绑定 `loopback`（仅本机可访问）
- 可选开放 LAN 访问（需显式配置）
- WebSocket 连接需认证

---

## F14. 引导设置（Onboarding）

### F14.1 首次启动

1. 检测无配置文件 → 进入引导流程
2. 选择 AI 模型提供商 + 输入 API Key
3. 可选：配置消息通道（可跳过，后续在 Settings 中添加）
4. 生成默认配置文件
5. 启动 Gateway

### F14.2 设置向导页面

- 前端提供可视化设置向导
- 分步引导：模型 → 通道 → 高级设置
- 支持跳过非必要步骤
- 配置完成后自动保存并启动

---

## 功能优先级

### P0 — MVP（Phase 1-2，4-6 周）

- [x] Gateway 服务器（Hono + WebSocket）
- [ ] 单 Agent 对话（Vercel AI SDK）
- [ ] 流式输出到前端
- [ ] SQLite 会话持久化
- [ ] 配置系统（Zod + JSON5）
- [ ] Tauri 桌面壳 + 系统托盘
- [ ] Chat 页面（React）
- [ ] Settings 页面（API Key 管理）
- [ ] 内置 WebChat 通道

### P1 — 核心功能（Phase 3，2-3 周）

- [ ] Shell 工具 + 文件工具
- [ ] 工具策略 + 执行审批
- [ ] Telegram 通道
- [ ] Discord 通道
- [ ] 消息路由（通道 → Agent）
- [ ] DM 策略（allowlist）
- [ ] Channels 页面

### P2 — 完善（Phase 4，2-4 周）

- [ ] 多 Agent 管理
- [ ] Slack 通道
- [ ] Cron 定时任务
- [ ] 向量记忆（sqlite-vec）
- [ ] 媒体管道（图片/PDF）
- [ ] 模型故障转移
- [ ] Sessions 页面

### P3 — 扩展（Phase 5+）

- [ ] 插件系统
- [ ] 浏览器自动化（Playwright）
- [ ] 全局快捷键
- [ ] 自动更新
- [ ] 更多通道（WhatsApp, Matrix, LINE...）
