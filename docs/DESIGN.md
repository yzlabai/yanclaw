# YanClaw 功能设计文档

## 1. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Tauri v2 Desktop Shell                  │
│  ┌──────────┐  ┌───────────────────┐  ┌──────────────────┐  │
│  │ 系统托盘  │  │   WebView (React)  │  │   全局快捷键     │  │
│  │ (Rust)   │  │   Vite + Tailwind  │  │   (Rust)        │  │
│  └────┬─────┘  └────────┬──────────┘  └────────┬─────────┘  │
│       │                 │ Hono RPC               │           │
│       └─────────────────┼────────────────────────┘           │
│                         ↓                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              @yanclaw/server (Bun)                     │   │
│  │                                                        │   │
│  │  ┌──────────────────────────────────────────────────┐  │   │
│  │  │                 Hono Router                       │  │   │
│  │  │  /api/chat    → ChatHandler                      │  │   │
│  │  │  /api/channels → ChannelHandler                  │  │   │
│  │  │  /api/agents  → AgentHandler                     │  │   │
│  │  │  /api/config  → ConfigHandler                    │  │   │
│  │  │  /api/cron    → CronHandler                      │  │   │
│  │  │  /api/ws      → WebSocket (JSON-RPC)             │  │   │
│  │  └──────────────────────────────────────────────────┘  │   │
│  │                         │                              │   │
│  │  ┌──────────┐  ┌───────▼──────┐  ┌──────────────┐    │   │
│  │  │ Channel  │  │    Agent     │  │   Plugin     │    │   │
│  │  │ Manager  │  │   Runtime    │  │   Runtime    │    │   │
│  │  └────┬─────┘  └───────┬──────┘  └──────────────┘    │   │
│  │       │                │                              │   │
│  │  ┌────▼────┐  ┌────────▼───────┐  ┌──────────────┐   │   │
│  │  │ Router  │  │  Tool Engine   │  │  Session DB  │   │   │
│  │  │ (路由)  │  │  (工具执行)     │  │  (bun:sqlite) │   │   │
│  │  └─────────┘  └────────────────┘  └──────────────┘   │   │
│  └──────────────────────────────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────▼──────────────────────────────┐    │
│  │                   消息通道层                          │    │
│  │  ┌────────┐ ┌────────┐ ┌──────┐ ┌────────┐         │    │
│  │  │Telegram│ │Discord │ │Slack │ │WebChat │  ...     │    │
│  │  │(grammY)│ │(.js)   │ │(bolt)│ │(内置)   │         │    │
│  │  └────────┘ └────────┘ └──────┘ └────────┘         │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. 数据流设计

### 2.1 用户在桌面端对话

```
用户输入文本
    ↓
React Chat 页面
    ↓ POST /api/chat/send { agentId, message, sessionKey }
Hono Router
    ↓
ChatHandler
    ├── 1. 从 SessionDB 加载会话历史
    ├── 2. 构建 messages[] (系统提示 + 历史 + 新消息)
    ├── 3. 调用 AI SDK streamText()
    ├── 4. 流式推送到 WebSocket
    │       ↓ ws.send({ type: "delta", text: "..." })
    │       ↓ ws.send({ type: "tool_call", name: "shell", args: {...} })
    │       ↓ ws.send({ type: "tool_result", result: "..." })
    │       ↓ ws.send({ type: "done" })
    └── 5. 保存完整回复到 SessionDB
```

### 2.2 通道消息入站

```
Telegram 用户发送消息
    ↓
grammY Bot.on("message")
    ↓
ChannelManager.handleInbound({
    channel: "telegram",
    senderId: "tg_user_123",
    senderName: "Alice",
    peer: { kind: "direct", id: "tg_user_123" },
    text: "帮我查一下天气",
    attachments: []
})
    ↓
Router.resolveRoute(inbound)
    ├── 匹配路由规则 → agentId = "main"
    ├── 构建 sessionKey = "agent:main:telegram:direct:tg_user_123"
    └── 检查 DM 策略 (allowlist/pairing)
    ↓
AgentRuntime.run({ agentId, sessionKey, message })
    ├── 加载会话
    ├── 调用模型
    ├── 执行工具（如 web_search）
    └── 生成回复
    ↓
ChannelManager.sendOutbound({
    channel: "telegram",
    peer: { kind: "direct", id: "tg_user_123" },
    text: "北京今天晴，25°C...",
})
    ↓
grammY bot.api.sendMessage(chatId, text)
```

