# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YanClaw is an AI agent gateway platform built with Bun + Tauri, positioned as a **practical, security-first alternative to OpenClaw**. It routes messages between chat channels (Telegram, Discord, Slack, WebChat) and AI agents, with a desktop app shell. Documentation is in Chinese (`docs/`).

### vs OpenClaw — Why YanClaw is Better

YanClaw targets the same problem space as OpenClaw (local AI agent ↔ chat channel gateway) but prioritizes **security, reliability, and developer experience** over hype-driven feature sprawl:

| Dimension | OpenClaw | YanClaw |
|---|---|---|
| **Security** | Default bind 0.0.0.0, plaintext credentials, no skill sandboxing, 512+ CVEs, ClawHavoc supply-chain attack compromised 9k+ installs | AES-256-GCM Vault, leak detector, SSRF prevention, prompt injection defense, Docker sandbox, capability model, audit logging, anomaly detection |
| **Runtime** | Node.js (heavy, slow cold start) | Bun (3-5× faster startup, native SQLite, lower memory) |
| **Type Safety** | Loose JS, runtime errors | Hono RPC + Zod end-to-end type inference, zero-config type-safe API |
| **Desktop** | No native app, browser-only | Tauri v2 native shell (system tray, global shortcuts, auto-updater, single-instance) |
| **Plugin Safety** | SKILL.md free-for-all, 820+ malicious skills on ClawHub | TypeScript plugin system with namespaced tools, lifecycle hooks, capability filtering |
| **Agent Control** | Over-autonomous, ignores approval gates, runaway token usage | 3-layer tool policy (global→agent→channel), ownerOnly enforcement, execution approval flow |
| **Memory** | Basic context window | FTS5 + embedding hybrid search, auto-indexing, memory preheat |
| **Model Failover** | Manual provider switch | Multi-profile failover with failure counting, cooldown, auto-recovery |
| **Config** | YAML/env files | JSON5 + Zod validation + env var expansion + hot reload |
| **Channel Health** | Crashes silently | Health monitor with exponential backoff auto-reconnect |

**Design philosophy**: OpenClaw optimizes for "wow, 50+ integrations" breadth; YanClaw optimizes for "it actually works and won't leak your API keys" depth. Every feature ships with proper validation, error handling, and security hardening — not as an afterthought patch.

## Commands

```bash
bun install                # Install dependencies
bun run dev                # Start web frontend dev server (Vite, port 5173)
bun run dev:server         # Start backend server with watch mode (port 18789)
bun run dev:tauri          # Launch Tauri desktop app
bun run build              # Build all packages
bun run test               # Run tests (Vitest)
bun run check              # Lint with Biome
bun run format             # Auto-format with Biome
```

## Architecture

Bun monorepo with workspaces (`packages/*`, `plugins/*`):

- **`packages/server`** — Hono HTTP/WebSocket gateway. Routes in `src/routes/`, composed in `src/app.ts`. Exports `AppType` for end-to-end type safety. Uses Zod + `zValidator` for request validation. Database via Drizzle ORM on bun:sqlite.
- **`packages/web`** — React 19 + Vite + Tailwind CSS 4 frontend. Uses prompt-kit components (`src/components/prompt-kit/`) for chat UI. Hono RPC client (`hc<AppType>`) in `src/lib/api.ts` for type-safe API calls.
- **`packages/shared`** — Shared TypeScript interfaces (`Channel`, `Agent`, `Message`, `Session`) and constants.
- **`plugins/`** — External plugin packages directory (scanned at startup).
- **`src-tauri/`** — Tauri v2 Rust desktop shell. System tray, IPC commands (gateway lifecycle, auth token), global shortcuts, auto-updater, single-instance guard.

## Key Patterns

