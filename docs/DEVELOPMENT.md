# YanClaw 开发指南

> 参考 OpenClaw 开发实践，使用 Bun + Biome 工具链

## 环境要求

| 工具 | 最低版本 | 用途 |
|------|---------|------|
| Bun | 1.1+ | 运行时、包管理、测试 |
| Rust | 1.75+ | Tauri 桌面壳编译（桌面开发时需要） |
| Node.js | 20+ | 部分工具链回退（可选） |

### 安装 Bun

```bash
# macOS / Linux
curl -fsSL https://bun.sh/install | bash

# Windows
powershell -c "irm bun.sh/install.ps1 | iex"
```

### 安装 Rust（仅桌面开发需要）

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

---

## 项目初始化

```bash
git clone git@gitee.com:yzlab/yanclaw.git
cd yanclaw
bun install
```

---

## 开发工作流

### 日常开发

后端和前端需要分别启动，在两个终端中运行：

```bash
# 终端 1：启动后端 Gateway（热重载）
bun run dev:server

# 终端 2：启动前端（Vite HMR）
bun run dev
```

后端运行在 `http://localhost:18789`，前端运行在 `http://localhost:1420`。

### 桌面应用开发

需要预先安装 Rust 工具链：

```bash
bun run dev:tauri
```

此命令会同时启动 Vite 前端和 Tauri Rust 编译，首次编译较慢（约 2-5 分钟），后续增量编译很快。

### 仅前端开发

```bash
bun run dev
```

前端可以独立运行，通过 Hono RPC 调用后端 API。后端未启动时 API 调用会失败，但页面可以正常开发。

### 仅后端开发

```bash
bun run dev:server
```

可配合 `curl` 或 Hono RPC 客户端测试 API。

---

## 代码质量

### 格式化与代码检查

项目使用 Biome（Rust 实现，替代 ESLint + Prettier）：

```bash
# 检查代码问题（不修改）
bun run check

# 自动格式化
bun run format
```

### Biome 规则摘要

| 规则 | 值 |
|------|-----|
| 缩进 | Tab |
| 行宽 | 100 字符 |
| 引号 | 双引号 `"` |
| 分号 | 始终添加 |
| Import 排序 | 自动 |

### 运行测试

```bash
# 运行所有测试
bun run test

# 运行单个测试文件
bunx vitest run packages/server/src/__tests__/router.test.ts

# 监听模式
bunx vitest watch

# 带覆盖率
bunx vitest run --coverage
```

### 构建

```bash
# 构建所有包
bun run build

# 构建桌面应用安装包
bun run dev:tauri build
```

---

## Monorepo 工作区

### 包间依赖关系

```
@yanclaw/shared ─────────────────────────┐
    ↑                                     │
    │ import types & constants            │
    │                                     │
@yanclaw/server ──────────────────────────┤
    ↑                                     │
    │ import type { AppType }             │
    │                                     │
@yanclaw/web ─────────────────────────────┘
```

### 包操作命令

```bash
# 给指定包添加依赖
cd packages/server && bun add zod

# 给根项目添加开发依赖
bun add -d vitest

# 在指定包中运行脚本
bun run --filter @yanclaw/server dev
bun run --filter @yanclaw/web build
```

### 路径别名

根 `tsconfig.json` 定义了三个路径别名：

```
@yanclaw/server/* → ./packages/server/src/*
@yanclaw/web/*    → ./packages/web/src/*
@yanclaw/shared/* → ./packages/shared/src/*
```

跨包导入示例：

```typescript
import type { Channel, Agent } from "@yanclaw/shared/types";
import type { AppType } from "@yanclaw/server/app";
```

---

## 新增模块指南

### 新增 API 路由

1. 在 `packages/server/src/routes/` 创建路由文件：

```typescript
// packages/server/src/routes/sessions.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

export const sessionsRoute = new Hono()
  .get("/", async (c) => {
    // 列出会话
    return c.json([]);
  })
  .get("/:key", async (c) => {
    const key = c.req.param("key");
    return c.json({ key, messages: [] });
  })
  .delete("/:key", async (c) => {
    const key = c.req.param("key");
    return c.json({ deleted: true });
  });
```

