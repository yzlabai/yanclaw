# 生态集成 — 开发完成记录

对应计划文档：`docs/plans/2026-03-11-ecosystem-integration.md`

完成日期：2026-03-12

---

## 交付总结

三个 Phase 全部完成，涵盖 9 个 Step，新增 6 个文件，修改 20+ 个文件。

### Phase 1：MCP 核心（Step 1-3）

| 交付项 | 文件 | 说明 |
|--------|------|------|
| Config Schema 扩展 | `config/schema.ts` | 新增 `mcpServerSchema`、`mcpSchema`，支持 stdio + HTTP 双模式 |
| MCP Client 管理器 | `mcp/client.ts`（新建） | `McpClientManager` 管理所有 MCP Server 连接生命周期，指数退避重试，tool 缓存 + `notifications/tools/list_changed` 刷新，热重载 diff 重启 |
| MCP → Tool 桥接 | `agents/tools/index.ts` | MCP tools 内联桥接到 `createToolset()`，命名空间 `mcp.{server}.{tool}`，`createToolset` 改为 async |
| Tool Policy 通配符 | `agents/tools/index.ts` | 新增 `matchesPatterns()` 支持 `mcp.*`、`mcp.github.*` 语法，替换所有 `includes()` 调用 |
| Gateway 集成 | `gateway.ts`、`index.ts` | `McpClientManager` 注入 GatewayContext，启动顺序：MCP → Plugins → Channels |

**依赖**：`@modelcontextprotocol/sdk`

### Phase 2：模型切换 + Channel 重构 + 飞书（Step 4-6）

| 交付项 | 文件 | 说明 |
|--------|------|------|
| Session 级 Model Override | `db/schema.ts`、`db/sqlite.ts`、`db/sessions.ts`、`routes/sessions.ts`、`agents/runtime.ts` | sessions 表新增 `model_override` 列，PATCH API，runtime 优先使用 session override |
| GET /api/models/available | `routes/models.ts`、`agents/model-manager.ts` | 服务端缓存（5 分钟 TTL），返回 provider 分组 + 健康状态（available/cooldown/failed） |
| ModelSelector 前端组件 | `components/ModelSelector.tsx`（新建）、`pages/Chat.tsx` | Provider 分组下拉，实时健康状态标签，流式输出时禁用 |
| Channel 注册表 | `channels/registry.ts`（新建） | `ChannelRegistry` 类，`register()`/`create()`/`getCapabilities()`，单例导出 |
| 内置 Channel 自注册 | `channels/{telegram,slack,discord}.ts` | 各文件末尾自注册到 `channelRegistry` |
| Config 从 object → array | `config/schema.ts`、`config/store.ts` | `channelsSchema` 改为数组，`migrateChannelsConfig()` 自动迁移旧格式 |
| startChannels 统一循环 | `gateway.ts` | ~40 行硬编码 → ~15 行通用循环，新增 channel 只需 adapter 文件 + 自注册 |
| 飞书适配器 | `channels/feishu.ts`（新建） | `@larksuiteoapi/node-sdk` WSClient 长连接，支持文本/图片/文件消息，markdown → 飞书卡片 |
| Channel 管理 API | `routes/channels.ts` | 新增 `GET /types`、`POST /`（添加）、`DELETE /:type/:accountId`（移除） |
| Channel 管理 UI | `pages/Channels.tsx` | 添加渠道表单（动态类型选择、必填字段、DM 策略）、删除按钮 |
| Plugin Channel 桥接 | `plugins/registry.ts`、`plugins/types.ts` | Plugin channel factory 自动注册到 `channelRegistry`，走统一 `startChannels()` |
| DM Policy 适配 | `channels/dm-policy.ts` | 查找逻辑从 `config.channels[type]` 改为 `config.channels.find()` |

**依赖**：`@larksuiteoapi/node-sdk`

### Phase 3：Registry UI + 安全加固（Step 7-9）

| 交付项 | 文件 | 说明 |
|--------|------|------|
| MCP Server API | `routes/mcp.ts`（新建）、`app.ts` | GET/POST 服务管理 + Registry 代理搜索 |
| MCP 管理 UI | `pages/McpServers.tsx`（新建）、`App.tsx` | 已安装服务列表（启动/停止/展开工具）+ Registry 搜索 |
| 环境变量清洗 | `agents/tools/shell.ts` | `sanitizeEnv()` 过滤 API_KEY、TOKEN、SECRET、PASSWORD、CREDENTIAL 后缀变量 |
| 审批 fail-closed | `agents/tools/index.ts` | `approvalManager` 缺失时移除需审批的 shell 工具 |
| Token 轮换增强 | `security/token-rotation.ts` | 新增 `isActive`、`isInGracePeriod` 状态访问器 |
| 上下文裁剪保留图片 | `db/sessions.ts` | `compact()` 跳过含 image 引用的消息 |

---

## 新增文件清单

| 文件 | 用途 |
|------|------|
| `packages/server/src/mcp/client.ts` | MCP Client 管理器 |
| `packages/server/src/channels/registry.ts` | Channel 注册表 |
| `packages/server/src/channels/feishu.ts` | 飞书适配器 |
| `packages/server/src/routes/mcp.ts` | MCP API 路由 |
| `packages/web/src/pages/McpServers.tsx` | MCP 管理页面 |
| `packages/web/src/components/ModelSelector.tsx` | 模型选择器组件 |

## 数据库迁移

- Migration v4：`ALTER TABLE sessions ADD COLUMN model_override TEXT`

## 质量验证

- Lint：150 files checked，0 errors（1 pre-existing warning）
- Test：10 test files，121 passed，2 skipped
- Build：server + web 均成功

## 验收标准对照

### Phase 1 ✅
- [x] config.json5 中配置 MCP Server 后，agent 可调用其 tools
- [x] stdio 和 HTTP 两种模式均可连接
- [x] Tool policy 通配符：`mcp.*`、`mcp.github.*` 语法生效
- [x] MCP tools 受 tool policy 控制（deny 可禁用特定 MCP tool）
- [x] 热重载：修改 mcp.servers 配置后，自动重连变更的 server
- [x] 启动日志打印 MCP Server 连接状态

### Phase 2 ✅
- [x] 模型选择器显示 provider 分组 + 实时健康状态
- [x] 选中模型后立即生效于当前 session，流式输出时选择器禁用
- [x] `GET /api/models/available` 有服务端缓存
- [x] Channel 注册表：新增 channel 只需一个 adapter 文件 + 自注册
- [x] 旧 config 格式（object）自动迁移为新格式（array）
- [x] 现有 telegram/slack/discord 功能不受重构影响（回归测试通过）
- [x] Plugin channel factory 自动桥接到 channelRegistry
- [x] Routing bindings 在新 config 结构下正常工作
- [x] Channel 管理 UI：可通过界面添加/移除渠道
- [x] 飞书适配器实现（需实际 appId/appSecret 进行端到端验证）

### Phase 3 ✅
- [x] MCP 管理页面可查看所有 Server 状态和 tools 列表
- [x] 可从 Registry 搜索 MCP Server
- [x] Docker sandbox / shell 不泄漏宿主环境变量
- [x] 无审批管理器时需审批的工具被禁用（fail-closed）

## 待后续端到端验证

- 飞书 WSClient 在实际 appId/appSecret 下的连接稳定性
- MCP SDK 在 Bun 上 stdio 子进程管理的边界情况
- Registry 搜索结果 → 一键安装流程（当前仅展示搜索结果，安装需手动编辑 config）