- **Type-safe API chain**: Server defines routes with Hono → exports `AppType` → web imports it into `hc<AppType>()` → full request/response type inference with zero config.
- **Route modules**: Each file in `server/src/routes/` exports a standalone Hono app, composed via `.route(path, handler)` in `app.ts`.
- **Validation**: Zod schemas as middleware via `zValidator('json', schema)`, validated data via `c.req.valid('json')`.
- **Database**: Drizzle ORM with bun:sqlite. Schema in `server/src/db/schema.ts`, queries in `server/src/db/sessions.ts`. Raw SQL migrations for initial schema, Drizzle for typed queries.
- **Agent Runtime**: Vercel AI SDK (`streamText`) with tool calling (maxSteps: 25). Tools: shell, file_read/write/edit, web_search/fetch, memory_store/search/delete, browser_navigate/screenshot/action. Tool policy with 3-layer allow/deny (global → agent → channel). ownerOnly for shell/file_write/file_edit/browser_*. Supports multimodal (imageUrls → vision). CorrelationId per run for cross-log tracing.
- **Media**: MediaStore for file upload/serve (`server/src/media/`). Telegram extracts photo/doc/audio/video attachments. MediaStore + media API in GatewayContext.
- **Memory**: FTS5 + embedding BLOB hybrid search in `server/src/db/memories.ts`. Embeddings via AI SDK `embed()`. Tools injected when `config.memory.enabled`. MemoryStore in GatewayContext.
- **Model Manager**: Multi-profile failover per provider (Anthropic/OpenAI). Failure counting → cooldown → auto-recovery. Shared singleton in GatewayContext.
- **Logging**: Pino-based structured logging with file rotation (`~/.yanclaw/logs/`). Module loggers (`log.agent()`, `log.channel()`, etc.). Config: `gateway.logging` (level, file, pretty). CorrelationId propagation across agent runs.
- **Retry**: Automatic retry for transient errors (429, timeout, connection reset) with exponential backoff + jitter. Idempotent tools (web_fetch, web_search, browser_*, memory_search) auto-retry; side-effect tools (shell, file_write) delegate to LLM. Channel send retry with per-platform base delays. Config: `tools.retry` (attempts, backoff, jitter).
- **Config**: JSON5 format with Zod validation, env var expansion (`${ENV}`), hot reload via fs.watch. Schema in `server/src/config/schema.ts`.
- **Routing**: Binding-based message→agent routing with 8 priority levels. Identity linking across channels. dmScope for session isolation. CRUD API at `/api/routing`. Channels page shows per-channel bindings with add/delete UI.
- **Error Monitoring**: `ErrorCollector` in `server/src/errors/collector.ts`. Ring buffer (200 entries, real-time) + SQLite `error_logs` table (historical). Buffered writes (same pattern as AuditLogger). API: `GET /api/system/errors` + `/errors/recent`. Dashboard page at `/dashboard` with stats, module distribution, filterable error list, 30s auto-refresh.
- **Tool Metadata**: `GET /api/tools/metadata` exposes TOOL_GROUPS, CAPABILITY_PRESETS, TOOL_CAPABILITIES, OWNER_ONLY_TOOLS. Frontend tool policy editor in Agents page with preset selector + grouped allow/deny checklists.
- **Channels**: ChannelManager orchestrates adapters. Types/dock/dm-policy in `server/src/channels/`. Four adapters: Telegram (grammY), Slack (@slack/bolt Socket Mode), Discord (discord.js v14), Feishu. Health monitor with exponential backoff auto-reconnect. DM policy (open/allowlist/pairing) + ownerOnly enforcement. Block streaming mode (send chunks as agent generates, configurable via `blockStreaming` in CHANNEL_DOCK). `editMessage()` on Telegram/Discord adapters.
- **Plugins**: `PluginRegistry` + `PluginLoader` in `server/src/plugins/`. Scans `~/.yanclaw/plugins/` + custom dirs. Tools namespaced as `pluginId.toolName`. 5 lifecycle hooks (onGatewayStart/Stop, onMessageInbound, beforeToolCall, afterToolCall).
- **Task Loop**: Autonomous task iteration framework in `server/src/agents/task-loop/`. Generic loop: spawn agent → verify output → feedback → iterate. Pluggable strategies via `LoopPreset<T>` (Verifier, Deliverer, FeedbackFormatter, TerminationPolicy). 11-state machine with `ConfirmPolicy` breakpoints. Dev Preset: shell test runner + git PR delivery + dead-loop detection. DAG orchestration for multi-task dependency chains. `TaskLoopController` in GatewayContext (enabled via `agentHub.taskLoop.enabled`). Channel `/task` command + Dashboard UI (TaskLoopCard, TaskLoopSpawnDialog). Config: `agentHub.taskLoop` block.
- **Session Cleanup**: `SessionStore.pruneStale(days)` runs on startup per `session.pruneAfterDays` (default 90). Expired media cleaned simultaneously.
- **Onboarding**: `SetupGuard` in App.tsx redirects to `/onboarding` if no API key configured. 3-step wizard: Model → Channels (optional, auto-binds to main agent) → Done. `GET /api/system/setup` returns `needsSetup`.
- **Tauri IPC**: Frontend `lib/tauri.ts` wraps IPC calls (`isTauri()`, `getAuthToken()`, `startGateway()`, `checkForUpdates()`, `installUpdate()`, etc.). Desktop shell manages gateway as child process. Auto-updater via GitHub Releases endpoint.
- **Chat UI**: prompt-kit components (ChatContainer with auto-scroll, Message with avatar, PromptInput with auto-size textarea, ToolCall collapsible, Markdown rendering).
- **PIM (Personal Information Management)**: Eight-element ontology (person/event/thing/place/time/info/org/ledger) stored in `pim_items` + `pim_links` tables. `PimStore` in `server/src/pim/store.ts`. Auto-extraction via `pim/extractor.ts` (async after agent reply). Context injection via `pim/preheat.ts`. Reminders via `pim/reminder.ts` (30min cycle). Agent tools: `pim_query`, `pim_save`, `pim_update`, `pim_inspect`. Frontend: `web/src/pages/Pim.tsx` (8 tab views). API at `/api/pim`. Config: `pim` block. Docs: `docs/pim/README.md`.
- **Path aliases**: `@yanclaw/server/*`, `@yanclaw/web/*`, `@yanclaw/shared/*` map to workspace `src/` dirs.

## Server Startup Sequence

`initGateway` → `startMcp` → `startPlugins` → `startChannels` → `startCron` → `startHeartbeats` → `runSessionCleanup` → `startMemoryIndexer` → hot-reload listener

## Code Style

- **Biome** for linting and formatting (not ESLint/Prettier)
- Tab indentation, 100-char line width, double quotes, always semicolons
- TypeScript strict mode, ESNext target, bundler module resolution
- Dark theme UI with Tailwind utility classes

## Documentation Style

All docs in Chinese, code comments in English. See `docs/WRITING-GUIDE.md` for full conventions. Key rules:
- Plan docs: frontmatter → 需求总览表 → 功能节(问题→方案→步骤→测试) → 依赖关系 → 影响范围 → 工作量 → 不做的事情
- File naming: `docs/plans/YYYY-MM-DD-kebab-topic.md`
- Config examples in `json5`, interfaces in `typescript`, schemas in `sql`
- Every plan must have "不做的事情" (scope exclusions) and "影响范围汇总" (files changed)
