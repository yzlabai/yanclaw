# Phase 2 — P1/P2 核心功能

## 2026-03-09: Onboarding 引导流程

- 新增首次启动引导向导（3 步）：模型配置 → 通道连接（可跳过） → 完成
- 自动检测是否已配置 API Key，未配置时自动跳转到 /onboarding
- 支持 Anthropic / OpenAI 两大提供商快速配置
- 可选配置 Telegram / Slack 通道
- 服务端 `GET /api/system/setup` 端点返回 `needsSetup` 状态
- P2 核心功能全部完成（9/9）

## 2026-03-09: Slack 适配器

- 基于 @slack/bolt Socket Mode 实现完整 Slack Bot 适配器
- DM + Channel 消息支持，Channel 中仅响应 @提及
- 自动获取 bot user ID 用于 mention 检测
- 支持文件附件提取（image/file）
- 线程回复支持（thread_ts）
- 网关启动时自动连接已配置且启用的 Slack Bot

## 2026-03-09: Playwright 浏览器自动化

- 新增三个 Agent 工具：`browser_navigate`、`browser_screenshot`、`browser_action`
- `browser_navigate`：打开 URL + 提取可见文本（处理 JS 渲染页面）
- `browser_screenshot`：全页/视口/元素截图，返回 base64 data URL
- `browser_action`：click/type/press/scroll/select 交互操作
- 懒加载浏览器实例，单例复用，headless Chromium
- 工具组 `group:browser`，ownerOnly 限制（防止非 owner 操控浏览器）

## 2026-03-09: 媒体管道 + 视觉支持

**MediaStore**

- 新增 `media/store.ts`：文件存储（磁盘 + DB 元数据）
- 支持从 Buffer 或 URL 上传，自动识别 MIME 类型和扩展名
- 文件过期清理机制（expiresAt + cleanup 方法）
- 文件存储路径：`~/.yanclaw/media/{id}.{ext}`

**Media API**

- `POST /api/media/upload` — multipart 文件上传
- `GET /api/media/:id` — 文件内容服务（inline + 缓存头）
- `GET /api/media/:id/info` — 文件元数据查询
- `DELETE /api/media/:id` — 删除文件（DB + 磁盘）

**Telegram 图片/文件提取**

- 升级 Telegram 适配器：从 `message:text` 扩展到 `message`（全类型）
- 支持提取 photo、document、audio、video、voice 附件
- 自动获取 Telegram 文件 URL 并填充 Attachment 对象
- photo 自动选取最大尺寸，caption 作为消息文本

**视觉/多模态支持**

- AgentRuntime.run() 新增 `imageUrls` 参数
- 有图片时构建 AI SDK 多模态内容（text + image parts）
- ChannelManager 自动从附件提取 image URL 传递给 Agent
- Chat API 也支持 `imageUrls` 参数（WebChat 前端可用）

## 2026-03-09: 向量记忆系统

**MemoryStore 后端**

- 新增 `memories` 表 + FTS5 虚拟表（自动同步触发器）
- 混合搜索：FTS5 关键词匹配 + 余弦相似度向量搜索
- 嵌入向量存储为 BLOB，JS 端计算余弦相似度（无需 sqlite-vec 扩展）
- 两种搜索结果自动融合并打分排序

**Embedding 服务**

- 封装 AI SDK `embed()` / `embedMany()`，支持 OpenAI text-embedding-3-small
- 自动使用配置的 OpenAI Profile（含 baseUrl 代理支持）
- 嵌入生成失败时优雅降级为纯文本搜索

**Agent 记忆工具**

- `memory_store`：存储事实/偏好到长期记忆（自动生成嵌入）
- `memory_search`：混合搜索长期记忆（关键词 + 语义）
- `memory_delete`：删除指定记忆
- 工具组 `group:memory` 支持批量策略控制
- 仅在 `config.memory.enabled = true` 时注入工具

**Memory API**

- `GET /api/memory` — 列表查询（agentId 筛选 + 分页）
- `GET /api/memory/search` — 混合搜索
- `POST /api/memory` — 手动创建记忆
- `PATCH /api/memory/:id` — 更新记忆（重新生成嵌入）
- `DELETE /api/memory/:id` — 删除记忆

## 2026-03-09: 通道健康监控 + 自动重连

