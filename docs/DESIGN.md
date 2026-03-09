# YanClaw 系统设计文档

> 参考 OpenClaw 架构，使用 Bun + Hono + Tauri 技术栈重新实现

---

## 1. 系统架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Tauri v2 Desktop Shell                        │
│  ┌──────────┐  ┌────────────────────┐  ┌──────────────────────────┐  │
│  │ 系统托盘  │  │   WebView (React)   │  │   全局快捷键 / IPC      │  │
│  │ (Rust)   │  │   Vite + Tailwind   │  │   (Rust Commands)       │  │
│  └────┬─────┘  └─────────┬──────────┘  └───────────┬──────────────┘  │
│       │                  │ Hono RPC                  │                 │
│       └──────────────────┼───────────────────────────┘                 │
│                          ↓                                            │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │                  @yanclaw/server (Bun.serve)                    │   │
│  │                                                                 │   │
│  │  ┌─────────────────────────────────────────────────────────┐   │   │
│  │  │                    Hono Router Layer                      │   │   │
│  │  │  /api/chat     → ChatHandler    (SSE 流式)               │   │   │
│  │  │  /api/agents   → AgentHandler   (CRUD)                  │   │   │
│  │  │  /api/channels → ChannelHandler (CRUD + connect)         │   │   │
│  │  │  /api/sessions → SessionHandler (CRUD + export)          │   │   │
│  │  │  /api/config   → ConfigHandler  (GET + PATCH)            │   │   │
│  │  │  /api/cron     → CronHandler    (CRUD + run)             │   │   │
│  │  │  /api/media    → MediaHandler   (upload + serve)         │   │   │
│  │  │  /api/system   → SystemHandler  (health + status)        │   │   │
│  │  │  /api/ws       → WebSocket      (JSON-RPC 2.0)          │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  │           │                │                │                   │   │
│  │  ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────────────┐   │   │
│  │  │ Agent Runtime │ │  Channel Mgr │ │   Plugin Runtime    │   │   │
│  │  │               │ │              │ │                     │   │   │
│  │  │ ┌───────────┐ │ │ ┌──────────┐ │ │ ┌────────────────┐ │   │   │
│  │  │ │ Model Mgr │ │ │ │  Dock    │ │ │ │ Hook Runner    │ │   │   │
│  │  │ │ (AI SDK)  │ │ │ │ Registry │ │ │ │ Tool Registry  │ │   │   │
│  │  │ ├───────────┤ │ │ ├──────────┤ │ │ │ Service Host   │ │   │   │
│  │  │ │  Toolbox  │ │ │ │ Router   │ │ │ └────────────────┘ │   │   │
│  │  │ │ (内置工具) │ │ │ │ (路由)   │ │ │                     │   │   │
│  │  │ ├───────────┤ │ │ ├──────────┤ │ │                     │   │   │
│  │  │ │  Context  │ │ │ │ Session  │ │ │                     │   │   │
│  │  │ │  Manager  │ │ │ │  Key Mgr │ │ │                     │   │   │
│  │  │ └───────────┘ │ │ └──────────┘ │ │                     │   │   │
│  │  └───────────────┘ └──────────────┘ └─────────────────────┘   │   │
│  │           │                │                │                   │   │
│  │  ┌────────▼────────────────▼────────────────▼──────────────┐   │   │
│  │  │                   Storage Layer                          │   │   │
│  │  │  ┌──────────┐  ┌──────────┐  ┌────────────────────────┐ │   │   │
│  │  │  │ SessionDB│  │ ConfigFS │  │  Media / VectorDB      │ │   │   │
│  │  │  │(bun:sqlite)│ │(JSON5)  │  │ (sqlite-vec / FTS5)    │ │   │   │
│  │  │  └──────────┘  └──────────┘  └────────────────────────┘ │   │   │
│  │  └─────────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                          │                                            │
│  ┌───────────────────────▼────────────────────────────────────────┐   │
│  │                     通道适配器层                                 │   │
│  │  ┌─────────┐ ┌─────────┐ ┌───────┐ ┌─────────┐ ┌──────────┐  │   │
│  │  │Telegram │ │ Discord │ │ Slack │ │WebChat  │ │  更多... │  │   │
│  │  │(grammY) │ │(discord │ │(@slack│ │(内置WS) │ │ (插件)   │  │   │
│  │  │         │ │  .js)   │ │/bolt) │ │         │ │          │  │   │
│  │  └─────────┘ └─────────┘ └───────┘ └─────────┘ └──────────┘  │   │
│  └────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. 数据流设计

### 2.1 桌面端对话（流式）

```
用户在 Chat 页面输入消息
    ↓
React → api.api.chat.send.$post({ json: { agentId, sessionKey, message } })
    ↓
Hono ChatHandler
    ├─ 1. auth 中间件校验 Bearer Token
    ├─ 2. zValidator 校验请求体
    ├─ 3. 解析 sessionKey → 获取 agentId、channel、peer 信息
    ↓
AgentRuntime.run({ agentId, sessionKey, message })
    ├─ 4. SessionStore.load(sessionKey) → 加载会话历史
    ├─ 5. ContextManager.build() →
    │     ├─ 渲染 systemPrompt 模板
    │     ├─ 注入通道 capabilities 提示
    │     ├─ 注入可用工具列表 + schema
    │     ├─ 注入记忆上下文（如果有）
    │     └─ 合并历史 messages[] + 新消息
    ├─ 6. 上下文窗口检查 →
    │     ├─ 超出 → 自动压缩历史（保留系统消息 + 近期消息）
    │     └─ 未超出 → 继续
    ↓
    ├─ 7. ModelManager.resolve(agentConfig) → 选择模型 + 认证
    ├─ 8. 执行循环 (agentic loop)：
    │     ┌──────────────────────────────────────────────┐
    │     │ const result = streamText({                   │
    │     │   model, messages, tools, maxSteps            │
    │     │ })                                            │
    │     │                                               │
    │     │ for await (part of result.fullStream) {       │
    │     │   switch (part.type) {                        │
    │     │     case "text-delta":                        │
    │     │       → ws.send({ method: "chat.delta" })    │
    │     │     case "tool-call":                         │
    │     │       → PolicyEngine.check(toolName, args)    │
    │     │       → 需审批? ws.send approval_request     │
    │     │       → ToolEngine.execute(toolCall)          │
    │     │       → ws.send({ method: "chat.tool_result"})│
    │     │     case "finish":                            │
    │     │       → 无更多 tool_call? 结束循环            │
    │     │   }                                           │
    │     │ }                                             │
    │     └──────────────────────────────────────────────┘
    │
    ├─ 9. SessionStore.save(sessionKey, updatedMessages)
    └─ 10. ws.send({ method: "chat.done", usage })
```

