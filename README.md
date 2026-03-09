# YanClaw

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
- **后端**：Hono + Zod 校验 + Vercel AI SDK（Claude / GPT / Gemini / Ollama）
- **前端**：React 19 + Vite 6 + Tailwind CSS 4 + Hono RPC 类型安全客户端
- **桌面**：Tauri v2（Rust 内核，~10MB 体积）
- **代码质量**：Biome（lint + format）+ Vitest（测试）+ TypeScript strict

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发（分别在两个终端运行）
bun run dev          # 前端 (http://localhost:1420)
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
- [技术选型分析](docs/ANALYSIS_BUN_DESKTOP_APP.md)

## License

MIT