### 2.3 工具执行流

```
模型返回 tool_call: { name: "shell", args: { command: "ls -la" } }
    ↓
ToolEngine.execute(toolCall)
    ↓
1. 策略检查
    ├── 全局策略: shell → allow
    ├── Agent 策略: 无覆盖
    └── 通道策略: 无覆盖
    ↓
2. 审批检查 (exec.ask = "on-miss")
    ├── safeBins 包含 "ls" → 跳过审批
    └── (如果是 rm 等) → WebSocket 推送审批请求到前端
        ├── 用户批准 → 继续
        └── 用户拒绝 → 返回 "命令被用户拒绝"
    ↓
3. 执行
    ├── (沙箱模式) Docker exec
    └── (本地模式) Bun.spawn(["bash", "-c", command])
    ↓
4. 返回结果给模型
    { output: "total 32\ndrwxr-xr-x ...", exitCode: 0 }
```

---

## 3. 模块详细设计

### 3.1 Hono 路由模块设计

```
packages/server/src/
├── app.ts                    # Hono app 实例，组装路由，导出 AppType
├── index.ts                  # Bun.serve() 入口
│
├── routes/
│   ├── chat.ts               # POST /send, GET /stream
│   ├── channels.ts           # CRUD + connect/disconnect
│   ├── agents.ts             # CRUD + 模型配置
│   ├── sessions.ts           # 列出/查看/删除会话
│   ├── config.ts             # GET/PATCH 配置
│   ├── cron.ts               # CRUD + run
│   ├── messages.ts           # 发送消息到通道
│   ├── media.ts              # 媒体文件服务
│   ├── system.ts             # 健康检查/版本/状态
│   └── ws.ts                 # WebSocket 升级 + JSON-RPC
│
├── middleware/
│   ├── auth.ts               # Bearer Token 校验
│   └── error.ts              # 统一错误处理
```

### 3.2 Agent Runtime 模块设计

```
packages/server/src/agents/
├── runtime.ts                # 核心执行循环
│   │
│   │  AgentRuntime {
│   │    async run(params: RunParams): AsyncIterable<AgentEvent> {
│   │      1. loadSession(sessionKey)
│   │      2. buildMessages(session, newMessage)
│   │      3. resolveModel(agentConfig)
│   │      4. loop {
│   │           result = await streamText({ model, messages, tools })
│   │           for await (delta of result) yield delta
│   │           if (result.toolCalls.length > 0) {
│   │             results = await executeTools(result.toolCalls)
│   │             messages.push(...toolCallMessages, ...toolResultMessages)
│   │             continue  // 下一轮
│   │           }
│   │           break  // 无工具调用，结束
│   │         }
│   │      5. saveSession(sessionKey, messages)
│   │    }
│   │  }
│   │
├── models.ts                 # 模型目录 + 选择 + 故障转移
│   │  ModelManager {
│   │    catalog: ModelEntry[]
│   │    resolve(agentId): { model, provider, profile }
│   │    failover(currentProfile, error): nextProfile | null
│   │    cooldown(profile, duration): void
│   │  }
│   │
├── tools/
│   ├── index.ts              # 工具注册表
│   │   ToolRegistry {
│   │     register(tool: ToolDefinition): void
│   │     resolve(agentId, channelId?): Tool[]  // 按策略过滤
│   │     execute(call: ToolCall): Promise<ToolResult>
│   │   }
│   │
│   ├── shell.ts              # Shell 命令执行
│   │   - Bun.spawn() 封装
│   │   - 超时控制 (默认 30s)
│   │   - 输出截断 (默认 10KB)
│   │   - 工作目录限制
│   │
│   ├── file.ts               # 文件读写
│   │   - read: 读取文件内容（支持行号范围）
│   │   - write: 写入/创建文件
│   │   - edit: diff 方式编辑（old_string → new_string）
│   │   - 路径安全校验（不允许访问工作目录外）
│   │
│   ├── web-search.ts         # 网络搜索
│   │   - 调用搜索 API (Brave/Google/etc.)
│   │   - 返回格式化的搜索结果
│   │
│   ├── browser.ts            # 浏览器自动化
│   │   - Playwright 控制
│   │   - 页面导航、元素交互、截图
│   │
│   └── message.ts            # 发送消息到通道
│       - 路由到指定通道
│       - 支持 @ 提及、回复
│
├── context.ts                # Agent 上下文管理
│   │  - 系统提示词模板渲染
│   │  - 工具描述注入
│   │  - 记忆上下文注入
│   │
└── policy.ts                 # 工具策略解析
    │  resolvePolicy(globalPolicy, agentPolicy, channelPolicy): EffectivePolicy
    │  checkApproval(toolName, args, policy): "allow" | "deny" | "ask"
```

