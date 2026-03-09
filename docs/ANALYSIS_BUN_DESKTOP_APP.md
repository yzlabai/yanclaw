# YanClaw — 基于 OpenClaw 的 Bun 桌面本地应用实现分析

> **项目名称：YanClaw** — 致敬 OpenClaw 的本地 AI 助手桌面应用重实现

## 一、OpenClaw 项目概览

OpenClaw 是一个**本地优先的多通道 AI 助手平台**，核心功能包括：

- **Gateway 控制平面**：本地 WebSocket 服务器，编排所有消息路由、Agent 调度、工具执行
- **23+ 消息通道集成**：Telegram、Discord、Slack、WhatsApp、Signal、iMessage、微信等
- **AI Agent 运行时**：支持 Anthropic Claude、OpenAI、Google Gemini、Ollama 等多模型
- **工具系统**：浏览器自动化 (Playwright)、Shell 执行、Canvas 可视化、设备命令
- **原生桌面/移动端**：macOS (SwiftUI)、iOS (Swift)、Android (Kotlin)
- **插件生态**：Channel/Tool/Hook/Provider/Memory 五类插件
- **媒体管道**：图片 (sharp)、PDF、音频、视频的转码与处理

### 关键架构

```
消息通道 (Telegram/Discord/...) ──→ Gateway (WS Server)
                                        ↓
                                    Router (路由)
                                        ↓
                                  Agent Runtime (Pi)
                                        ↓
                                   Tool Execution
                                        ↓
                                   回复 → 通道
```

### 技术栈现状

| 层        | 技术                                   |
|-----------|----------------------------------------|
| 语言      | TypeScript (ESM, strict)               |
| 运行时    | Node.js 22+                            |
| 包管理    | pnpm (Bun 可选)                        |
| HTTP      | Express + ws                           |
| 构建      | tsdown                                 |
| 测试      | Vitest                                 |
| 格式/Lint | oxlint + oxfmt                         |
| 桌面端    | SwiftUI (macOS), Kotlin (Android)      |
| 前端 UI   | Vite + TypeScript (WebChat/控制面板)   |
| 数据库    | SQLite (sqlite-vec 向量检索)           |
| AI SDK    | 自研 Pi runtime (封装 Anthropic API)   |

---

## 二、用 Bun 实现类似桌面应用的方案

### 目标

用 Bun 生态重新实现一个**本地优先的 AI 助手桌面应用**，保留核心能力：

1. 本地 Gateway 服务（消息路由 + Agent 调度）
2. 多通道消息集成
3. 多模型 AI Agent
4. 工具调用（浏览器、Shell、文件等）
5. 桌面 GUI（系统托盘 + 聊天界面 + 设置面板）
6. 插件系统

---

### 三、推荐技术栈

#### 3.1 运行时 & 构建

| 组件       | 选择               | 理由                                              |
|------------|--------------------|-------------------------------------------------|
| 运行时     | **Bun**            | 原生 TS 执行，内置 test runner/SQLite             |
| 包管理     | **Bun**            | `bun install` 速度极快，兼容 npm 生态             |
| 前端构建   | **Vite**           | 极速 HMR、丰富插件生态、Tauri 官方推荐            |
| 后端打包   | **Bun.build()**    | 后端 TS 打包为单文件，部署简单                    |
| 测试       | **Vitest**         | 与 Vite 共享配置，生态成熟，兼容 Jest API         |
| 格式/Lint  | **Biome**          | Rust 实现，替代 oxlint+oxfmt，速度极快            |

#### 3.2 桌面 GUI 框架

**推荐方案：Tauri v2 + Bun**

| 组件          | 选择                | 理由                                           |
|---------------|---------------------|----------------------------------------------|
| 桌面框架      | **Tauri v2**        | Rust 核心，WebView 渲染，体积小 (~10MB vs Electron ~150MB) |
| 前端框架      | **React**         | 生态成熟、组件库丰富 (shadcn/ui)、社区庞大        |
| 样式方案      | **Tailwind CSS v4** | 零运行时、JIT 编译、与 React 配合好          |
| 系统托盘      | Tauri 内置          | 原生系统托盘，支持 macOS/Windows/Linux         |
| IPC           | Tauri Commands      | Rust ↔ JS 双向通信，类型安全                   |

