# YanClaw 系统架构

> 本文档描述 YanClaw 的整体架构设计、模块划分和数据流。

---

## 1. 定位

YanClaw 是一个**本地优先、安全优先**的多通道 AI Agent 网关平台。用户在本机运行 Gateway 服务，通过统一界面与多个 AI 模型对话，并可将 AI 接入 Telegram / Discord / Slack / 飞书 等消息通道。桌面端基于 Tauri v2，运行时基于 Bun。

---

## 2. 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Bun（HTTP 服务 + SQLite + 工具执行） |
| 后端框架 | Hono（路由 + RPC 类型导出） |
| 数据库 | bun:sqlite（WAL 模式） + Drizzle ORM |
| AI SDK | Vercel AI SDK（streamText + 工具调用） |
| 前端 | React 19 + Vite + Tailwind CSS 4 |
| 桌面壳 | Tauri v2（Rust，系统托盘 + IPC + 自动更新） |
| 类型安全 | Hono RPC `hc<AppType>()` + Zod 校验 |
| 代码规范 | Biome（lint + format） |

---

## 3. 系统架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Tauri v2 Desktop Shell                         │
│  ┌──────────┐  ┌──────────────────────┐  ┌───────────────────────┐ │
│  │ 系统托盘  │  │  WebView (React 19)  │  │ 全局快捷键 / IPC     │ │
│  │ (Rust)   │  │  Vite + Tailwind     │  │ (Rust Commands)       │ │
│  └────┬─────┘  └──────────┬───────────┘  └───────────┬───────────┘ │
│       │                   │ Hono RPC                   │            │
│       └───────────────────┼────────────────────────────┘            │
│                           ↓                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              @yanclaw/server (Bun.serve)                     │   │
│  │                                                              │   │
│  │  ┌────────────────────────────────────────────────────┐     │   │
│  │  │              Hono Router + Middleware               │     │   │
│  │  │  /api/chat      → 流式对话（SSE）                  │     │   │
│  │  │  /api/agents    → Agent CRUD                       │     │   │
│  │  │  /api/channels  → 通道管理                         │     │   │
│  │  │  /api/sessions  → 会话管理                         │     │   │
│  │  │  /api/config    → 配置读写                         │     │   │
│  │  │  /api/routing   → 路由绑定 CRUD                    │     │   │
│  │  │  /api/ws        → WebSocket（JSON-RPC）            │     │   │
│  │  │  ...（25+ 端点）                                   │     │   │
│  │  └───────────────────────┬────────────────────────────┘     │   │
│  │                          │                                   │   │
│  │  ┌──────────┐  ┌────────┴────────┐  ┌───────────────────┐  │   │
│  │  │ Security │  │  AgentRuntime   │  │  ChannelManager   │  │   │
│  │  │ Layer    │  │                  │  │                    │  │   │
│  │  │ • Vault  │  │ • streamText    │  │ • Telegram(grammY)│  │   │
│  │  │ • Leak   │  │ • Tool Policy   │  │ • Discord(djs)    │  │   │
│  │  │ • Audit  │  │ • Approval      │  │ • Slack(bolt)     │  │   │
│  │  │ • Rate   │  │ • Compaction    │  │ • Feishu          │  │   │
│  │  │ • SSRF   │  │ • Usage Track   │  │ • WebChat         │  │   │
│  │  └──────────┘  └────────┬────────┘  └────────┬──────────┘  │   │
│  │                          │                     │             │   │
│  │  ┌──────────┐  ┌────────┴────────┐  ┌────────┴──────────┐  │   │
│  │  │ Plugin   │  │   Tool System   │  │  Routing Engine   │  │   │
│  │  │ Registry │  │ shell, file_*   │  │  8 级优先级绑定   │  │   │
│  │  │ • Hooks  │  │ web_*, browser  │  │  身份关联         │  │   │
│  │  │ • Tools  │  │ memory, pim     │  │  DM 策略          │  │   │
│  │  └──────────┘  └────────┬────────┘  └───────────────────┘  │   │
│  │                          │                                   │   │
│  │  ┌──────────┬────────────┼───────────┬──────────────────┐   │   │
│  │  │ SQLite   │ MemoryStore│ModelManager│  CronService    │   │   │
│  │  │ Sessions │ FTS5+Embed │ Failover  │  Heartbeat      │   │   │
│  │  │ Messages │ AutoIndex  │ Cooldown  │  Scheduler      │   │   │
│  │  │ PIM      │            │ Recovery  │                  │   │   │
│  │  └──────────┴────────────┴───────────┴──────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. 工作区结构