### 2.2 通道消息入站（跨平台）

```
外部用户发送消息（如 Telegram）
    ↓
grammY Bot.on("message")
    ↓
ChannelAdapter.normalizeInbound(rawMessage) → InboundMessage
    {
      channel: "telegram",
      accountId: "bot_prod",           // 多 Bot 账号支持
      senderId: "tg_user_123",
      senderName: "Alice",
      peer: { kind: "direct", id: "tg_user_123" },
      text: "帮我查一下天气",
      attachments: [],
      replyTo: null,
      threadId: null,
      raw: ctx                         // grammY 原始上下文
    }
    ↓
ChannelManager.handleInbound(msg)
    ├─ 1. DM 策略检查
    │     ├─ "open"       → 放行
    │     ├─ "allowlist"  → 检查 allowFrom 列表（支持 ID/用户名匹配）
    │     └─ "pairing"    → 检查已配对列表 / 发送配对指引
    │
    ├─ 2. 路由解析 Router.resolveRoute(msg)
    │     ├─ 匹配优先级（参考 OpenClaw 绑定系统）：
    │     │   ① peer 精确绑定      → 特定用户 → 特定 Agent
    │     │   ② parentPeer 绑定    → 话题所属群组的绑定
    │     │   ③ guild + roles 绑定 → Discord 服务器 + 角色
    │     │   ④ guild 绑定         → Discord 服务器
    │     │   ⑤ team 绑定          → Slack Workspace
    │     │   ⑥ account 绑定       → 按 Bot 账号
    │     │   ⑦ channel 绑定       → 按通道类型
    │     │   ⑧ 全局默认           → default agent
    │     │
    │     ├─ 构建 sessionKey（参考 OpenClaw dmScope 模式）：
    │     │   dmScope = "main"                 → agent:{agentId}:main
    │     │   dmScope = "per-peer"             → agent:{agentId}:direct:{peerId}
    │     │   dmScope = "per-channel-peer"     → agent:{agentId}:{channel}:direct:{peerId}
    │     │   dmScope = "per-account-peer"     → agent:{agentId}:{channel}:{accountId}:direct:{peerId}
    │     │
    │     └─ identityLinks 跨平台身份合并：
    │         { "jane": ["slack:U123", "telegram:456"] }
    │         → 不同平台的消息路由到同一会话
    │
    ├─ 3. 附件处理
    │     ├─ 下载附件到 ~/.yanclaw/media/{sessionKey}/
    │     ├─ MIME 类型检测 + 大小校验（上限 25MB）
    │     └─ 图片缩放 / 音频转码（按需）
    │
    ├─ 4. AgentRuntime.run({ agentId, sessionKey, message, attachments })
    │     └─ （执行循环同 2.1）
    │
    └─ 5. 出站回复
          ├─ 文本分块（按通道限制）：
          │   Telegram: 4000 字符/块
          │   Discord:  2000 字符/块
          │   Slack:    4000 字符/块
          │   IRC:      350  字符/块
          ├─ Markdown → 通道原生格式转换
          └─ ChannelAdapter.send(peer, outboundMessage)
```

### 2.3 工具执行流（安全链）

```
模型返回 tool_call: { name: "shell", args: { command: "rm -rf /tmp/old" } }
    ↓
ToolEngine.execute(toolCall, context)
    ↓
┌─ 1. 工具存在性检查 ─────────────────────────────────┐
│  ToolRegistry.resolve(toolName)                      │
│  → 不存在? 返回 ToolInputError(400)                  │
└──────────────────────────────────────────────────────┘
    ↓
┌─ 2. 策略检查（三层合并）────────────────────────────┐
│  globalPolicy → agentPolicy → channelPolicy          │
│                                                       │
│  策略解析规则（参考 OpenClaw ToolPolicyLike）：        │
│  ┌─ deny 列表匹配? ──→ 拒绝（返回 "工具被策略禁止"）│
│  ├─ allow 列表为空?  ──→ 检查默认策略                │
│  ├─ allow 列表匹配? ──→ 通过                        │
│  └─ alsoAllow 列表?  ──→ 追加允许（不覆盖 deny）    │
│                                                       │
│  工具组展开（参考 OpenClaw group 概念）：              │
│  "group:web"     → ["web_search", "web_fetch"]       │
│  "group:file"    → ["file_read", "file_write", ...]  │
│  "group:plugins" → 所有插件注册的工具                 │
└──────────────────────────────────────────────────────┘
    ↓
┌─ 3. 所有者检查（ownerOnly 工具）────────────────────┐
│  某些工具仅 owner 可用（如 shell、file_write）        │
│  通道消息来源非 owner → 返回 ToolAuthorizationError   │
│  webchat 前端 → 视为 owner                           │
└──────────────────────────────────────────────────────┘
    ↓
┌─ 4. 审批检查 ─────────────────────────────────────────┐
│  exec.ask 配置：                                       │
│  "off"       → 直接执行                                │
│  "on-miss"   → 命令在 safeBins 中? 跳过 : 请求审批    │
│  "always"    → 每次都请求审批                          │
│                                                        │
│  审批流程（两阶段，参考 OpenClaw）：                    │
│  ① 注册审批请求 → ApprovalManager.register(request)   │
│  ② WebSocket 推送到前端 →                              │
│     { method: "approval.request", params: {            │
│       id, tool, args, timeout: 300                     │
│     }}                                                 │
│  ③ 等待用户响应（超时 5 分钟 → 自动拒绝）             │
│  ④ 记录审批决策到 approvals 表                         │
└────────────────────────────────────────────────────────┘
    ↓
┌─ 5. 执行 ─────────────────────────────────────────────┐
│  sandbox 配置：                                        │
│  sandbox = true   → Docker 容器执行                    │
│  sandbox = false  → Bun.spawn() 本地执行               │
│                                                        │
│  安全约束：                                            │
│  ├─ 超时: 30s（可配置）                                │
│  ├─ 输出截断: 10KB（保留上下文窗口空间）               │
│  ├─ 工作目录: 限制在 agent.workspaceDir 内             │
│  ├─ 路径安全: 文件工具不允许访问工作目录外             │
│  └─ SSRF 防护: web_fetch 工具阻止内网地址访问          │
└────────────────────────────────────────────────────────┘
    ↓
返回 ToolResult { content, details, exitCode? }
    → 追加到 messages → 模型决定下一步
```

