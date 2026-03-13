<p align="center">
  <img src="packages/web/public/icon-512.png" width="128" height="128" alt="YanClaw">
</p>

<h1 align="center">YanClaw</h1>

[English](#english) | [中文](#中文)

---

<a id="english"></a>

A lightweight, security-first, multi-channel AI assistant gateway — inspired by [OpenClaw](https://github.com/nicepkg/openclaw), rebuilt from scratch with a modern stack.

OpenClaw pioneered the local AI gateway concept with 23+ channel integrations and native clients (SwiftUI for macOS, Kotlin for Android), but relies on Node.js + Express, a custom AI runtime, and platform-specific native code for each OS. YanClaw takes the same core idea and re-implements it with **Bun + Hono + Tauri v2**, focusing on three things: **lightweight** (single ~30MB installer, one codebase for all platforms, zero native deps), **security** (AES-256 credential vault, credential leak detection, prompt injection defense, execution approval, Docker sandbox, audit logging, SSRF prevention, and rate limiting — all built in, not bolted on), and **hackable** (clean monorepo, end-to-end type-safe API via Hono RPC, Zod-validated routes, plugin system with lifecycle hooks — easy to add new channels, tools, or agents without touching core code).

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
- **Desktop**: Tauri v2 (Rust core, ~30MB installer)
- **Quality**: Biome (lint + format) + Vitest (tests) + TypeScript strict

### vs OpenClaw

| | OpenClaw | YanClaw |
|---|---|---|
| Runtime | Node.js 22 | Bun |
| Desktop | SwiftUI (macOS) + Kotlin (Android) | Tauri v2 (one codebase, all platforms) |
| HTTP | Express + ws | Hono (type-safe RPC) |
| AI SDK | Custom Pi runtime | Vercel AI SDK + Claude Agent SDK |
| Frontend | Vite + TS | React 19 + Tailwind CSS 4 |
| Database | better-sqlite3 + sqlite-vec | bun:sqlite + FTS5 |
| Desktop binary | Native per-platform | ~30MB installer (Tauri, unified) |
| Package manager | pnpm | Bun |

## Features

- Multi-agent management with model failover and context budget control
- Channel adapters for Telegram, Discord, Slack, and built-in WebChat
- Dual runtime: Vercel AI SDK (streamText) + Claude Code Agent SDK, switchable per agent
- Tool system: shell, file ops, web search/fetch, browser (Playwright), desktop screenshot, memory store
- Docker sandbox for isolated command execution
- Plugin system with worker-thread isolation
- Vector memory with FTS5 + cosine similarity hybrid search
- Cron scheduler with interval/one-shot modes
- Execution approval system (auto/manual/owner-only)
- Bearer token authentication
- Media pipeline: upload, thumbnails, format conversion, PDF text extraction
- Session export (JSON/Markdown), auto-cleanup
- Background running: close window to tray, gateway keeps running (Ollama-style)
- CLI management: `yanclaw start/stop/restart/status`
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

## CLI

```bash
bun run yanclaw status    # Show running status
bun run yanclaw start     # Start gateway (daemon)
bun run yanclaw stop      # Graceful stop
bun run yanclaw restart   # Restart gateway
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
- [API](docs/API.md)
- [Database](docs/DATABASE.md)
- [Security Guide](docs/security-guide.md)
- [Changelog](docs/CHANGELOG.md)

---

<a id="中文"></a>

轻量、安全的多通道 AI 助手网关 —— 受 [OpenClaw](https://github.com/nicepkg/openclaw) 启发，使用现代技术栈从零重写。

OpenClaw 开创了本地 AI 网关的概念，支持 23+ 消息通道集成，提供 macOS (SwiftUI) 和 Android (Kotlin) 原生客户端，但依赖 Node.js + Express、自研 AI 运行时，且每个平台需要独立的原生代码。YanClaw 保留相同的核心理念，用 **Bun + Hono + Tauri v2** 重新实现，主打三点：**轻量**（~30MB 安装包、一套代码全平台、零原生依赖）、**安全**（AES-256 凭证加密、凭证泄漏检测、提示注入防御、执行审批、Docker 沙箱、审计日志、SSRF 防护、速率限制——全部内置，不是事后补丁）、**易于二开**（清晰的 monorepo 结构、Hono RPC 端到端类型安全、Zod 校验路由、插件系统带生命周期钩子——新增通道、工具或 Agent 不需要改动核心代码）。

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
- **桌面**：Tauri v2（Rust 内核，~30MB 安装包）
- **代码质量**：Biome（lint + format）+ Vitest（测试）+ TypeScript strict

### 对比 OpenClaw

| | OpenClaw | YanClaw |
|---|---|---|
| 运行时 | Node.js 22 | Bun |
| 桌面框架 | SwiftUI (macOS) + Kotlin (Android) | Tauri v2（一套代码，全平台） |
| HTTP | Express + ws | Hono（类型安全 RPC） |
| AI SDK | 自研 Pi runtime | Vercel AI SDK + Claude Agent SDK |
| 前端 | Vite + TS | React 19 + Tailwind CSS 4 |
| 数据库 | better-sqlite3 + sqlite-vec | bun:sqlite + FTS5 |
| 桌面包 | 各平台独立原生应用 | ~30MB 安装包（Tauri 统一） |
| 包管理 | pnpm | Bun |

## 功能特性

- 多 Agent 管理，模型故障转移，上下文预算控制
- 通道适配器：Telegram、Discord、Slack、内置 WebChat
- 双运行时：Vercel AI SDK (streamText) + Claude Code Agent SDK，按 Agent 切换
- 工具系统：Shell、文件操作、网页搜索/抓取、浏览器（Playwright）、桌面截图、记忆存储
- Docker 沙箱隔离执行
- 插件系统（Worker 线程隔离）
- 向量记忆：FTS5 + 余弦相似度混合搜索
- Cron 定时任务（间隔/单次模式）
- 执行审批系统（自动/手动/仅 Owner）
- Bearer Token 认证
- 媒体管道：上传、缩略图、格式转换、PDF 文本提取
- 会话导出（JSON/Markdown）、自动清理
- 后台运行：关窗隐藏到托盘，Gateway 持续运行（Ollama 风格）
- CLI 管理工具：`yanclaw start/stop/restart/status`
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

## CLI

```bash
bun run yanclaw status    # 查看运行状态
bun run yanclaw start     # 后台启动 Gateway
bun run yanclaw stop      # 优雅停止
bun run yanclaw restart   # 重启
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
- [API 文档](docs/API.md)
- [数据库设计](docs/DATABASE.md)
- [安全指南](docs/security-guide.md)
- [更新日志](docs/CHANGELOG.md)

## License

MIT
