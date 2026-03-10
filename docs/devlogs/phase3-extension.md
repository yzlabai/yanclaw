# Phase 3 — P3 扩展功能

## 2026-03-09: Tauri 桌面壳

- 初始化 Tauri v2 项目，配置窗口（1200×800）、系统托盘、NSIS/WiX 安装包
- IPC 命令：`get_auth_token`、`get_gateway_port`、`start_gateway`、`stop_gateway`、`is_gateway_running`
- 系统托盘菜单：显示窗口 / 退出
- 集成插件：global-shortcut（全局快捷键）、updater（自动更新）、single-instance（单实例）、shell、process
- 前端 Tauri 集成模块 `lib/tauri.ts`：`isTauri()` 检测 + IPC 包装函数
- Gateway 进程由 Tauri 通过 `bun run` 子进程启动/管理

## 2026-03-09: Discord 适配器

- 基于 discord.js v14 实现完整 Discord Bot 适配器
- 支持 DM + Guild 消息 + Thread，Guild 中仅响应 @提及
- 自动提取文件附件（image/file）、成员角色 ID
- 长消息自动分段发送（2000 字符限制，优先在换行处拆分）
- 网关启动时自动连接已配置且启用的 Discord Bot
- 移除 gateway.ts 中的 `TODO: Discord adapter` 占位

## 2026-03-09: 会话自动清理

- `SessionStore.pruneStale(days)` 删除超过指定天数未更新的会话（消息级联删除）
- `runSessionCleanup()` 在 Gateway 启动时自动执行，按 `session.pruneAfterDays`（默认 90 天）清理
- 同时触发过期媒体文件清理
- 启动顺序：插件 → 通道 → Cron → 清理

## 2026-03-09: 插件系统

- 完整插件架构：定义 → 发现 → 加载 → 注册 → 钩子执行
- 插件类型：Tool（新增工具）、Channel（新增通道）、Hook（消息/工具调用钩子）
- `PluginRegistry`：管理已加载插件，工具命名空间隔离（`pluginId.toolName`）
- `PluginLoader`：扫描 `~/.yanclaw/plugins/` + 自定义目录，动态 `import()` 加载
- 5 个生命周期钩子：`onGatewayStart`/`onGatewayStop`/`onMessageInbound`/`beforeToolCall`/`afterToolCall`
- 配置 `plugins.enabled` 按 ID 启用/禁用，`plugins.dirs` 附加扫描目录
- API 端点 `GET /api/plugins` 列出已加载插件
- 启动顺序调整：插件加载 → 通道连接 → Cron 启动

## 2026-03-09: Bearer Token 认证中间件

- 新增 `middleware/auth.ts`：Hono 中间件，验证 `Authorization: Bearer <token>`
- Token 在 Gateway 启动时自动生成（crypto.randomBytes 32 字节 hex），写入 `~/.yanclaw/auth.token`
- 免认证端点：`GET /api/system/health`、`GET /api/system/setup`
- WebSocket 升级请求跳过认证检查
- 中间件挂载在 `/api/*` 路由上（在 CORS 之后）
- 前端 `apiFetch()` 统一注入 Authorization 头
- Token 获取优先级：Tauri IPC → localStorage 缓存
- 所有页面的 `fetch()` 调用统一替换为 `apiFetch()`，消除 API_BASE 重复定义

## 2026-03-09: 执行审批系统

- 新增 `approvals/manager.ts`：ApprovalManager 管理审批生命周期
- 审批流程：Agent 工具调用 → 检查是否需要审批 → 创建 DB 记录 + WebSocket 广播 → 等待用户响应或超时
- 三种审批模式：`off`（直接执行）、`on-miss`（不在 safeBins 中需审批）、`always`（全部需审批）
- Shell 工具自动提取命令二进制名称，与 safeBins 白名单比对
- 超时机制：默认 5 分钟无响应自动拒绝
- WebSocket `approval.respond` 方法完整实现（取代 TODO 占位）
- WebSocket 广播事件：`approval.request`（请求审批）、`approval.decision`（审批结果）
- REST API：`GET /api/approvals`（列表查询）、`POST /api/approvals/:id/respond`（响应审批）
- ApprovalManager 集成到 GatewayContext，AgentRuntime 传递到 createToolset

## 2026-03-09: Google AI 提供商支持

- 安装 `@ai-sdk/google`，ModelManager 新增 Google Gemini 模型解析
- 模型 ID 以 `gemini-` 前缀自动路由到 Google 提供商
- 支持多 Profile 故障转移 + 冷却恢复（与 Anthropic/OpenAI 一致）
- 支持自定义 baseUrl（代理兼容）
- 前端所有模型选择器添加 Google 选项组（Gemini 2.5 Pro/Flash、2.0 Flash）
- Onboarding 向导新增 Google 提供商按钮
- Settings 页面新增 Google AI API Key 输入框

## 2026-03-09: WebChat 文件拖拽上传