---

## 3. 核心模块设计

### 3.1 Gateway 服务器

```
packages/server/src/
├── app.ts                        # Hono app 实例，组装路由，导出 AppType
├── index.ts                      # Bun.serve() 入口
│
├── routes/                       # Hono 路由模块（每个文件导出独立 Hono 实例）
│   ├── chat.ts                   # POST /send (SSE 流式), GET /stream
│   ├── agents.ts                 # CRUD
│   ├── channels.ts               # CRUD + connect/disconnect + health
│   ├── sessions.ts               # 列出/查看/删除/导出
│   ├── config.ts                 # GET (脱敏) / PATCH (深层合并)
│   ├── cron.ts                   # CRUD + run
│   ├── messages.ts               # 跨通道发送
│   ├── media.ts                  # upload + serve
│   ├── system.ts                 # health / status / version
│   └── ws.ts                     # WebSocket 升级 + JSON-RPC 分发
│
├── middleware/
│   ├── auth.ts                   # Bearer Token 校验
│   └── error.ts                  # 统一错误处理 + Zod 校验错误格式化
```

**路由组装模式**（参考 OpenClaw server-methods-list）：

```typescript
// app.ts
const apiRoutes = app
  .basePath("/api")
  .route("/chat", chatRoute)
  .route("/agents", agentsRoute)
  .route("/channels", channelsRoute)
  .route("/sessions", sessionsRoute)
  .route("/config", configRoute)
  .route("/cron", cronRoute)
  .route("/messages", messagesRoute)
  .route("/media", mediaRoute)
  .route("/system", systemRoute)
  .route("/ws", wsRoute);

export type AppType = typeof apiRoutes;
```

### 3.2 Agent Runtime

参考 OpenClaw 的 `pi-embedded-runner` 设计，实现完整的 Agent 执行循环。

```
packages/server/src/agents/
├── runtime.ts                    # 核心执行循环
├── context.ts                    # 上下文管理器
├── models.ts                     # 模型目录 + 选择 + 故障转移
├── policy.ts                     # 工具策略解析
│
├── tools/                        # 内置工具
│   ├── registry.ts               # 工具注册表 + 解析
│   ├── common.ts                 # 工具参数解析 + 错误类
│   ├── shell.ts                  # Shell 命令执行
│   ├── file.ts                   # 文件读/写/编辑
│   ├── web-search.ts             # 网络搜索
│   ├── web-fetch.ts              # 页面抓取（SSRF 防护）
│   ├── browser.ts                # 浏览器自动化 (Playwright)
│   └── message.ts                # 跨通道/跨会话消息发送
│
└── auth-profiles/                # 认证配置管理
    ├── resolver.ts               # 多 Profile 解析 + 优先级
    └── cooldown.ts               # 失败冷却 + 恢复
```

**执行循环设计**（参考 OpenClaw runEmbeddedAttempt）：

```typescript
// runtime.ts
class AgentRuntime {
  async *run(params: RunParams): AsyncGenerator<AgentEvent> {
    const { agentId, sessionKey, message, attachments } = params;
    const agent = this.agentStore.get(agentId);

    // 1. 加载会话
    const session = await this.sessionStore.load(sessionKey);

    // 2. 构建上下文
    const context = this.contextManager.build({
      agent,
      session,
      newMessage: message,
      attachments,
      channelCapabilities: this.getChannelCaps(sessionKey),
    });

    // 3. 上下文窗口检查 + 自动压缩
    if (context.tokenCount > agent.contextBudget) {
      await this.sessionStore.compact(sessionKey, agent.contextBudget);
      context.messages = await this.sessionStore.loadMessages(sessionKey);
    }

    // 4. 解析模型 + 认证
    const { model, profile } = await this.modelManager.resolve(agent);

    // 5. 工具解析（按策略过滤）
    const tools = this.toolRegistry.resolve(agentId, sessionKey);

    // 6. 流式执行循环
    let attempts = 0;
    const maxAttempts = 3 + this.modelManager.profileCount(agent) * 2;

    while (attempts < maxAttempts) {
      try {
        const result = streamText({
          model,
          messages: context.messages,
          tools,
          maxSteps: 25,  // 最大工具调用轮次
        });

        for await (const part of result.fullStream) {
          yield this.processStreamPart(part, sessionKey);
        }

        // 成功 → 保存会话 + 发送 done
        await this.sessionStore.save(sessionKey, context.messages);
        yield { type: "done", sessionKey, usage: result.usage };
        return;

      } catch (error) {
        // 故障转移
        const next = this.modelManager.failover(profile, error);
        if (next) {
          model = next.model;
          profile = next.profile;
          attempts++;
          continue;
        }
        yield { type: "error", sessionKey, message: error.message };
        return;
      }
    }
  }
}
```

