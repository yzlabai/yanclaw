# YanClaw

[English](#english) | [中文](#中文)

---

<a id="english"></a>

A local-first, multi-channel AI assistant desktop app. Run a gateway server locally, chat with multiple AI models through a unified interface, and connect AI to Telegram / Discord / Slack for a cross-platform intelligent assistant experience.

## Architecture

```
┌─────────────────────────────────────────────────┐
│            Tauri v2 Desktop Shell                │
│   System Tray (Rust) │ WebView (React) │ Hotkeys │
│                      ↓ Hono RPC                  │
│  ┌─────────────────────────────────────────────┐ │
│  │         @yanclaw/server (Bun)               │ │
│  │  Hono Router → Agent Runtime → Tool System  │ │
│  │  Channel Manager ← Telegram/Discord/Slack   │ │
│  │  SQLite (bun:sqlite) · Plugin Runtime       │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Monorepo structure:**

| Package | Description |
|---|---|
| `packages/server` | Hono HTTP/WebSocket gateway server |
| `packages/web` | React 19 + Vite + Tailwind CSS 4 frontend |
| `packages/shared` | Shared types and constants |
| `plugins/*` | Plugin packages (browser, memory, etc.) |
| `src-tauri/` | Tauri v2 desktop shell |

## Tech Stack

- **Runtime**: Bun (native TS execution, built-in SQLite)
- **Backend**: Hono + Zod validation + Vercel AI SDK (Claude / GPT / Gemini / Ollama) + Drizzle ORM
- **Frontend**: React 19 + Vite 6 + Tailwind CSS 4 + prompt-kit + Hono RPC type-safe client
- **Desktop**: Tauri v2 (Rust core, ~10MB binary)
- **Quality**: Biome (lint + format) + Vitest (tests) + TypeScript strict

## Features

- Multi-agent management with model failover and context budget control
- Channel adapters for Telegram, Discord, Slack, and built-in WebChat
- Tool system: shell, file ops, web search/fetch, browser (Playwright), memory store
- Docker sandbox for isolated command execution
- Plugin system with worker-thread isolation
- Vector memory with FTS5 + cosine similarity hybrid search
- Cron scheduler with interval/one-shot modes
- Execution approval system (auto/manual/owner-only)
- Bearer token authentication
- Media pipeline: upload, thumbnails, format conversion, PDF text extraction
- Session export (JSON/Markdown), auto-cleanup
- Auto-updater via GitHub Releases

## Quick Start

```bash
# Install dependencies
bun install

# Start development (run in two terminals)
bun run dev          # Frontend (http://localhost:5173)
bun run dev:server   # Backend (http://localhost:18789)

# Or launch Tauri desktop app
bun run dev:tauri
```

## Other Commands

```bash
bun run build        # Build all packages
bun run test         # Run tests
bun run check        # Biome lint
bun run format       # Biome auto-format
```

## Docs

- [Design](docs/DESIGN.md)
- [Features](docs/FEATURES.md)
- [Changelog](docs/CHANGELOG.md)
- [Database](docs/DATABASE.md)

---

<a id="中文"></a>

本地优先的多通道 AI 助手桌面应用。在本机运行 Gateway 服务，通过统一界面与多个 AI 模型对话，并可将 AI 接入 Telegram / Discord / Slack 等消息通道，实现跨平台的智能助手体验。

## 架构

```
┌─────────────────────────────────────────────────┐
│            Tauri v2 Desktop Shell                │
│   系统托盘 (Rust)  │  WebView (React)  │ 快捷键  │
│                    ↓ Hono RPC                    │
│  ┌─────────────────────────────────────────────┐ │
│  │         @yanclaw/server (Bun)               │ │
│  │  Hono Router → Agent Runtime → Tool System  │ │
│  │  Channel Manager ← Telegram/Discord/Slack   │ │
│  │  SQLite (bun:sqlite) · Plugin Runtime       │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Monorepo 结构：**

| 包 | 说明 |
|---|---|
| `packages/server` | Hono HTTP/WebSocket 网关服务 |
| `packages/web` | React 19 + Vite + Tailwind CSS 4 前端 |
| `packages/shared` | 共享类型与常量 |
| `plugins/*` | 插件包（浏览器、记忆等） |
| `src-tauri/` | Tauri v2 桌面壳 |

## 技术栈

- **运行时**：Bun（原生 TS 执行、内置 SQLite）
- **后端**：Hono + Zod 校验 + Vercel AI SDK（Claude / GPT / Gemini / Ollama）+ Drizzle ORM
- **前端**：React 19 + Vite 6 + Tailwind CSS 4 + prompt-kit + Hono RPC 类型安全客户端
- **桌面**：Tauri v2（Rust 内核，~10MB 体积）
- **代码质量**：Biome（lint + format）+ Vitest（测试）+ TypeScript strict

## 功能特性

- 多 Agent 管理，模型故障转移，上下文预算控制
- 通道适配器：Telegram、Discord、Slack、内置 WebChat
- 工具系统：Shell、文件操作、网页搜索/抓取、浏览器（Playwright）、记忆存储
- Docker 沙箱隔离执行
- 插件系统（Worker 线程隔离）
- 向量记忆：FTS5 + 余弦相似度混合搜索
- Cron 定时任务（间隔/单次模式）
- 执行审批系统（自动/手动/仅 Owner）
- Bearer Token 认证
- 媒体管道：上传、缩略图、格式转换、PDF 文本提取
- 会话导出（JSON/Markdown）、自动清理
- 自动更新（GitHub Releases）

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发（分别在两个终端运行）
bun run dev          # 前端 (http://localhost:5173)
bun run dev:server   # 后端 (http://localhost:18789)

# 或启动 Tauri 桌面应用
bun run dev:tauri
```

## 其他命令

```bash
bun run build        # 构建所有包
bun run test         # 运行测试
bun run check        # Biome 代码检查
bun run format       # Biome 自动格式化
```

## 文档

- [功能设计](docs/DESIGN.md)
- [功能需求](docs/FEATURES.md)
- [开发日志](docs/CHANGELOG.md)
- [数据库设计](docs/DATABASE.md)

## License

MIT