```
yanclaw/
├── packages/
│   ├── server/          # @yanclaw/server — Hono Gateway 后端
│   ├── web/             # @yanclaw/web — React 前端
│   └── shared/          # @yanclaw/shared — 共享类型和常量
├── plugins/             # 外部插件包目录
├── src-tauri/           # Tauri v2 Rust 桌面壳
├── docs/                # 文档（中文）
├── biome.json           # Biome 配置
├── bunfig.toml          # Bun workspace 配置
└── CLAUDE.md            # Claude Code 指引
```

**路径别名**：`@yanclaw/server/*`、`@yanclaw/web/*`、`@yanclaw/shared/*` 分别映射到各包的 `src/` 目录。

---

## 5. 模块依赖关系

```
ConfigStore ─────────────────────────────────┐
    │                                         │ onChange
    ├─→ ModelManager（提供商 + Profile 故障转移）│
    ├─→ ChannelManager（适配器注册 + 连接）    │
    ├─→ CronService（定时任务调度）            │
    ├─→ PluginRegistry（插件发现 + 加载）      │
    ├─→ SecurityModules（Vault、审计、限流...）│
    └─→ MemoryAutoIndexer（文件变更监听）      │
                                              │
GatewayContext ───── 全局单例 ─────────────────┘
    │
    ├─→ AgentRuntime.run() ← ChannelManager.onMessage()
    │                       ← CronService.execute()
    │                       ← TaskLoopController
    │
    ├─→ SessionStore ← AgentRuntime（会话持久化）
    ├─→ MemoryStore  ← AgentRuntime（记忆检索/存储）
    ├─→ PimStore     ← AgentRuntime（PIM 自动提取）
    ├─→ MediaStore   ← ChannelManager（附件处理）
    └─→ ErrorCollector ← 全局异常捕获
```

---

## 6. 启动序列

```
1. ConfigStore.load()           — 加载 JSON5 配置 + 环境变量展开 + Zod 校验
2. initLogger()                 — Pino 结构化日志（控制台 + 文件轮转）
3. initDatabase()               — SQLite 初始化 + Drizzle 迁移
4. initGateway()                — 创建 GatewayContext 单例
5. Bun.serve()                  — 启动 HTTP/WebSocket 服务
6. startMcp()                   — 初始化 MCP 客户端
7. startPlugins()               — 发现并加载插件
8. startChannels()              — 连接所有通道适配器
9. startCron()                  — 注册定时任务
10. startHeartbeats()           — 启动 Agent 心跳定时器
11. runSessionCleanup()         — 清理过期会话 + 媒体文件
12. startMemoryIndexer()        — 启动文件变更索引
13. config.onChange(hot-reload)  — 注册热重载回调
```

---

## 7. 核心数据流

### 7.1 消息处理流程

```
用户消息（通道/WebChat）
  │
  ├─→ ChannelManager.handleInbound()
  │     ├─→ DM 策略检查（pairing / allowlist / open）
  │     ├─→ 路由解析（resolveRoute → agentId + sessionKey）
  │     ├─→ 媒体附件提取（图片/文件/语音/视频）
  │     └─→ ownerOnly 检查
  │
  ├─→ AgentRuntime.run(agentId, sessionKey, message)
  │     ├─→ 加载会话历史（SessionStore）
  │     ├─→ 记忆预热（MemoryStore.search）
  │     ├─→ PIM 上下文注入（PimStore.query）
  │     ├─→ 构建系统提示词（SystemPromptBuilder）
  │     ├─→ 检查上下文窗口 → 超出预算自动压缩
  │     ├─→ 解析模型 + Profile（ModelManager）
  │     │
  │     ├─→ streamText({ model, messages, tools, maxSteps: 25 })
  │     │     ├─→ text-delta → 推送到前端/通道（block streaming 可选）
  │     │     ├─→ tool-call → 策略检查 → 审批 → 执行 → 重试
  │     │     └─→ finish → 保存会话 + 用量追踪
  │     │
  │     └─→ PIM 异步提取（fire-and-forget）
  │
  └─→ 响应发送到通道/前端
```