**模型管理器**（参考 OpenClaw auth-profiles 系统）：

```typescript
// models.ts
class ModelManager {
  private catalog: ModelEntry[];
  private cooldowns: Map<string, number> = new Map();

  // 解析 Agent 配置的模型 + 认证信息
  resolve(agent: AgentConfig): { model: LanguageModel; profile: AuthProfile } {
    const profiles = this.resolveProfiles(agent);

    for (const profile of profiles) {
      // 跳过冷却中的 Profile
      if (this.isInCooldown(profile.id)) continue;

      try {
        const model = this.createModel(agent.model, profile);
        return { model, profile };
      } catch {
        this.setCooldown(profile.id, 60_000); // 冷却 1 分钟
      }
    }

    throw new Error("所有模型 Profile 均不可用");
  }

  // 故障转移：切换到下一个可用 Profile
  failover(current: AuthProfile, error: Error): { model; profile } | null {
    const isRetryable = this.isRetryableError(error);
    if (!isRetryable) return null;

    this.setCooldown(current.id, this.getCooldownDuration(error));
    return this.resolve(/* ... */);
  }

  // 错误分类：限流 → 短冷却，认证 → 长冷却，余额 → 永久冷却
  private getCooldownDuration(error: Error): number {
    if (isRateLimitError(error)) return 30_000;      // 30s
    if (isAuthError(error)) return 300_000;           // 5min
    if (isBillingError(error)) return Infinity;       // 永久
    return 60_000;                                     // 默认 1min
  }
}
```

**上下文管理器**（参考 OpenClaw 系统提示词构建）：

```typescript
// context.ts
class ContextManager {
  build(params: ContextBuildParams): ContextResult {
    const { agent, session, newMessage, channelCapabilities } = params;

    // 系统提示词模板渲染
    const systemParts: string[] = [agent.systemPrompt];

    // 注入通道能力提示（参考 OpenClaw channel capabilities hint）
    if (channelCapabilities) {
      systemParts.push(this.renderChannelHint(channelCapabilities));
    }

    // 注入可用工具描述
    const tools = this.toolRegistry.resolve(agent.id);
    if (tools.length > 0) {
      systemParts.push(this.renderToolsHint(tools));
    }

    // 注入记忆上下文
    const memories = this.memoryStore.search(newMessage, agent.id);
    if (memories.length > 0) {
      systemParts.push(this.renderMemoryHint(memories));
    }

    // 组装消息列表
    const messages = [
      { role: "system", content: systemParts.join("\n\n") },
      ...session.messages,
      { role: "user", content: newMessage },
    ];

    return { messages, tokenCount: this.countTokens(messages) };
  }
}
```

### 3.3 通道系统

参考 OpenClaw 的 Dock + Registry + Adapter 三层设计。

```
packages/server/src/channels/
├── types.ts                      # 通道核心类型定义
├── dock.ts                       # 通道能力注册表（参考 OpenClaw dock.ts）
├── registry.ts                   # 通道元数据 + 别名
├── manager.ts                    # 通道生命周期管理
├── health-monitor.ts             # 健康检查 + 自动重连
│
├── adapters/
│   ├── base.ts                   # 通道抽象基类
│   ├── telegram.ts               # Telegram (grammY)
│   ├── discord.ts                # Discord (discord.js)
│   ├── slack.ts                  # Slack (@slack/bolt)
│   └── webchat.ts                # 内置 WebChat（直通 WebSocket）
│
└── transport/
    ├── inbound.ts                # 入站消息标准化
    └── outbound.ts               # 出站消息格式化 + 分块
```

**通道能力系统**（参考 OpenClaw dock.ts）：

```typescript
// dock.ts — 每个通道的能力声明
interface ChannelCapabilities {
  chatTypes: ChatType[];              // ["direct", "group", "channel", "thread"]
  supportsPoll: boolean;              // 支持投票
  supportsReaction: boolean;          // 支持表情回应
  supportsMedia: boolean;             // 支持媒体附件
  supportsThread: boolean;            // 支持话题/线程
  supportsNativeCommands: boolean;    // 支持 /command 原生命令
  supportsMarkdown: boolean;          // 支持 Markdown 格式
  supportsEdit: boolean;              // 支持编辑已发送消息
  blockStreaming: boolean;            // 是否阻止流式推送（部分通道需要等完成后一次发送）
  maxTextLength: number;              // 单条消息最大字符数
  mentionStripPattern?: RegExp;       // @提及清理正则
}

const CHANNEL_DOCK: Record<string, ChannelCapabilities> = {
  telegram: {
    chatTypes: ["direct", "group", "channel"],
    supportsPoll: true,
    supportsReaction: true,
    supportsMedia: true,
    supportsThread: true,
    supportsNativeCommands: true,
    supportsMarkdown: true,
    supportsEdit: true,
    blockStreaming: false,
    maxTextLength: 4000,
  },
  discord: {
    chatTypes: ["direct", "group", "thread"],
    supportsPoll: false,
    supportsReaction: true,
    supportsMedia: true,
    supportsThread: true,
    supportsNativeCommands: true,
    supportsMarkdown: true,
    supportsEdit: true,
    blockStreaming: false,
    maxTextLength: 2000,
  },
  slack: {
    chatTypes: ["direct", "group", "thread"],
    supportsPoll: false,
    supportsReaction: true,
    supportsMedia: true,
    supportsThread: true,
    supportsNativeCommands: true,
    supportsMarkdown: true,   // Block Kit
    supportsEdit: true,
    blockStreaming: false,
    maxTextLength: 4000,
  },
  webchat: {
    chatTypes: ["direct"],
    supportsPoll: false,
    supportsReaction: false,
    supportsMedia: true,
    supportsThread: false,
    supportsNativeCommands: false,
    supportsMarkdown: true,
    supportsEdit: false,
    blockStreaming: false,
    maxTextLength: Infinity,
  },
};
```