2. 在 `app.ts` 中挂载路由：

```typescript
import { sessionsRoute } from "./routes/sessions";

const apiRoutes = app
  .basePath("/api")
  // ...existing routes
  .route("/sessions", sessionsRoute);
```

`AppType` 会自动包含新路由的类型信息，前端 `hc<AppType>()` 立即可用。

### 新增通道适配器

1. 在 `packages/server/src/channels/` 创建适配器：

```typescript
// packages/server/src/channels/telegram.ts
import type { ChannelAdapter, InboundMessage } from "./base";

export class TelegramAdapter implements ChannelAdapter {
  readonly id = "telegram";
  // 实现 ChannelAdapter 接口...
}
```

2. 在 `ChannelManager` 中注册。

### 新增 Agent 工具

1. 在 `packages/server/src/agents/tools/` 创建工具文件：

```typescript
// packages/server/src/agents/tools/web-search.ts
import { tool } from "ai";
import { z } from "zod";

export const webSearchTool = tool({
  description: "搜索互联网获取最新信息",
  parameters: z.object({
    query: z.string().describe("搜索关键词"),
  }),
  execute: async ({ query }) => {
    // 调用搜索 API
    return { results: [] };
  },
});
```

2. 在 `ToolRegistry` 中注册工具。

### 新增前端页面

1. 在 `packages/web/src/pages/` 创建页面组件：

```tsx
// packages/web/src/pages/Sessions.tsx
export default function Sessions() {
  return <div>Sessions</div>;
}
```

2. 在 `App.tsx` 中添加路由和导航。

### 新增共享类型

在 `packages/shared/src/types.ts` 中添加接口，前后端均可通过 `@yanclaw/shared/types` 导入。

---

## 目录结构约定

```
packages/server/src/
├── app.ts                # Hono app 实例，组装路由，导出 AppType
├── index.ts              # Bun.serve() 入口
├── routes/               # REST API 路由（每个文件一个 Hono 实例）
├── middleware/            # Hono 中间件
├── agents/               # Agent 运行时
│   ├── runtime.ts        # 执行循环
│   ├── models.ts         # 模型管理
│   ├── tools/            # 内置工具
│   ├── context.ts        # 上下文管理
│   └── policy.ts         # 工具策略
├── channels/             # 消息通道适配器
├── routing/              # 消息路由引擎
├── config/               # 配置系统（Zod + JSON5）
├── db/                   # 数据库层（bun:sqlite）
├── cron/                 # 定时任务调度
└── media/                # 媒体处理

packages/web/src/
├── App.tsx               # 主路由组件
├── main.tsx              # React 入口
├── pages/                # 页面级组件
├── components/           # 可复用 UI 组件
├── lib/                  # 工具库
│   ├── api.ts            # hc<AppType> RPC 客户端
│   └── tauri.ts          # Tauri IPC 封装
└── stores/               # Zustand 状态管理
```

---

## 调试

### 后端调试

```bash
# 使用 Bun 内置调试器（连接 Chrome DevTools）
bun --inspect packages/server/src/index.ts

# 查看 SQLite 数据库内容
bunx litecli ~/.yanclaw/data.db
```

### 前端调试

Vite 开发服务器自带 Source Map，直接在浏览器 DevTools 中调试。

### API 调试

```bash
# 健康检查
curl http://localhost:18789/api/system/health

# 获取通道列表
curl -H "Authorization: Bearer <token>" http://localhost:18789/api/channels

# WebSocket 测试
bunx wscat -c ws://localhost:18789/api/ws
```

---

## 发版流程

1. 更新 `packages/shared/src/constants.ts` 中的 `VERSION`
2. 更新各 `package.json` 版本号
3. `bun run check && bun run test` 确保通过
4. `bun run build` 构建所有包
5. `bun run dev:tauri build` 构建桌面安装包
6. Git tag + push