**为什么选 Tauri 而非 Electron：**
- 打包体积：Tauri ~10MB vs Electron ~150MB
- 内存占用：Tauri 使用系统 WebView，内存占用低 50-80%
- 安全性：Rust 后端 + 权限白名单
- 原生能力：系统托盘、通知、文件对话框、全局快捷键全部内置
- Tauri v2 支持移动端 (iOS/Android)，可复用代码

**备选方案对比：**

| 方案             | 优点                     | 缺点                          |
|------------------|--------------------------|------------------------------|
| Tauri v2         | 小体积、安全、跨平台     | Rust 学习曲线                 |
| Electron + Bun   | 生态成熟、Node API 兼容  | 体积大、内存高                |
| Neutralinojs     | 极轻量                   | 功能有限、社区小              |
| Wails (Go)       | 性能好                   | 需要 Go 后端                  |

#### 3.3 后端服务（Gateway）

| 组件           | 选择                          | 理由                                     |
|----------------|-------------------------------|----------------------------------------|
| HTTP 框架      | **Hono**                      | 超轻量 (~14KB)、类型安全、Bun 原生适配   |
| WebSocket      | **Hono WebSocket Helper**     | `hono/bun` 适配器内置 WS 升级支持       |
| 数据库         | **bun:sqlite**                | 内置 SQLite binding，零依赖             |
| 向量检索       | **sqlite-vec + bun:sqlite**   | 与 Bun SQLite 集成，本地向量搜索        |
| 配置文件       | **JSON5 / TOML**              | 人类可读，支持注释                       |
| Schema 校验    | **Zod**                       | TypeScript-first，与 Hono Validator 集成 |
| RPC            | **Hono RPC**                  | 端到端类型安全，前端直接推导后端类型     |
| 进程管理       | **Bun.spawn()**               | 内置子进程管理，替代 child_process       |

**为什么选 Hono 而非裸 Bun.serve()：**
- 路由系统：正则路由、分组、中间件链，避免手写 if/else 路由
- 中间件生态：CORS、JWT、Logger、Rate Limit、Compress 等开箱即用
- Hono RPC：`hc<AppType>()` 客户端自动推导路由类型，前后端类型一体
- Zod Validator：`zValidator('json', schema)` 请求校验与类型推导一步到位
- 多运行时：同一代码可跑在 Bun / Node / Deno / Cloudflare Workers
- 体积极小：核心 ~14KB，不影响启动速度

#### 3.4 AI / LLM 集成

| 组件           | 选择                        | 理由                                     |
|----------------|-----------------------------|-----------------------------------------|
| AI SDK         | **Vercel AI SDK**           | 统一接口、支持流式、工具调用、多 Provider |
| Anthropic      | `@ai-sdk/anthropic`        | Claude 系列模型                          |
| OpenAI         | `@ai-sdk/openai`           | GPT-4o、o1 系列                         |
| Google         | `@ai-sdk/google`           | Gemini 系列                             |
| 本地模型       | `@ai-sdk/ollama` 或直连    | Ollama/llama.cpp 本地推理               |
| 工具调用       | AI SDK Tool Calling         | 统一的工具定义和执行框架                 |

#### 3.5 消息通道

直接复用 npm 生态（Bun 兼容 Node API）：

| 通道       | SDK                         |
|------------|----------------------------|
| Telegram   | `grammy`                   |
| Discord    | `discord.js`               |
| Slack      | `@slack/bolt`              |
| WhatsApp   | `@whiskeysockets/baileys`  |
| Matrix     | `matrix-js-sdk`            |
| 微信       | `wechaty` (可选)           |

#### 3.6 媒体处理

| 组件       | 选择            | 理由                          |
|------------|----------------|------------------------------|
| 图片       | **sharp**       | 高性能，Bun 兼容              |
| PDF        | **pdf-parse**   | 轻量级 PDF 文本提取           |
| 音频       | **ffmpeg**      | 通过 Bun.spawn() 调用         |
| 视频       | **ffmpeg**      | 同上                          |

#### 3.7 插件系统

| 组件         | 选择                    | 理由                              |
|--------------|-------------------------|----------------------------------|
| 插件加载     | **动态 import()**       | Bun 原生支持 TS 动态导入         |
| 插件隔离     | **Worker threads**      | Bun 支持 Web Worker 隔离执行     |
| 插件通信     | **MessagePort**         | Worker 间结构化克隆通信           |
| 插件市场     | npm registry            | 标准 npm 包分发                   |