**通道适配器接口**（参考 OpenClaw channel plugins 类型）：

```typescript
// adapters/base.ts
interface ChannelAdapter {
  readonly id: string;
  readonly type: ChannelType;
  readonly capabilities: ChannelCapabilities;
  status: ChannelStatus;

  connect(config: ChannelConfig): Promise<void>;
  disconnect(): Promise<void>;
  send(peer: Peer, content: OutboundMessage): Promise<string | null>;  // 返回消息 ID
  onMessage(handler: InboundHandler): Unsubscribe;
  healthCheck(): Promise<HealthResult>;
}

type Peer = {
  kind: ChatType;           // "direct" | "group" | "channel" | "thread"
  id: string;
  name?: string;
  threadId?: string;
  guildId?: string;         // Discord 服务器 ID
  teamId?: string;          // Slack Workspace ID
};

type InboundMessage = {
  channel: string;
  accountId: string;         // Bot 账号标识（多 Bot 支持）
  senderId: string;
  senderName: string;
  peer: Peer;
  text: string;
  attachments: Attachment[];
  replyTo?: string;
  threadId?: string;
  memberRoleIds?: string[];  // Discord 角色（用于路由）
  raw: unknown;              // 平台原始消息对象
};

type OutboundMessage = {
  text: string;
  attachments?: Attachment[];
  replyTo?: string;
  threadId?: string;
  format?: "markdown" | "plain";  // 根据通道能力选择
};
```

**通道管理器**（参考 OpenClaw server-channels.ts）：

```typescript
// manager.ts
class ChannelManager {
  private adapters: Map<string, ChannelAdapter> = new Map();
  private healthMonitor: ChannelHealthMonitor;
  private router: Router;

  // 从配置加载并初始化所有启用的通道
  async loadFromConfig(config: Config): Promise<void> {
    for (const [channelId, channelConfig] of Object.entries(config.channels)) {
      if (!channelConfig.enabled) continue;
      const adapter = this.createAdapter(channelConfig);
      adapter.onMessage((msg) => this.handleInbound(msg));
      this.adapters.set(channelId, adapter);
    }
  }

  // 配置热重载时调用
  async reload(newConfig: Config): Promise<void> {
    // 比较新旧配置，仅重连变更的通道
    // 新增通道 → connect
    // 删除通道 → disconnect
    // 配置变更 → disconnect + connect
  }

  // 入站消息处理
  private async handleInbound(msg: InboundMessage): Promise<void> {
    // 1. DM 策略检查
    const dmPolicy = this.router.checkDmPolicy(msg);
    if (dmPolicy === "denied") return;
    if (dmPolicy === "pairing-required") {
      await this.sendPairingGuide(msg);
      return;
    }

    // 2. 路由解析
    const route = this.router.resolveRoute(msg);
    if (!route) return;

    // 3. Agent 执行
    const events = this.agentRuntime.run({
      agentId: route.agentId,
      sessionKey: route.sessionKey,
      message: msg.text,
      attachments: msg.attachments,
    });

    // 4. 流式/阻塞回复
    const caps = CHANNEL_DOCK[msg.channel];
    let buffer = "";

    for await (const event of events) {
      if (event.type === "delta") {
        if (caps.blockStreaming) {
          buffer += event.text;  // 缓冲，等完成后一次发送
        } else {
          // 可选：实时编辑已发送消息（如 Telegram editMessageText）
          buffer += event.text;
        }
      } else if (event.type === "done") {
        // 按 maxTextLength 分块发送
        const chunks = this.chunkText(buffer, caps.maxTextLength);
        for (const chunk of chunks) {
          await this.adapters.get(msg.channel)!.send(msg.peer, {
            text: chunk,
            format: caps.supportsMarkdown ? "markdown" : "plain",
          });
        }
      }
    }
  }
}
```

### 3.4 路由系统

参考 OpenClaw 的 resolve-route.ts 和 session-key.ts 设计。

```
packages/server/src/routing/
├── router.ts                     # 路由引擎
├── session-key.ts                # 会话键构建 + 解析
├── bindings.ts                   # 绑定规则匹配
├── identity-links.ts             # 跨平台身份关联
└── dm-policy.ts                  # DM 策略检查
```

**路由引擎**（参考 OpenClaw resolveRoute）：