- Chat 页面支持拖拽文件到聊天区域，自动上传到 `/api/media/upload`
- 输入框左侧新增附件按钮（Paperclip 图标），点击打开文件选择器
- 附件预览栏显示文件名、大小，可逐个移除
- 拖拽时显示蓝色高亮覆盖层提示 "Drop files here"
- 上传完成后将媒体 URL 作为 `imageUrls` 传递给 `sendChatMessage`
- `api.ts` 新增 `uploadMedia()` 函数，`sendChatMessage` 新增可选 `imageUrls` 参数
- 修复 `deleteSession` 仍使用原始 `fetch()` 而非 `apiFetch()` 的遗漏

## 2026-03-09: 会话归档导出

- 新增 `GET /api/sessions/:key/export?format=json|md` 导出端点
- JSON 格式：完整会话元数据 + 消息列表 + 导出时间戳
- Markdown 格式：标题 + 元信息 + 按角色分段的消息内容（含工具调用）
- 响应头设置 `Content-Disposition: attachment` 触发浏览器下载
- Sessions 页面每行新增导出按钮（Download 图标），点击下载 JSON 文件

## 2026-03-09: 记忆预热

- 会话首次消息时，自动搜索相关记忆（向量 + FTS 混合搜索，最多 5 条）
- 搜索结果作为 "Relevant memories" 块注入系统提示词末尾
- 仅在 `config.memory.enabled` 且新会话时触发
- 向量嵌入生成失败时自动降级为 FTS 纯文本搜索
- 整个预热过程异常不影响正常对话流程

## 2026-03-09: 间隔/单次调度模式

- CronTask 新增 `mode` 字段：`cron`（默认）、`interval`、`once`
- `interval` 模式：支持 "30s"、"5m"、"2h"、"1d" 等持续时间字符串
- `once` 模式：支持 ISO 日期字符串或时间戳，执行后自动移除
- `parseDuration()` 辅助函数解析持续时间字符串为毫秒
- Cron 页面新增 Mode 选择器，Schedule 输入框根据模式切换类型和提示
- 任务列表显示非 cron 模式的紫色标签

## 2026-03-09: 记忆自动索引

- 新增 `MemoryAutoIndexer` 类，监听配置目录中的文件变化
- 支持 `.txt`/`.md`/`.json`/`.csv`/`.yaml` 等文本文件类型（100KB 以内）
- 启动时全量扫描目录，运行时通过 `fs.watch` 增量索引
- 自动生成嵌入向量（失败时仅存文本），标记 `source: "auto"` + `tags: ["auto-indexed", "file"]`
- 去重检查：FTS 搜索文件名避免重复索引
- 配置项 `memory.indexDirs` 指定监听目录列表
- Gateway 启动第 9 步调用 `startMemoryIndexer()`

## 2026-03-09: 全局快捷键绑定

- Tauri `setup()` 中注册 Ctrl+Shift+Y 全局快捷键
- 按下快捷键：显示窗口 + 取消最小化 + 聚焦
- 使用 `tauri_plugin_global_shortcut` 的 `on_shortcut` API
- 注册失败仅记录警告，不阻止应用启动

## 2026-03-09: 托盘状态指示

- 系统托盘菜单新增 "Gateway: Connected/Disconnected" 状态项（不可点击）
- 每 15 秒通过 TCP 连接检测 Gateway 端口是否可达
- 动态更新托盘 tooltip（"YanClaw - Connected" / "YanClaw - Disconnected"）
- tokio 异步后台任务执行健康检查，不阻塞 UI

## 2026-03-09: JSON-RPC subscribe

- WebSocket `subscribe` 方法：传入 `topics` 数组订阅事件，支持通配符（`chat.*`、`approval.*`、`*`）
- WebSocket `unsubscribe` 方法：取消指定订阅
- `broadcastEvent` 根据客户端订阅过滤推送，未订阅的客户端仍接收所有事件（向后兼容）
- `topicMatches` 支持精确匹配和 `prefix.*` 前缀通配符

## 2026-03-09: 插件 Worker 隔离

- `PluginDefinition` 新增 `isolated?: boolean` 字段
- `PluginWorkerHost` 类：管理 Worker 线程生命周期 + 工具调用的 RPC 通信
- Worker 内部通过 `eval` 代码动态 `import()` 加载插件入口
- 工具调用通过 `postMessage`/`onMessage` 通信，30 秒超时
- `isolatePlugin()` 将插件工具替换为 Worker 代理版本
- `PluginLoader` 自动检测 `isolated: true` 并启用 Worker 隔离
- Worker 退出时自动拒绝所有 pending 调用

## 2026-03-09: 媒体处理