### 3.3 Channel Manager 设计

```
packages/server/src/channels/
├── base.ts                   # 通道抽象接口
│   │
│   │  interface ChannelAdapter {
│   │    readonly id: string;
│   │    readonly status: ChannelStatus;
│   │    connect(config: ChannelConfig): Promise<void>;
│   │    disconnect(): Promise<void>;
│   │    send(peer: Peer, content: OutboundMessage): Promise<void>;
│   │    onMessage(handler: InboundHandler): Unsubscribe;
│   │    healthCheck(): Promise<HealthResult>;
│   │  }
│   │
│   │  type Peer = {
│   │    kind: "direct" | "group" | "channel";
│   │    id: string;
│   │    name?: string;
│   │    threadId?: string;
│   │  }
│   │
│   │  type InboundMessage = {
│   │    channel: string;
│   │    senderId: string;
│   │    senderName: string;
│   │    peer: Peer;
│   │    text: string;
│   │    attachments: Attachment[];
│   │    replyTo?: string;
│   │    raw: unknown;  // 平台原始消息
│   │  }
│   │
│   │  type OutboundMessage = {
│   │    text: string;
│   │    attachments?: Attachment[];
│   │    replyTo?: string;
│   │    threadId?: string;
│   │  }
│   │
├── manager.ts                # 通道生命周期管理
│   │  ChannelManager {
│   │    private adapters: Map<string, ChannelAdapter>
│   │    private router: Router
│   │
│   │    async loadFromConfig(config): void
│   │    async connect(channelId): void
│   │    async disconnect(channelId): void
│   │    getStatus(): ChannelStatus[]
│   │
│   │    // 入站消息处理
│   │    private handleInbound(msg: InboundMessage) {
│   │      const route = this.router.resolve(msg)
│   │      if (!route) return  // DM 策略拒绝
│   │      const events = agentRuntime.run(route)
│   │      for await (const event of events) {
│   │        if (event.type === "text") {
│   │          await this.send(msg.channel, msg.peer, { text: event.text })
│   │        }
│   │      }
│   │    }
│   │  }
│   │
├── telegram.ts               # Telegram 适配器
├── discord.ts                # Discord 适配器
├── slack.ts                  # Slack 适配器
└── webchat.ts                # 内置 WebChat（直通前端 WebSocket）
```

### 3.4 路由模块设计

