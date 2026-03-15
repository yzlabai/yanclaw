# 2026-03-15 Agent 可靠性与用户体验改进 — 开发记录

## 概述

基于对 OpenClaw 文档的全面对比分析（`docs/agent-comparison-vs-openclaw.md`），识别出 YanClaw 在生产可靠性层面的三大缺失：工具调用无重试、日志不可观测、Agent Hub UX 混乱。产品分析文档见 `docs/product-analysis-agent-reliability.md`。

分两轮实施：
- 第一轮（v0.11.0）：结构化日志 + 工具重试 + 路由绑定 UI + Agent Hub 重命名
- 第二轮（v0.12.0）：工具策略 UI + 错误面板 + 路由调试器 + Block Streaming

对照计划文档：
- `docs/plans/2026-03-15-agent-reliability-and-ux.md`（第一轮）
- `docs/plans/2026-03-15-ux-and-observability-next.md`（第二轮）

## 第一轮实施（v0.11.0）

### Phase 1: 结构化日志系统

**新增文件：**
- `packages/server/src/logger.ts` — Pino logger 封装（多 transport、文件轮转、模块子 logger）

**修改文件（35 个）：**
- 全部 `console.log/warn/error` → `log.module().level({context}, "message")`
- 仅保留 `cli.ts`（CLI 用户输出）和 `vault-migrate.ts`（迁移脚本）使用 console

**关键设计：**
- 10 个模块 logger：gateway/agent/channel/routing/security/plugin/mcp/cron/config/db
- Agent 运行级 `correlationId`（`randomBytes(6).toString("hex")`）跨日志追踪
- 配置：`gateway.logging`（level/file.enabled/file.maxSize/file.maxFiles/pretty）
- 日志存储：`~/.yanclaw/logs/gateway.*`（pino-roll 轮转）

### Phase 2: 工具调用重试机制

**新增文件：**
- `packages/server/src/agents/tools/retry.ts` — 重试逻辑（瞬态/永久错误分类、指数退避、Retry-After 解析）

**修改文件：**
- `agents/tools/index.ts` — 幂等工具包装 `withRetry()`
- `channels/manager.ts` — 频道投递 `sendWithRetry()` 包装
- `config/schema.ts` — `tools.retry` 配置项

**关键设计：**
- 幂等工具自动重试（web_fetch/search、memory_search、browser_navigate/screenshot），副作用工具不重试
- 频道投递按平台基础延迟（Telegram 400ms / Discord 500ms / Slack 300ms）
- 参考 OpenClaw `concepts/retry.md` 的设计

### Phase 3: 路由绑定 UI

**新增文件：**
- `packages/server/src/routes/routing.ts` — 路由绑定 CRUD API + 测试端点

**修改文件：**
- `packages/web/src/pages/Channels.tsx` — 频道卡片内嵌路由规则（默认 Agent + 自定义绑定 + 添加/删除对话框）
- `packages/web/src/pages/Onboarding.tsx` — 添加频道时自动绑定 main Agent + 完成页绑定摘要

### Phase 4: Agent Hub UX 重设计

**修改文件：**
- i18n: Agents → "AI 助手"、Agent Hub → "任务"
- `pages/Agents.tsx` — 标题改名 + `taskEnabled` 开关 + "可执行任务"标记
- `config/schema.ts` — `agentSchema.taskEnabled: boolean`
- `routes/agents.ts` — CRUD API 暴露 taskEnabled

---

## 第二轮实施（v0.12.0）

### Feature 1: 工具策略 UI

**新增文件：**
- `packages/server/src/routes/tools-metadata.ts` — `GET /api/tools/metadata`（groups/presets/capabilities/ownerOnly）

**修改文件：**
- `agents/tools/index.ts` — 导出 TOOL_GROUPS/CAPABILITY_PRESETS/TOOL_CAPABILITIES/OWNER_ONLY_TOOLS
- `routes/agents.ts` — GET/PATCH 暴露 tools + capabilities 字段
- `pages/Agents.tsx` — 编辑对话框新增"工具权限"折叠区（预设单选 + 分组 allow/deny 勾选 + ownerOnly 标记）

### Feature 2: 错误面板

**新增文件：**
- `packages/server/src/errors/collector.ts` — ErrorCollector（Ring Buffer + SQLite error_logs + 缓冲写入）
- `packages/web/src/pages/Dashboard.tsx` — 监控页面（统计卡片 + 模块分布 + 错误列表 + 自动刷新）

**修改文件：**
- `gateway.ts` — GatewayContext 新增 errorCollector
- `routes/system.ts` — `GET /api/system/errors` + `GET /api/system/errors/recent`
- `App.tsx` — 侧边栏新增"监控"入口

### Feature 3: 路由调试器

**新增文件/函数：**
- `routing/resolve.ts` — `resolveRouteDebug()`（返回所有候选绑定 + 得分分解）

**修改文件：**
- `routes/routing.ts` — `?debug=true` 参数支持
- `pages/Channels.tsx` — "测试路由"对话框（输入频道/用户/Guild → 显示排名候选列表 + 得分分解）

### Feature 5: Block Streaming

**修改文件：**
- `channels/manager.ts` — 双模式发送（blockStreaming=true 边生成边发送，false 传统缓存）
- `channels/types.ts` — ChannelAdapter 新增 `editMessage?` 方法
- `channels/telegram.ts` — 实现 `editMessage()`（grammY editMessageText）
- `channels/discord.ts` — 实现 `editMessage()`（discord.js message.edit）

## 检查结果

- Biome lint: ✅ 234 文件检查通过
- Vitest: ✅ 250 测试通过，2 跳过