---

## 四、系统架构设计

```
┌──────────────────────────────────────────────────────┐
│                    Tauri v2 Shell                      │
│  ┌──────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ 系统托盘  │  │  WebView UI  │  │  全局快捷键    │  │
│  │ (Rust)   │  │  (React)    │  │  (Rust)       │  │
│  └────┬─────┘  └──────┬───────┘  └───────┬────────┘  │
│       │               │                  │            │
│       └───────────────┼──────────────────┘            │
│                       │ Tauri IPC                      │
│  ┌────────────────────▼──────────────────────────┐    │
│  │            Bun Gateway Server                  │    │
│  │  ┌─────────┐ ┌─────────┐ ┌──────────────┐    │    │
│  │  │ Router  │ │ Session │ │ Plugin Host  │    │    │
│  │  │ 消息路由 │ │ 会话管理 │ │ 插件运行时   │    │    │
│  │  └────┬────┘ └────┬────┘ └──────┬───────┘    │    │
│  │       │           │             │             │    │
│  │  ┌────▼───────────▼─────────────▼────────┐    │    │
│  │  │          Agent Runtime                 │    │    │
│  │  │  ┌───────┐ ┌────────┐ ┌────────────┐  │    │    │
│  │  │  │ Tools │ │ Memory │ │ Model Mgr  │  │    │    │
│  │  │  └───────┘ └────────┘ └────────────┘  │    │    │
│  │  └────────────────────────────────────────┘    │    │
│  └────────────────────────────────────────────────┘    │
│                       │                                │
│  ┌────────────────────▼──────────────────────────┐    │
│  │              消息通道层                         │    │
│  │  Telegram │ Discord │ Slack │ WhatsApp │ ...  │    │
│  └───────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## 五、项目结构建议

独立于 openclaw 源码，在同级目录新建项目（Bun workspace monorepo）：

```
d:\ai\works\
├── openclaw/                  # 原项目（只读参考）
└── yanclaw/                  # 新项目（独立 git repo）
```

**为什么独立项目而非同目录子文件夹：**
- 技术栈完全不同（Hono vs Express, React vs 原有 UI, Tauri vs SwiftUI），无可复用代码
- 依赖隔离：openclaw 用 pnpm + Node，新项目用 Bun，混在一起会 lockfile 冲突
- 独立 git 历史，干净的提交记录
- 两个文件夹并排打开，随时对照 openclaw 的实现逻辑

### Monorepo 内部结构

```
yanclaw/
├── packages/
│   ├── server/                # Hono Gateway 后端
│   │   ├── src/
│   │   │   ├── index.ts               # 入口，Bun.serve() 启动
│   │   │   ├── app.ts                 # Hono app 定义，导出 AppType
│   │   │   ├── routes/                # Hono 路由模块
│   │   │   │   ├── channels.ts        # 通道 CRUD + 状态
│   │   │   │   ├── agents.ts          # Agent 管理
│   │   │   │   ├── messages.ts        # 消息收发
│   │   │   │   └── ws.ts              # WebSocket 端点
│   │   │   ├── middleware/            # Hono 中间件
│   │   │   │   ├── auth.ts            # 认证
│   │   │   │   └── error.ts           # 错误处理
│   │   │   ├── agents/                # AI Agent 运行时
│   │   │   │   ├── runtime.ts         # Agent 执行循环
│   │   │   │   ├── models.ts          # 模型选择与切换
│   │   │   │   ├── tools/             # 工具实现
│   │   │   │   │   ├── browser.ts     # 浏览器自动化
│   │   │   │   │   ├── shell.ts       # Shell 命令执行
│   │   │   │   │   ├── file.ts        # 文件操作
│   │   │   │   │   └── index.ts       # 工具注册
│   │   │   │   └── memory.ts          # 向量记忆
│   │   │   ├── channels/              # 消息通道
│   │   │   │   ├── base.ts            # 通道抽象基类
│   │   │   │   ├── telegram.ts
│   │   │   │   ├── discord.ts
│   │   │   │   └── slack.ts
│   │   │   ├── plugins/               # 插件系统
│   │   │   │   ├── loader.ts          # 动态加载器
│   │   │   │   ├── registry.ts        # 插件注册表
│   │   │   │   ├── sdk.ts             # 插件 SDK
│   │   │   │   └── sandbox.ts         # Worker 隔离
│   │   │   ├── db/                    # 数据层
│   │   │   │   ├── sqlite.ts          # bun:sqlite 封装
│   │   │   │   ├── sessions.ts        # 会话存储
│   │   │   │   └── vectors.ts         # sqlite-vec 向量检索
│   │   │   ├── config/                # 配置管理
│   │   │   │   ├── schema.ts          # Zod schema
│   │   │   │   └── store.ts           # 配置读写
│   │   │   └── media/                 # 媒体处理
│   │   │       ├── image.ts
│   │   │       ├── audio.ts
│   │   │       └── pdf.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                   # React 前端
│   │   ├── src/
│   │   │   ├── App.tsx
│   │   │   ├── pages/
│   │   │   │   ├── Chat.tsx           # 聊天界面（流式输出）
│   │   │   │   ├── Settings.tsx       # 设置面板
│   │   │   │   ├── Channels.tsx       # 通道管理
│   │   │   │   └── Plugins.tsx        # 插件管理
│   │   │   ├── components/
│   │   │   │   ├── MessageBubble.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   └── ModelSelector.tsx
│   │   │   └── lib/
│   │   │       ├── api.ts             # hc<AppType> RPC 客户端
│   │   │       └── tauri.ts           # Tauri IPC 封装
│   │   ├── index.html
│   │   ├── vite.config.ts             # Vite + React + Tauri 插件 (@vitejs/plugin-react)
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── shared/                # 前后端共享
│       ├── src/
│       │   ├── types.ts               # 共享接口（Channel, Agent, Message...）
│       │   └── constants.ts           # 共享常量（端口、路径、版本）
│       ├── package.json
│       └── tsconfig.json
│
├── src-tauri/                 # Tauri v2 Rust 壳（Tauri 约定路径）
│   ├── src/
│   │   ├── main.rs                    # 入口、窗口管理
│   │   ├── commands.rs                # IPC 命令（启停 Gateway）
│   │   └── tray.rs                    # 系统托盘菜单
│   ├── Cargo.toml
│   └── tauri.conf.json
│
├── plugins/                   # 内置插件（独立 workspace 包）
│   ├── plugin-memory/                 # 向量记忆插件
│   │   ├── src/index.ts
│   │   └── package.json
│   └── plugin-browser/                # 浏览器自动化插件
│       ├── src/index.ts
│       └── package.json
│
├── package.json               # workspace root（见下方配置）
├── bunfig.toml                # Bun 配置
├── biome.json                 # Biome linter/formatter
├── tsconfig.json              # 根 tsconfig（路径别名）
├── vitest.config.ts           # Vitest workspace 配置
└── README.md
```

### Workspace 配置

**根 `package.json`：**
```json
{
  "name": "yanclaw",
  "private": true,
  "workspaces": ["packages/*", "plugins/*"],
  "scripts": {
    "dev": "bun run --filter web dev",
    "dev:server": "bun run --filter server dev",
    "dev:tauri": "bunx tauri dev",
    "build": "bun run --filter '*' build",
    "test": "vitest",
    "check": "biome check .",
    "format": "biome format --write ."
  }
}
```

**Hono RPC 类型跨包链路：**
```
packages/server (export type AppType)
        ↓  TypeScript path alias / workspace 引用
