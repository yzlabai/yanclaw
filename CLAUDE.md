# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

YanClaw is an AI agent gateway platform built with Bun + Tauri. It routes messages between chat channels (Telegram, Discord, Slack, WebChat) and AI agents, with a desktop app shell. Documentation is in Chinese (`docs/`).

## Commands

```bash
bun install                # Install dependencies
bun run dev                # Start web frontend dev server (Vite, port 1420)
bun run dev:server         # Start backend server with watch mode (port 18789)
bun run dev:tauri          # Launch Tauri desktop app
bun run build              # Build all packages
bun run test               # Run tests (Vitest)
bun run check              # Lint with Biome
bun run format             # Auto-format with Biome
```

## Architecture

Bun monorepo with workspaces (`packages/*`, `plugins/*`):

- **`packages/server`** — Hono HTTP/WebSocket gateway. Routes in `src/routes/`, composed in `src/app.ts`. Exports `AppType` for end-to-end type safety. Uses Zod + `zValidator` for request validation. Runs on `Bun.serve()`.
- **`packages/web`** — React 19 + Vite + Tailwind CSS 4 frontend. Uses Hono RPC client (`hc<AppType>`) in `src/lib/api.ts` for type-safe API calls — no manual fetch or codegen needed.
- **`packages/shared`** — Shared TypeScript interfaces (`Channel`, `Agent`, `Message`, `Session`) and constants (`DEFAULT_PORT`, `APP_NAME`).
- **`plugins/`** — Plugin packages (plugin-browser, plugin-memory). Not yet implemented.
- **`src-tauri/`** — Tauri v2 Rust shell. Not yet implemented.

## Key Patterns

- **Type-safe API chain**: Server defines routes with Hono → exports `AppType` → web imports it into `hc<AppType>()` → full request/response type inference with zero config.
- **Route modules**: Each file in `server/src/routes/` exports a standalone Hono app, composed via `.route(path, handler)` in `app.ts`.
- **Validation**: Zod schemas as middleware via `zValidator('json', schema)`, validated data via `c.req.valid('json')`.
- **Path aliases**: `@yanclaw/server/*`, `@yanclaw/web/*`, `@yanclaw/shared/*` map to workspace `src/` dirs.

## Code Style

- **Biome** for linting and formatting (not ESLint/Prettier)
- Tab indentation, 100-char line width, double quotes, always semicolons
- TypeScript strict mode, ESNext target, bundler module resolution
- Dark theme UI with Tailwind utility classes