```
packages/server/src/routing/
├── router.ts                 # 路由引擎
│   │
│   │  class Router {
│   │    private bindings: Binding[]
│   │    private dmPolicies: Map<string, DmPolicy>
│   │    private allowlists: Map<string, string[]>
│   │
│   │    resolve(msg: InboundMessage): ResolvedRoute | null {
│   │      // 1. DM 策略检查
│   │      if (!this.checkDmPolicy(msg)) return null
│   │
│   │      // 2. 白名单检查
│   │      if (!this.checkAllowlist(msg)) return null
│   │
│   │      // 3. 按优先级匹配绑定规则
│   │      const binding = this.matchBinding(msg)
│   │      const agentId = binding?.agent ?? this.defaultAgent
│   │
│   │      // 4. 构建会话键
│   │      const sessionKey = this.buildSessionKey(agentId, msg)
│   │
│   │      return { agentId, sessionKey }
│   │    }
│   │  }
│   │
│   │  type Binding = {
│   │    channel?: string
│   │    peer?: string          // 精确用户绑定
│   │    guild?: string         // Discord 服务器
│   │    group?: string         // 群组
│   │    agent: string
│   │    priority?: number
│   │  }
│   │
│   │  type ResolvedRoute = {
│   │    agentId: string
│   │    sessionKey: string
│   │  }
│   │
├── session-key.ts            # 会话键构建
│   │  buildSessionKey(agentId, msg): string
│   │  parseSessionKey(key): { agentId, scope, peerId?, channelId? }
│   │
└── allowlist.ts              # 白名单匹配
    │  checkAllowlist(senderId, senderName, list): boolean
```

### 3.5 配置模块设计

```
packages/server/src/config/
├── schema.ts                 # Zod Schema 定义
│   │
│   │  export const configSchema = z.object({
│   │    gateway: z.object({
│   │      port: z.number().default(18789),
│   │      bind: z.enum(["loopback", "lan"]).default("loopback"),
│   │      auth: z.object({ token: z.string() }),
│   │    }),
│   │    agents: z.array(agentSchema).default([defaultAgent]),
│   │    models: modelsSchema,
│   │    channels: channelsSchema,
│   │    routing: routingSchema,
│   │    tools: toolsSchema,
│   │    cron: cronSchema,
│   │  })
│   │
│   │  export type Config = z.infer<typeof configSchema>
│   │
├── store.ts                  # 配置读写 + 热重载
│   │  class ConfigStore {
│   │    private config: Config
│   │    private watcher: FSWatcher | null
│   │
│   │    static async load(path?: string): ConfigStore
│   │    get(): Config
│   │    async update(patch: DeepPartial<Config>): void
│   │    onChange(handler: (config: Config) => void): Unsubscribe
│   │
│   │    private async reload(): void  // 文件变更时触发
│   │    private validate(raw: unknown): Config  // Zod 校验
│   │    private persist(): void  // 写回文件
│   │  }
│   │
└── defaults.ts               # 默认配置值
```

### 3.6 数据库模块设计

```
packages/server/src/db/
├── sqlite.ts                 # 数据库初始化
│   │
│   │  import { Database } from "bun:sqlite"
│   │
│   │  export function createDatabase(path: string): Database {
│   │    const db = new Database(path)
│   │    db.exec("PRAGMA journal_mode=WAL")
│   │    db.exec("PRAGMA foreign_keys=ON")
│   │    runMigrations(db)
│   │    return db
│   │  }
│   │
├── migrations.ts             # Schema 迁移
│   │  CREATE TABLE sessions (...)
│   │  CREATE TABLE messages (...)
│   │  CREATE TABLE cron_jobs (...)
│   │  CREATE TABLE media_files (...)
│   │  CREATE TABLE approvals (...)
│   │
├── sessions.ts               # 会话 CRUD
│   │  class SessionStore {
│   │    list(filter?: SessionFilter): Session[]
│   │    get(sessionKey: string): Session | null
│   │    upsert(sessionKey: string, messages: Message[]): void
│   │    delete(sessionKey: string): void
│   │    compact(sessionKey: string, maxTokens: number): void
│   │  }
│   │
└── vectors.ts                # 向量检索
    │  class VectorStore {
    │    // 需要 sqlite-vec 扩展
    │    index(chunks: TextChunk[], embeddings: number[][]): void
    │    search(query: number[], topK: number): SearchResult[]
    │    deleteBySource(sourceId: string): void
    │  }
```

### 3.7 Cron 模块设计