packages/web    (import type { AppType } → hc<AppType>())
        ↓
packages/shared (共享 Channel, Agent, Message 等接口)
```

**为什么 monorepo 而非单包：**
- `server` 可独立运行（CLI 模式、无 GUI 场景、远程部署）
- `web` 可独立 dev（`bun run --filter web dev`，不启动 Tauri 壳）
- `shared` 避免前后端重复定义类型
- 插件包独立版本、可独立发布到 npm

---

## 六、关键实现要点

### 6.1 Gateway 服务器（Hono + Bun）

```typescript
// packages/server/src/app.ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { zValidator } from "@hono/zod-validator";
import { createBunWebSocket } from "hono/bun";
import { z } from "zod";

const { upgradeWebSocket, websocket } = createBunWebSocket();

const app = new Hono()
  .use("*", logger())
  .use("/api/*", cors({ origin: "http://localhost:1420" }));

// REST API 路由
const apiRoutes = app
  .basePath("/api")
  .get("/channels", async (c) => {
    const channels = await getChannelStatus();
    return c.json(channels);
  })
  .post(
    "/messages/send",
    zValidator("json", z.object({
      channel: z.string(),
      to: z.string(),
      text: z.string(),
    })),
    async (c) => {
      const body = c.req.valid("json"); // 完全类型安全
      const result = await sendMessage(body);
      return c.json(result);
    }
  )
  .get("/agents/:id/sessions", async (c) => {
    const agentId = c.req.param("id");
    return c.json(await getSessions(agentId));
  });