```typescript
// router.ts
class Router {
  resolveRoute(msg: InboundMessage): ResolvedRoute | null {
    const { channel, accountId, peer, memberRoleIds } = msg;

    // 1. 身份链接解析（跨平台用户合并）
    const resolvedPeerId = this.identityLinks.resolve(channel, msg.senderId);

    // 2. 绑定匹配（按优先级）
    const binding = this.matchBinding({
      channel,
      accountId,
      peer,
      guildId: peer.guildId,
      teamId: peer.teamId,
      memberRoleIds,
    });

    const agentId = binding?.agent ?? this.config.routing.default;

    // 3. 会话键构建
    const sessionKey = this.buildSessionKey({
      agentId,
      channel,
      accountId,
      peer: { ...peer, id: resolvedPeerId },
      dmScope: binding?.dmScope ?? this.config.routing.dmScope ?? "per-peer",
    });

    return {
      agentId,
      sessionKey,
      mainSessionKey: `agent:${agentId}:main`,
      matchedBy: binding?.type ?? "default",
    };
  }
}

// bindings.ts — 绑定规则定义
type Binding = {
  // 匹配条件（至少一个）
  channel?: string;          // 通道类型
  account?: string;          // Bot 账号
  peer?: string;             // 精确用户 ID
  guild?: string;            // Discord 服务器
  roles?: string[];          // Discord 角色（需全部匹配）
  team?: string;             // Slack Workspace
  group?: string;            // 群组 ID

  // 路由目标
  agent: string;             // 目标 Agent ID
  dmScope?: DmScope;         // 会话隔离模式覆盖

  // 元数据
  priority?: number;         // 优先级（越大越优先）
};

type DmScope = "main" | "per-peer" | "per-channel-peer" | "per-account-peer";
```

**会话键构建**（参考 OpenClaw session-key.ts）：

```typescript
// session-key.ts
function buildSessionKey(params: {
  agentId: string;
  channel: string;
  accountId?: string;
  peer: Peer;
  dmScope: DmScope;
}): string {
  const { agentId, channel, accountId, peer, dmScope } = params;
  const base = `agent:${agentId}`;

  switch (dmScope) {
    case "main":
      return `${base}:main`;

    case "per-peer":
      return `${base}:${peer.kind}:${peer.id}`;

    case "per-channel-peer":
      return `${base}:${channel}:${peer.kind}:${peer.id}`;

    case "per-account-peer":
      return `${base}:${channel}:${accountId ?? "default"}:${peer.kind}:${peer.id}`;
  }
}

// 线程会话：在基础键后追加 :thread:{threadId}
function appendThreadKey(baseKey: string, threadId: string): string {
  return `${baseKey}:thread:${threadId}`;
}

// 解析会话键
function parseSessionKey(key: string): ParsedSessionKey {
  const parts = key.split(":");
  return {
    agentId: parts[1],
    scope: parts.slice(2).join(":"),
    // ...
  };
}
```

### 3.5 配置系统

参考 OpenClaw 的 Zod schema + 热重载设计。

```
packages/server/src/config/
├── schema.ts                     # Zod Schema 定义（完整配置结构）
├── schema-agents.ts              # Agent 配置 schema
├── schema-channels.ts            # 通道配置 schema
├── schema-tools.ts               # 工具策略 schema
├── schema-models.ts              # 模型配置 schema
├── schema-routing.ts             # 路由配置 schema
├── store.ts                      # 配置读写 + 热重载
├── defaults.ts                   # 默认配置值
├── merge.ts                      # 深层合并 + 补丁
└── env.ts                        # 环境变量替换 ${VAR}
```

**配置 Schema 设计**（参考 OpenClaw 多文件 schema）：

```typescript
// schema.ts
import { z } from "zod";

export const configSchema = z.object({
  gateway: z.object({
    port: z.number().default(18789),
    bind: z.enum(["loopback", "lan"]).default("loopback"),
    auth: z.object({
      token: z.string().optional(),  // 空则自动生成
    }).default({}),
  }).default({}),

  agents: z.array(agentSchema).default([defaultAgentEntry]),

  models: modelsSchema.default({}),

  channels: channelsSchema.default({}),

  routing: routingSchema.default({
    bindings: [],
    default: "main",
    dmScope: "per-peer",
    identityLinks: {},
  }),

  tools: toolsSchema.default({
    policy: { default: "allow" },
    exec: { ask: "on-miss", safeBins: ["ls", "cat", "grep", "find", "echo", "date"] },
  }),

  cron: z.object({
    tasks: z.array(cronTaskSchema).default([]),
  }).default({}),

  session: z.object({
    contextBudget: z.number().default(100_000),  // Token 预算
    pruneAfterDays: z.number().default(90),       // 自动清理天数
  }).default({}),

  memory: z.object({
    enabled: z.boolean().default(false),
    embeddingModel: z.string().default("text-embedding-3-small"),
    autoIndex: z.boolean().default(true),
  }).default({}),
});

export type Config = z.infer<typeof configSchema>;
```

**配置热重载**（参考 OpenClaw config-reload.ts）：

```typescript
// store.ts
class ConfigStore {
  private config: Config;
  private watcher: FSWatcher | null = null;
  private listeners: Set<(config: Config) => void> = new Set();

  static async load(configPath?: string): Promise<ConfigStore> {
    const path = configPath ?? resolveConfigPath();
    const raw = await readJSON5(path);

    // 环境变量替换: ${ANTHROPIC_API_KEY} → 实际值
    const expanded = expandEnvVars(raw);

    // Zod 校验 + 默认值填充
    const config = configSchema.parse(expanded);

    const store = new ConfigStore(config, path);
    store.startWatcher();
    return store;
  }

  // 文件变更时自动重载
  private startWatcher(): void {
    this.watcher = fs.watch(this.path, async () => {
      try {
        const raw = await readJSON5(this.path);
        const expanded = expandEnvVars(raw);
        const newConfig = configSchema.parse(expanded);
        this.config = newConfig;

        for (const listener of this.listeners) {
          listener(newConfig);
        }
      } catch (err) {
        console.error("配置重载失败:", err);
        // 保留旧配置，不中断服务
      }
    });
  }

  // PATCH API：深层合并 + 回写文件
  async patch(partial: DeepPartial<Config>): Promise<void> {
    const merged = deepMerge(this.config, partial);
    const validated = configSchema.parse(merged);

    // 原子写入（先写临时文件，再 rename）
    await atomicWrite(this.path, JSON.stringify(validated, null, 2));
    this.config = validated;
  }
}
```

### 3.6 数据库模块