- `MediaStore.thumbnail()` — 使用 sharp 生成缩略图（可配置尺寸和格式）
- `MediaStore.processImage()` — 图片缩放、格式转换、质量压缩
- `MediaStore.extractPdfText()` — 使用 pdf-parse 提取 PDF 文本内容
- 所有处理函数懒加载依赖（`await import()`），缺失依赖时优雅降级
- 新增 API 端点：`GET /api/media/:id/thumbnail`、`POST /api/media/:id/process`、`GET /api/media/:id/text`

## 2026-03-09: Docker 沙箱隔离 (F3.5)

- `createDockerShellTool()` — 在 Docker 容器内执行 shell 命令
- 安全限制：`--memory`、`--cpus`、`--pids-limit 100`、`--security-opt no-new-privileges`
- 网络隔离：默认 `--network none`，可配置
- 工作目录挂载：支持只读/读写模式
- `isDockerAvailable()` — 运行时检测 Docker 是否可用
- 配置集成：`tools.exec.sandbox` 节点控制是否启用及参数
- `createToolset()` 根据 `sandbox.enabled` 自动选择 Docker shell 或原生 shell

## 2026-03-09: Code Review 安全加固

全面审查所有新增功能代码，共发现 49 项问题（9 CRITICAL / 15 HIGH / 25 MEDIUM）。

### 已修复 CRITICAL 问题

| 文件 | 问题 | 修复方式 |
|------|------|----------|
| `memory/auto-indexer.ts` | `searchFts()` 未 await，重复检查失效 | 添加 `await` |
| `agents/tools/docker-shell.ts` | 超时后 timer 未清理，进程资源泄漏 | try-finally + timedOut 标志 |
| `plugins/worker-host.ts` | Worker error 事件不清理 pending 请求 | error 回调中 reject 所有 pending |
| `media/store.ts` | 无文件大小限制，可 DoS | 添加 50MB `MAX_UPLOAD_SIZE` 校验 |

### 第二轮修复（HIGH 级别）

| 文件 | 问题 | 修复方式 |
|------|------|----------|
| `routes/sessions.ts` | JSON.parse(toolCalls) 无 try-catch | 添加 try-catch 兜底 |
| `pages/Chat.tsx` | JSON.parse(toolCalls) 无 try-catch + 文件无校验 | try-catch + 50MB/10 文件限制 |
| `lib/api.ts` | uploadMedia 无超时 | AbortController 60 秒超时 + 错误信息解析 |
| `lib.rs` | health check 无 TCP 超时 + 子进程 stdio 泄漏 | tokio::time::timeout 3s + Stdio::null() |

### 第三轮修复（MEDIUM 级别）

| 文件 | 问题 | 修复方式 |
|------|------|----------|
| `media/store.ts` | sharp/pdf-parse 处理无超时保护 | `withTimeout()` 包装，30 秒超时 |
| `worker-host.ts` | 超时只 reject 不终止 Worker | 超时时调用 `worker.terminate()` |
| `auto-indexer.ts` | indexed Set 无上限 + 扩展名解析无兜底 | 10K 上限 + `lastIndexOf` 返回 -1 时跳过 |
| `cron/service.ts` | delivery 失败不上报 | 失败信息追加到 `lastResult` 字段 |

### 已知待改进（LOW 级别）

- **media/store.ts**：MIME 类型未验证 magic bytes（信任客户端 Content-Type）
- **worker-host.ts**：Worker 代码使用 `eval: true` + `JSON.stringify` 注入风险（仅受信任插件路径）
- **Tauri lib.rs**：home 目录回退到 /tmp 不安全（极端 edge case，HOME 几乎总是存在）

## 2026-03-10: 自动更新 + 安装包分发

- Tauri updater 配置 GitHub Releases 端点，Windows passive 安装模式
- IPC 命令 `check_for_updates` / `install_update`，含下载进度日志
- 托盘菜单新增 "Check for Updates" 项，异步检查并通过事件通知前端
- 前端 `tauri.ts` 新增 `checkForUpdates()` / `installUpdate()` 包装函数
- 修复 Tauri v2 API 兼容问题：`tray.menu()` 改用 `TrayState` 管理状态、`ShortcutEvent.state` 字段访问、`Emitter` trait 导入
- Bundle 配置已支持全平台：NSIS（多语言）、WiX、dmg、AppImage
- 发布前需生成签名密钥对并替换 `tauri.conf.json` 中的 `pubkey`

## 2026-03-10: 单元测试基础设施

- 安装 Vitest，配置 `vitest.config.ts`（路径别名 + 测试文件范围）
- **路由解析测试** (`routing/resolve.test.ts`) — 13 个用例：默认路由、通道匹配、peer 优先级、guild/roles 匹配、dmScope/sessionKey 构建、identity 解析
- **工具策略测试** (`agents/tools/policy.test.ts`) — 14 个用例：ownerOnly 判断、3 层 allow/deny 策略、group 展开、通道级覆盖
- **配置 Schema 测试** (`config/schema.test.ts`) — 8 个用例：默认值填充、agent/sandbox/cron/memory/routing/channel 校验、无效值拒绝
- 共 35 个测试全部通过