// WebSocket 端点（Agent 事件流）
app.get(
  "/ws",
  upgradeWebSocket((c) => ({
    onOpen(evt, ws) { /* 客户端连接，注册到 hub */ },
    onMessage(evt, ws) { /* JSON-RPC 消息分发 */ },
    onClose(evt, ws) { /* 清理订阅 */ },
  }))
);

// 导出类型供前端 RPC 使用
export type AppType = typeof apiRoutes;

// 启动
Bun.serve({ port: 18789, fetch: app.fetch, websocket });
```

### 6.2 Agent 运行时（AI SDK 集成）

```typescript
// packages/server/src/agents/runtime.ts
import { generateText, streamText, tool } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const result = await streamText({
  model: anthropic("claude-sonnet-4-20250514"),
  system: agentSystemPrompt,
  messages: sessionHistory,
  tools: {
    browser: tool({
      description: "打开浏览器并执行操作",
      parameters: z.object({ url: z.string(), action: z.string() }),
      execute: async ({ url, action }) => { /* Playwright */ },
    }),
    shell: tool({
      description: "执行 Shell 命令",
      parameters: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        const proc = Bun.spawn(["bash", "-c", command]);
        return await new Response(proc.stdout).text();
      },
    }),
  },
});
```

### 6.3 SQLite 存储（bun:sqlite）

```typescript
// packages/server/src/db/sqlite.ts
import { Database } from "bun:sqlite";

const db = new Database("~/.myapp/data.db");
db.run(`CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  agent_id TEXT,
  messages TEXT,  -- JSON
  updated_at INTEGER
)`);

// 向量检索 (sqlite-vec 扩展)
db.loadExtension("sqlite-vec");
db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS memories USING vec0(
  embedding float[1536]
)`);
```

### 6.4 前端 RPC 调用（Hono Client，端到端类型安全）

```typescript
// packages/web/src/lib/api.ts
import { hc } from "hono/client";
import type { AppType } from "@yanclaw/server/app";

// 自动推导所有路由的请求/响应类型，零手写 fetch
const client = hc<AppType>("http://localhost:18789");

// 完全类型安全：参数、返回值均自动推导
const channels = await client.api.channels.$get();
const data = await channels.json(); // 类型 = Channel[]

const result = await client.api.messages.send.$post({
  json: { channel: "telegram", to: "user123", text: "Hello" },
  // ↑ 参数类型由 zValidator schema 自动推导，拼写错误编译期报错
});

const sessions = await client.api.agents[":id"].sessions.$get({
  param: { id: "agent-1" },
});
```

### 6.5 Tauri IPC 集成

```rust
// src-tauri/src/commands.rs
#[tauri::command]
async fn start_gateway(port: u16) -> Result<(), String> {
    // 启动 Bun Gateway 子进程
    Command::new("bun")
        .args(["run", "packages/server/src/index.ts", "--port", &port.to_string()])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn send_message(channel: &str, text: &str) -> Result<String, String> {
    // 通过 WS 转发到 Gateway
    // ...
}
```

---

## 七、开发路线图

### Phase 1：核心 Gateway（2-3 周）

- [ ] Hono 应用骨架 + Bun.serve() 启动
- [ ] 路由模块拆分 + Zod Validator 中间件
- [ ] Hono RPC 类型导出 + 前端 `hc` 客户端
- [ ] WebSocket 端点（Hono BunWebSocket Helper）
- [ ] 配置系统（Zod schema + JSON5）
- [ ] bun:sqlite 会话存储
- [ ] 基础 AI Agent 运行时（Vercel AI SDK）
- [ ] Shell 工具 + 文件工具

### Phase 2：桌面 GUI（2-3 周）

- [ ] Tauri v2 项目初始化
- [ ] Vite + React + Tailwind 前端脚手架
- [ ] Hono RPC Client 接入前端（`hc<AppType>` 端到端类型安全）
- [ ] 系统托盘（启停 Gateway、状态指示）
- [ ] 聊天界面（流式输出、Markdown 渲染）
- [ ] 设置面板（模型配置、API Key 管理）