```
packages/server/src/db/
├── sqlite.ts                     # Database 初始化 + PRAGMA
├── migrations/                   # 版本化迁移文件
│   ├── 001_init.sql
│   ├── 002_vectors.sql
│   └── 003_cron.sql
├── migrator.ts                   # 迁移执行器
├── sessions.ts                   # 会话 CRUD
├── messages.ts                   # 消息 CRUD
├── approvals.ts                  # 审批记录
├── media.ts                      # 媒体文件元数据
└── vectors.ts                    # 向量检索 (sqlite-vec)
```

### 3.7 插件系统

参考 OpenClaw 的 discovery → loader → registry → hooks 四层设计。

```
packages/server/src/plugins/
├── types.ts                      # 插件接口定义
├── discovery.ts                  # 插件发现（plugins/ 目录 + node_modules）
├── loader.ts                     # 动态 import() 加载
├── registry.ts                   # 插件注册表（工具、通道、钩子）
├── hooks.ts                      # 钩子运行器
└── sdk.ts                        # definePlugin() 导出
```

**插件接口**（参考 OpenClaw plugin types）：

```typescript
// types.ts
interface PluginDefinition {
  id: string;
  name: string;
  version: string;

  // 注册内容
  tools?: ToolDefinition[];           // 自定义工具
  channels?: ChannelAdapterFactory[]; // 自定义通道
  hooks?: PluginHooks;                // 生命周期钩子
}

interface PluginHooks {
  onGatewayStart?: (ctx: GatewayContext) => Promise<void>;
  onGatewayStop?: () => Promise<void>;

  beforeModelResolve?: (params: ModelResolveParams) => Promise<ModelOverride | void>;
  beforeAgentStart?: (params: AgentStartParams) => Promise<void>;

  onMessageInbound?: (msg: InboundMessage) => Promise<InboundMessage | null>;  // null = 过滤
  onMessageOutbound?: (msg: OutboundMessage) => Promise<OutboundMessage>;

  beforeToolCall?: (call: ToolCall) => Promise<ToolCall | null>;  // null = 拦截
  afterToolCall?: (call: ToolCall, result: ToolResult) => Promise<ToolResult>;
}
```

**钩子运行器**（参考 OpenClaw hooks.ts）：

```typescript
// hooks.ts
class HookRunner {
  private plugins: PluginDefinition[] = [];

  // 按注册顺序依次执行钩子，支持修改和拦截
  async runMessageInbound(msg: InboundMessage): Promise<InboundMessage | null> {
    let current: InboundMessage | null = msg;

    for (const plugin of this.plugins) {
      if (!plugin.hooks?.onMessageInbound) continue;
      current = await plugin.hooks.onMessageInbound(current!);
      if (current === null) return null;  // 某个插件拦截了消息
    }

    return current;
  }
}
```

### 3.8 Cron 调度器

```
packages/server/src/cron/
├── service.ts                    # 调度器核心
├── parser.ts                     # Cron 表达式 + 间隔解析
└── types.ts                      # 类型定义
```

---

## 4. 前端设计

### 4.1 页面路由

```
/                → Chat         (默认 AI 对话)
/channels        → Channels     (通道管理)
/sessions        → Sessions     (会话列表)
/sessions/:key   → SessionDetail(会话详情)
/cron            → Cron         (定时任务)
/settings        → Settings     (全局设置)
/onboarding      → Onboarding   (首次引导)
```

### 4.2 状态管理

使用 Zustand 轻量状态管理：

```typescript
// stores/chat.ts
interface ChatStore {
  messages: Message[];
  isStreaming: boolean;
  currentSessionKey: string;
  currentAgentId: string;

  // Actions
  sendMessage(text: string): Promise<void>;
  cancelGeneration(): void;
  switchSession(key: string): void;
  switchAgent(agentId: string): void;
  clearMessages(): void;

  // WebSocket 事件处理
  handleDelta(text: string): void;
  handleToolCall(name: string, args: unknown): void;
  handleToolResult(name: string, result: unknown): void;
  handleDone(usage: Usage): void;
  handleError(message: string): void;
}

// stores/gateway.ts
interface GatewayStore {
  connected: boolean;
  channels: ChannelStatus[];
  agents: Agent[];
  ws: WebSocket | null;

  connect(): void;
  disconnect(): void;
  refreshChannels(): Promise<void>;
  refreshAgents(): Promise<void>;
}

// stores/approval.ts
interface ApprovalStore {
  pendingApprovals: ApprovalRequest[];

  handleRequest(request: ApprovalRequest): void;
  respond(id: string, approved: boolean): void;
}
```

### 4.3 WebSocket 事件协议

基于 JSON-RPC 2.0（参考 OpenClaw gateway client）：

```typescript
// 客户端 → 服务端（请求）
type ClientRequest =
  | { method: "chat.send"; params: { agentId: string; sessionKey: string; message: string } }
  | { method: "chat.cancel"; params: { sessionKey: string } }
  | { method: "approval.respond"; params: { id: string; approved: boolean } }
  | { method: "subscribe"; params: { topics: string[] } }
  | { method: "unsubscribe"; params: { topics: string[] } }

// 服务端 → 客户端（推送通知，无 id）
type ServerNotification =
  | { method: "chat.delta"; params: { sessionKey: string; text: string } }
  | { method: "chat.tool_call"; params: { sessionKey: string; name: string; args: unknown } }
  | { method: "chat.tool_result"; params: { sessionKey: string; name: string; result: unknown; duration: number } }
  | { method: "chat.done"; params: { sessionKey: string; usage: Usage } }
  | { method: "chat.error"; params: { sessionKey: string; message: string; code: string } }
  | { method: "approval.request"; params: { id: string; sessionKey: string; tool: string; args: unknown; timeout: number } }
  | { method: "channel.status"; params: { channelId: string; status: ChannelStatus } }
```