```
packages/server/src/cron/
├── service.ts                # 调度器
│   │  class CronService {
│   │    private jobs: Map<string, CronJob>
│   │    private timers: Map<string, Timer>
│   │
│   │    start(): void          // 启动所有已启用任务的定时器
│   │    stop(): void           // 停止所有定时器
│   │    add(job: CronJobCreate): CronJob
│   │    update(id: string, patch): CronJob
│   │    remove(id: string): void
│   │    runNow(id: string): Promise<void>  // 立即执行
│   │    list(): CronJob[]
│   │
│   │    private schedule(job: CronJob): void {
│   │      // 解析 schedule → 计算下次执行时间 → setTimeout
│   │    }
│   │
│   │    private async execute(job: CronJob): void {
│   │      // 1. 调用 AgentRuntime.run()
│   │      // 2. 收集回复
│   │      // 3. 发送到 deliveryTargets
│   │    }
│   │  }
│   │
├── parser.ts                 # Cron 表达式解析
│   │  parseCronExpression(expr: string): NextDate
│   │  parseInterval(interval: { value, unit }): milliseconds
│   │
└── types.ts                  # Cron 类型定义
```

---

## 4. 前端设计

### 4.1 页面路由

```
/                → Chat (默认)
/channels        → Channels
/settings        → Settings
/cron            → Cron
/sessions        → Sessions
/sessions/:key   → SessionDetail
```

### 4.2 状态管理

使用 `zustand` 轻量状态管理：

```typescript
// stores/chat.ts
interface ChatStore {
  messages: Message[];
  isStreaming: boolean;
  currentSession: string;

  sendMessage(text: string): Promise<void>;
  switchSession(key: string): void;
  clearMessages(): void;
}

// stores/gateway.ts
interface GatewayStore {
  connected: boolean;
  channels: ChannelStatus[];
  ws: WebSocket | null;

  connect(): void;
  disconnect(): void;
}
```

### 4.3 WebSocket 事件协议

```typescript
// 服务端 → 客户端
type ServerEvent =
  | { type: "delta"; sessionKey: string; text: string }
  | { type: "tool_call"; sessionKey: string; name: string; args: unknown }
  | { type: "tool_result"; sessionKey: string; name: string; result: unknown }
  | { type: "done"; sessionKey: string }
  | { type: "error"; sessionKey: string; message: string }
  | { type: "approval_request"; id: string; command: string; timeout: number }
  | { type: "channel_status"; channel: string; status: ChannelStatus }

// 客户端 → 服务端
type ClientEvent =
  | { type: "chat.send"; agentId: string; sessionKey: string; message: string }
  | { type: "approval.respond"; id: string; approved: boolean }
  | { type: "subscribe"; topics: string[] }
```

### 4.4 Hono RPC 集成

前端通过 `hc<AppType>` 调用所有 REST API，类型自动推导：

```typescript
// packages/web/src/lib/api.ts
import { hc } from "hono/client";
import type { AppType } from "@yanclaw/server/app";

export const api = hc<AppType>("http://localhost:18789");

// 使用示例（完全类型安全）
const res = await api.api.channels.$get();
const channels = await res.json();  // 类型自动推导

const res2 = await api.api.config.$patch({
  json: { models: { anthropic: { apiKey: "sk-..." } } }
});
```

---

## 5. 文件存储布局

```
~/.yanclaw/
├── config.json5              # 主配置文件
├── auth.token                # Gateway 认证 token
├── data.db                   # SQLite 主数据库
│
├── workspace/                # Agent 工作目录
│   ├── main/                 # 默认 Agent 的工作目录
│   └── {agentId}/
│
├── media/                    # 媒体文件临时存储
│   └── {sessionKey}/
│       └── {mediaId}.{ext}
│
├── plugins/                  # 已安装插件
│   └── {pluginId}/
│
└── logs/                     # 运行日志
    └── gateway.log
```

---

## 6. 安全设计

### 6.1 认证流程