### Phase 3：消息通道（2-3 周）

- [ ] 通道抽象层（统一接口）
- [ ] Telegram 集成 (grammy)
- [ ] Discord 集成 (discord.js)
- [ ] Slack 集成 (@slack/bolt)
- [ ] 消息路由系统
- [ ] DM 配对与权限控制

### Phase 4：高级功能（2-4 周）

- [ ] 插件系统（Worker 隔离 + 动态加载）
- [ ] 浏览器自动化（Playwright）
- [ ] 向量记忆（sqlite-vec）
- [ ] 媒体管道（图片/音频/PDF）
- [ ] 多 Agent 路由

### Phase 5：打磨与发布（1-2 周）

- [ ] 自动更新（Tauri updater）
- [ ] 安装包（macOS .dmg / Windows .msi / Linux .AppImage）
- [ ] 文档网站
- [ ] 插件市场（npm registry）

---

## 八、Bun 相比 Node.js 的优势与注意事项

### 优势

| 方面         | 优势                                                   |
|--------------|-------------------------------------------------------|
| 启动速度     | Bun 冷启动 ~50ms vs Node.js ~200ms                     |
| TS 原生支持  | 无需 tsc/tsx/tsdown 编译步骤                           |
| HTTP 框架    | Hono ~14KB，比 Express 快 3x+，类型安全路由+中间件      |
| 前后端类型   | Hono RPC 端到端类型推导，消灭手写 API 类型的维护负担     |
| 前端开发     | Vite HMR <50ms，插件生态丰富，Tauri 官方集成            |
| SQLite       | 原生 `bun:sqlite`，比 better-sqlite3 快 3-6x           |
| HTTP 性能    | Bun.serve() + Hono，基于 zig/io_uring                  |
| 文件 IO      | Bun.file() 零拷贝读取，`Bun.write()` 高速写入          |

### 注意事项

| 问题                  | 应对方案                                       |
|-----------------------|----------------------------------------------|
| Node API 兼容性       | 绝大多数已兼容；少数 native addon 需测试        |
| sharp 兼容性          | Bun 已支持 sharp，但需注意 libvips 系统依赖     |
| Playwright 兼容性     | 通过 Bun.spawn() 调用 Playwright CLI 即可       |
| 生态成熟度            | npm 包基本通用；Bun 特有 API 文档仍在完善       |
| Windows 支持          | Bun 1.1+ 已正式支持 Windows                    |
| 生产稳定性            | 建议关键路径保留 Node.js 回退方案               |

---

## 九、总结

| 维度     | OpenClaw 现状                | Bun 重实现方案                        |
|----------|------------------------------|--------------------------------------|
| 运行时   | Node.js 22                   | Bun                                  |
| 桌面框架 | SwiftUI (macOS only)         | Tauri v2 (全平台)                    |
| HTTP     | Express + ws                 | **Hono** (超轻量、类型安全、Bun 适配) |
| 前后端通信| 手写 fetch                   | **Hono RPC** (端到端类型推导)         |
| 数据库   | better-sqlite3 + sqlite-vec  | bun:sqlite + sqlite-vec              |
| 前端构建 | Vite                         | **Vite** (HMR + 丰富插件生态)        |
| 后端打包 | tsdown + tsc                 | Bun.build()                          |
| 测试     | Vitest                       | **Vitest** (与 Vite 共享配置)         |
| AI SDK   | 自研 Pi runtime              | Vercel AI SDK (标准化)               |
| 前端     | Vite + TS                    | React + Tailwind                   |
| 包管理   | pnpm                         | Bun                                  |
| 包体积   | ~150MB (如用 Electron)       | ~10-15MB (Tauri)                     |

**核心收益：**
- **Hono RPC 端到端类型安全**：后端定义路由 → 前端自动推导参数/返回类型，零手写 fetch
- **Vite 极速开发体验**：<50ms HMR、Tauri 官方推荐前端构建工具
- 桌面应用体积缩小 10x（Tauri vs Electron）
- 开发体验提升（原生 TS、快速启动、内置 SQLite）
- 全平台支持（Tauri v2 覆盖 macOS/Windows/Linux/iOS/Android）
- Hono 多运行时可移植（同一代码可部署到 Bun/Node/Deno/Edge）