### 4.4 Hono RPC 集成

前端通过 `hc<AppType>` 调用所有 REST API，类型自动推导，零手写 fetch：

```typescript
// packages/web/src/lib/api.ts
import { hc } from "hono/client";
import type { AppType } from "@yanclaw/server/app";

export const api = hc<AppType>("http://localhost:18789", {
  headers: () => ({
    Authorization: `Bearer ${getToken()}`,
  }),
});

// 使用示例（完全类型安全）
const channels = await (await api.api.channels.$get()).json();
const agents = await (await api.api.agents.$get()).json();

await api.api.config.$patch({
  json: { models: { anthropic: { apiKey: "sk-ant-..." } } },
});
```

---

## 5. 文件存储布局

```
~/.yanclaw/
├── config.json5                  # 主配置文件（JSON5 格式，支持注释）
├── auth.token                    # Gateway 认证 token
├── data.db                       # SQLite 主数据库
├── data.db-wal                   # SQLite WAL 文件
│
├── workspace/                    # Agent 工作目录
│   ├── main/                     # 默认 Agent
│   └── {agentId}/                # 其他 Agent
│
├── media/                        # 媒体文件（TTL 7 天，后台自动清理）
│   └── {sessionKey}/
│       └── {mediaId}.{ext}
│
├── plugins/                      # 已安装插件
│   └── {pluginId}/
│
├── sessions/                     # 会话 transcript 归档（可选）
│   └── {sessionKey}.json
│
└── logs/                         # 运行日志
    └── gateway.log
```

---

## 6. 安全设计

### 6.1 认证流程

```
Tauri 启动
    ↓
Rust 侧读取 ~/.yanclaw/auth.token（不存在则生成 crypto random 32 字节 hex）
    ↓
启动 Bun Gateway 子进程（传入 token 环境变量）
    ↓
前端通过 Tauri IPC invoke("get_auth_token") 获取 token
    ↓
所有 HTTP/WS 请求添加 Authorization: Bearer {token}
    ↓
Hono auth 中间件校验
    ↓
免认证端点: GET /api/system/health
```

### 6.2 工具执行安全链

见 3.3 工具执行流。

### 6.3 通道访问控制

```
外部消息到达
    ↓
┌─ DM 策略检查（参考 OpenClaw dm-policy）──────────┐
│ policy == "open"        → 放行                    │
│ policy == "allowlist"   → 检查 allowFrom 列表     │
│   ├─ senderId 匹配?    → 放行                    │
│   ├─ senderName 匹配?  → 放行                    │
│   └─ 未匹配            → 静默丢弃                │
│ policy == "pairing"     → 检查已配对列表          │
│   ├─ 已配对            → 放行                    │
│   └─ 未配对            → 发送配对码指引消息       │
└───────────────────────────────────────────────────┘
```

### 6.4 网络安全

- Gateway 默认绑定 `loopback`（仅本机 127.0.0.1 可访问）
- 可选开放 LAN（`bind: "lan"` → 绑定 0.0.0.0，需显式配置）
- WebSocket 连接需认证
- web_fetch 工具 SSRF 防护（阻止 127.0.0.1、10.x、192.168.x 等内网地址）

---

## 7. 错误处理与重试

### 7.1 错误分类

| 类别 | 示例 | 处理方式 |
|------|------|----------|
| 用户错误 | 无效配置、缺少 API Key | 返回 400 + Zod 校验详情 |
| 认证错误 | Token 过期/无效 | 返回 401 |
| 模型错误 | API 限流、余额不足、超时 | 自动故障转移到下一个 Profile |
| 工具错误 | 命令执行失败、超时 | 返回错误信息给模型，模型决定下一步 |
| 通道错误 | Bot Token 无效、网络断开 | 标记 error 状态，后台指数退避重连 |
| 系统错误 | 数据库损坏、磁盘满 | 日志记录 + WebSocket 推送告警 |

### 7.2 重试策略（参考 OpenClaw 故障转移逻辑）

**模型调用**：
- 最大重试次数：3 基础 + 每个可用 Profile × 2
- 限流错误：指数退避 250ms → 1500ms
- 认证错误：立即切换 Profile
- 余额不足：永久冷却该 Profile
- 超载错误：指数退避，不切换 Profile

**通道重连**：
- 指数退避：5s → 10s → 30s → 60s → 最大 5min
- 健康探测间隔：30s
- 连续失败 5 次 → 标记 error 状态，停止自动重连

**工具执行**：
- 不重试（单次执行，超时 30s）
- 超时后返回 timeout 错误给模型
- 模型可选择重试或换用其他工具

---

## 8. 性能设计

### 8.1 关键指标

| 指标 | 目标值 |
|------|--------|
| Gateway 冷启动 | < 200ms（Bun 原生 TS） |
| API 响应（非 AI 调用） | < 50ms |
| 流式首 token 延迟 | < 500ms（取决于模型） |
| WebSocket 消息延迟 | < 10ms |
| 内存占用（空闲） | < 50MB |
| 内存占用（活跃对话） | < 150MB |

### 8.2 优化策略

- **bun:sqlite WAL 模式**：并发读写不阻塞
- **Prepared Statement 缓存**：`db.query()` 自动缓存编译结果
- **流式处理**：AI 响应不等待完成即开始推送到客户端/通道
- **批量写入**：会话结束后一次性事务写入所有消息
- **惰性加载**：通道 SDK 按需 `import()`（未启用的通道不加载依赖）
- **媒体流式传输**：大文件不全量加载到内存（Bun.file() 零拷贝）
- **工具结果截断**：超过 10KB 的工具输出自动截断，保留上下文窗口空间
- **会话压缩**：超出 token 预算时自动裁剪早期消息