```
Tauri 启动
    ↓
读取 ~/.yanclaw/auth.token（不存在则生成）
    ↓
启动 Bun Gateway 子进程（传入 token）
    ↓
前端通过 Tauri IPC 获取 token
    ↓
所有 HTTP 请求添加 Authorization: Bearer {token}
    ↓
Hono auth 中间件校验 → 401 Unauthorized 或放行
```

### 6.2 工具执行安全链

```
模型请求执行工具
    ↓
ToolRegistry.execute()
    ↓
┌─ 策略检查 ────────────────────────────────────┐
│ 1. 工具名是否在全局 deny list?     → 拒绝     │
│ 2. Agent 级策略是否禁止?           → 拒绝     │
│ 3. 通道级策略是否禁止?             → 拒绝     │
└────────────────────────────────────────────────┘
    ↓ 通过
┌─ 审批检查 ────────────────────────────────────┐
│ exec.ask == "off"?                 → 直接执行  │
│ 命令在 safeBins 中?                → 直接执行  │
│ exec.ask == "always" 或 "on-miss"? → 请求审批  │
│    ↓                                           │
│   WebSocket 推送审批请求到前端                  │
│   前端显示对话框（命令详情 + 批准/拒绝）        │
│   等待响应（5分钟超时 → 自动拒绝）              │
└────────────────────────────────────────────────┘
    ↓ 批准
┌─ 执行 ────────────────────────────────────────┐
│ sandbox = true?  → Docker 容器执行             │
│ sandbox = false? → Bun.spawn() 本地执行        │
│ 超时: 30s（可配置）                             │
│ 输出截断: 10KB（可配置）                        │
└────────────────────────────────────────────────┘
```

### 6.3 通道访问控制

```
外部消息到达
    ↓
┌─ DM 策略检查 ─────────────────────────────────┐
│ policy == "open"?       → 放行                 │
│ policy == "allowlist"?  → 检查 allowFrom 列表  │
│ policy == "pairing"?    → 检查已配对列表        │
│                           未配对 → 发送配对指引  │
└────────────────────────────────────────────────┘
    ↓ 通过
┌─ 白名单检查 ──────────────────────────────────┐
│ allowFrom 为空?  → 允许所有（通道级）          │
│ senderId 在列表? → 放行                       │
│ senderName 在列表? → 放行                     │
│ 否则 → 静默丢弃                               │
└────────────────────────────────────────────────┘
```

---

## 7. 错误处理设计

### 7.1 错误分类

| 类别 | 示例 | 处理方式 |
|------|------|----------|
| 用户错误 | 无效配置、缺少 API Key | 返回 400 + 友好提示 |
| 认证错误 | Token 过期/无效 | 返回 401 + 要求重新认证 |
| 模型错误 | API 限流、余额不足 | 自动故障转移 → 无可用模型时通知用户 |
| 通道错误 | Bot Token 无效、网络断开 | 标记通道状态为 error，后台重连 |
| 工具错误 | 命令执行失败、超时 | 返回错误信息给模型，模型决定下一步 |
| 系统错误 | 数据库损坏、磁盘满 | 日志记录 + 通知用户 |

### 7.2 重试策略

- 模型调用：最多重试 3 次，指数退避（1s, 2s, 4s）
- 通道重连：指数退避（5s, 10s, 30s, 60s, 最大 5min）
- 工具执行：不重试（由模型决定是否重试）

---

## 8. 性能设计

### 8.1 关键指标

| 指标 | 目标值 |
|------|--------|
| Gateway 冷启动 | < 200ms |
| API 响应（非 AI 调用） | < 50ms |
| 流式首 token 延迟 | < 500ms（取决于模型） |
| WebSocket 消息延迟 | < 10ms |
| 内存占用（空闲） | < 50MB |
| 内存占用（活跃对话） | < 150MB |

### 8.2 优化策略

- **bun:sqlite WAL 模式**：并发读写不阻塞
- **流式处理**：AI 响应不等待完成即开始推送
- **惰性加载**：通道 SDK 按需加载（未启用的通道不加载依赖）
- **消息批量存储**：会话结束后一次性写入，避免频繁 IO
- **媒体流式传输**：大文件不全量加载到内存