### 7.2 安全检查层级

```
1. Bearer Token 认证 + 自动轮转
2. WebSocket 票据认证（30s TTL）
3. 滑动窗口速率限制（全局/chat/approval）
4. DM 策略 + 白名单
5. 能力模型过滤（preset 或自定义能力数组）
6. 工具策略（allow/deny + 工具组，全局→Agent→通道三层）
7. ownerOnly 检查
8. 数据流启发式（shell 外泄 / 敏感路径检测）
9. 执行审批（safeBins / 用户确认）
10. 提示注入防御 + 凭证泄漏检测
11. 可选 Docker 沙箱隔离
```

---

## 8. 类型安全链路

```
Server 定义路由 (Hono + Zod)
  │
  ├─→ 导出 AppType
  │
  └─→ Web 导入 hc<AppType>()
        │
        └─→ 完整请求/响应类型推断，零配置
```

**示例**：

```typescript
// server: routes/agents.ts
const app = new Hono()
  .get("/", async (c) => { ... })
  .post("/", zValidator("json", createAgentSchema), async (c) => { ... });

export type AgentsRoute = typeof app;

// web: lib/api.ts
import type { AppType } from "@yanclaw/server/app";
const client = hc<AppType>(API_BASE);
// client.api.agents.$get() → 类型安全，自动补全
```

---

## 9. 数据存储

| 数据 | 存储位置 | 说明 |
|------|----------|------|
| 配置 | `~/.yanclaw/config.json5` | JSON5 格式，支持注释、环境变量、Vault 加密 |
| 数据库 | `~/.yanclaw/data.db` | SQLite WAL，Drizzle ORM |
| 认证 | `~/.yanclaw/auth.token` | Bearer Token，自动生成 |
| 凭证 | `~/.yanclaw/vault.json` | AES-256-GCM 加密存储 |
| 日志 | `~/.yanclaw/logs/` | Pino JSON 格式，自动轮转 |
| 媒体 | `~/.yanclaw/media/` | 按会话目录存储，TTL 清理 |
| 服务器日志 | `~/.yanclaw/server.log` | Tauri 子进程 stdout/stderr |
| 插件 | `~/.yanclaw/plugins/` | ESM 动态加载 |

---

## 10. 文档索引

| 文档 | 说明 |
|------|------|
| [SERVER.md](SERVER.md) | 服务端 Gateway 使用指南 |
| [CLI.md](CLI.md) | 命令行工具（yanclaw CLI） |
| [WEB.md](WEB.md) | Web 前端开发指南 |
| [DESKTOP.md](DESKTOP.md) | Tauri 桌面应用指南 |
| [API.md](API.md) | REST / WebSocket API 参考 |
| [DATABASE.md](DATABASE.md) | 数据库 Schema + Drizzle ORM |
| [FEATURES.md](FEATURES.md) | 功能需求文档 |
| [MODEL_SYSTEM.md](MODEL_SYSTEM.md) | 模型管理与故障转移 |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 开发环境搭建 |
| [security-guide.md](security-guide.md) | 安全配置指南 |
| [pim/README.md](pim/README.md) | PIM 个人信息管理 |
| [modules/channels.md](modules/channels.md) | 通道系统详解 |
| [modules/routing.md](modules/routing.md) | 消息路由引擎 |
| [modules/tools.md](modules/tools.md) | 工具系统与策略 |
| [modules/memory.md](modules/memory.md) | 记忆系统（FTS5 + 向量） |
| [modules/plugins.md](modules/plugins.md) | 插件系统 |
| [modules/cron.md](modules/cron.md) | 定时任务与心跳 |
| [CHANGELOG.md](CHANGELOG.md) | 版本更新日志 |