- `ChannelManager` 新增 `startHealthMonitor()` / `stopHealthMonitor()`
- 30 秒周期检查所有适配器状态，检测到 `error` 或 `disconnected` 自动重连
- 指数退避：连续失败后逐步延长重试间隔（1→2→4→8→16 个周期），上限 15 个周期
- 成功重连后重置退避计数
- `disconnectAll()` 自动停止健康监控
- 网关启动时自动开启，无需额外配置

## 2026-03-09: Cron 定时任务系统

**CronService 后端**

- 新增 `cron/` 模块：基于 cron-parser 的定时任务调度器
- 30 秒 tick 间隔评估所有任务的执行时机
- 任务执行：调用 Agent 运行提示词，收集文本结果，投递到配置的目标通道
- 支持手动触发、启用/禁用、运行状态跟踪
- 配置热更新：config 变更时自动刷新调度

**Cron API**

- `GET /api/cron` — 获取所有任务及运行状态
- `POST /api/cron` — 创建任务（写入 config）
- `PATCH /api/cron/:id` — 更新任务
- `DELETE /api/cron/:id` — 删除任务
- `POST /api/cron/:id/run` — 手动触发执行

**Cron 页面**

- 任务列表：显示 ID、cron 表达式、Agent、提示词摘要、下次/上次执行时间
- 启用/禁用切换、手动运行（带结果展示）、编辑、删除
- 创建/编辑模态框：任务 ID、cron 表达式、Agent 选择器、提示词
- 15 秒轮询刷新任务状态

## 2026-03-09: 通道系统 + Telegram 适配器

**通道系统基础设施**

- 新增 `channels/` 模块：类型定义、能力声明（dock）、适配器接口
- `ChannelManager` 管理所有通道适配器的生命周期和消息路由
- 消息流：入站消息 → DM 策略检查 → 路由解析（含身份链接）→ Agent 执行 → 分块回复
- 通道能力声明（dock.ts）：Telegram/Discord/Slack/WebChat 各自能力矩阵
- DM 策略执行：open / allowlist / pairing 三种模式
- ownerOnly 判定：WebChat 默认 owner，外部通道按 ownerIds 配置

**Telegram 适配器**

- 基于 grammY SDK 实现完整的 Telegram Bot 适配器
- 支持私聊和群组消息，群组中仅响应 @提及和回复
- 自动剥离 @botname 文本，保留纯用户消息
- 多 Bot 账号支持，每个账号独立实例
- 启动时自动连接已配置且启用的 Telegram Bot

**Channels 页面**

- 展示所有已配置通道的连接状态（绿/灰/黄/红指示灯）
- 支持手动连接/断开操作
- 10 秒轮询刷新状态
- 显示通道类型图标、账号 ID、启用状态

**Channels API 升级**

- 列表接口返回真实连接状态（从 ChannelManager 获取）
- 新增 `POST /:type/:accountId/connect` 和 `disconnect` 操作端点
- 新增 `GET /:type/:accountId` 查看通道详情和能力

## 2026-03-09: 模型故障转移 + Sessions 页面 + ownerOnly 工具限制

**模型故障转移（ModelManager）**

- 新增 `ModelManager` 类，替代原有的 `resolveModel` 硬编码函数
- 支持多 Auth Profile 轮换：按配置顺序尝试，失败后自动切换下一个
- 冷却机制：连续失败 3 次后进入 60 秒冷却期，冷却期间自动跳过
- 成功时重置失败计数，冷却到期后自动恢复
- 集成到 `AgentRuntime`，streamText 执行成功/失败时自动上报
- `GatewayContext` 共享单例 `ModelManager`

**Sessions 管理页面**

- 新增独立的 Sessions 页面，支持浏览所有会话
- 按 Agent 筛选 + 关键词搜索（标题、会话键、对端名称）
- 分页浏览，显示消息数、Token 用量、最后活跃时间
- 点击会话可跳转到 Chat 页面继续对话
- 删除会话功能

**ownerOnly 工具限制**

- `createToolset` 新增 `isOwner` 参数
- 非 owner 调用时自动过滤高风险工具（shell、file_write、file_edit）
- WebChat 前端默认视为 owner，外部通道默认非 owner
- `AgentRuntime.run()` 新增 `isOwner` 和 `channelId` 参数

**API 字段名修正**

- 统一前端接口字段为 camelCase（与 Drizzle ORM 输出一致）
- 修正 Chat 页面的 `tool_calls` → `toolCalls`、`message_count` → `messageCount` 等
