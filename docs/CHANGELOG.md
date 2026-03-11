# YanClaw 开发日志

详细日志见 `docs/devlogs/` 目录。

## 功能完成总览

| 阶段 | 状态 | 内容 |
|------|------|------|
| P0 MVP | ✅ | Gateway、单 Agent 对话、流式输出、SQLite、配置系统、工具系统、WebChat |
| P1 核心 | ✅ | Telegram 通道、路由引擎、DM 策略、多 Agent、模型故障转移、上下文管理、Sessions/Channels 页面、ownerOnly |
| P2 完善 | ✅ | Slack/Discord 通道、Cron 定时任务、向量记忆、媒体管道、视觉支持、Playwright 浏览器、健康监控、Onboarding |
| P3 扩展 | ✅ | 插件系统、会话自动清理、Tauri 桌面壳（托盘/IPC/快捷键/更新/安装包） |
| P4 安全+审批 | ✅ | Bearer Token 认证、执行审批、Docker 沙箱、文件上传、会话导出、记忆预热/自动索引、Worker 隔离、媒体处理、全局快捷键、托盘状态 |
| v0.4.0 | ✅ | 桌面截图工具、Claude Code Agent SDK 运行时、双运行时架构、像素风 Logo |
| v0.3.0 | ✅ | 后台运行（关窗不退出）、托盘菜单增强、优雅退出、CLI 管理工具、Status/Shutdown API |

## 时间线

### v0.4.0 — 桌面截图 + Claude Code 运行时（2026-03-11）

- **桌面截图工具 (`screenshot_desktop`)**：macOS `screencapture` 集成，支持全屏和区域截图，返回 base64 data URL，ownerOnly
- **Claude Code Agent SDK 运行时**：`runtime: "claude-code"` 配置项，适配 `@anthropic-ai/claude-agent-sdk` query() API，支持会话恢复、MCP Server、子 Agent
- **双运行时架构**：Agent 可在 Vercel AI SDK 和 Claude Code Agent SDK 之间按需切换
- **前端 Agent 管理增强**：运行时选择器、Claude Code 配置面板、Agent 卡片 badge
- **像素风 Logo**：全新像素艺术风格 SVG 图标（三道爪痕）

### v0.3.0 — 后台运行 + CLI 管理（2026-03-11）

→ [详细日志](devlogs/2026-03-11-background-running.md)

- **窗口隐藏到托盘**：关闭窗口不退出，Gateway 继续后台运行（Ollama 风格）
- **托盘菜单增强**：状态显示、Start/Stop/Restart 动态启用/禁用、Check for Updates
- **优雅退出**：HTTP API 关闭 → 轮询进程退出 → 超时强杀
- **Status API 增强**：返回完整运行状态（版本、uptime、渠道、Agent、内存）
- **Shutdown API**：`POST /api/system/shutdown` 异步断开所有渠道后退出
- **CLI 工具**：`yanclaw serve/start/stop/restart/status/help`，thin client 模式
- **Tauri 白屏修复**：HashRouter + CORS tauri.localhost + 自动启动 Gateway
- **cron-parser v5 修复**：`parseExpression` → `CronExpressionParser.parse()`

### v0.2.0 — 模型系统重构 + Onboarding 改版（2026-03-10）

- 多 Provider 模型系统（Anthropic/OpenAI/Google）
- 2D 场景×偏好选择 + STT 支持
- Onboarding 和 Settings 页面改版

### Phase 6 — 纵深安全加固（2026-03-10）

参考 IronClaw 纵深防御架构，新增 10 个安全模块：

- **凭证加密存储 (Vault)**：AES-256-GCM 加密 API Key，machine-id 派生密钥，`$vault:key_name` 配置语法，CLI 迁移脚本
- **凭证泄漏检测 (LeakDetector)**：实时扫描 LLM 输出，检测已注册凭据前缀，命中即阻断
- **WebSocket 票据认证**：一次性 30 秒 ticket + `POST /api/ws/ticket` 端点，替代无法携带 header 的 WS 连接
- **滑动窗口速率限制**：内存 Map 实现，全局 60/min、chat 10/min、approval 30/min，auth token 优先做 key
- **提示注入防御 (Sanitize)**：`<tool_result>` 边界标记包裹所有工具结果 + 注入模式检测 + 系统提示安全后缀
- **数据流启发式 (DataFlow)**：shell 外泄检测（curl/wget/nc/scp/ssh）、敏感路径写入/读取规则
- **审计日志 (AuditLogger)**：SQLite 缓冲写入，查询 API `/api/audit`，自动按天数清理
- **异常频率检测 (AnomalyDetector)**：每工具每会话滑动窗口计数，warn/critical 分级
- **网络白名单 (SSRF)**：私有地址阻断、端口豁免（Ollama/self）、host 白名单，集成到 web_fetch
- **Token 自动轮转**：可配置间隔 + grace period 双 token 验证，文件先写再更新内存
- **能力模型 (Capabilities)**：preset（safe-reader/researcher/developer/full-access）或自定义能力数组，per-agent 配置
- **Symlink 防护**：file_read/write/edit 用 `realpath()` 二次校验，防止符号链接逃逸 workspace

Code Review 修复 13 项：vault 回退密钥持久化、leak detector 短凭据支持、token 轮转竞态、WS ticket 过期顺序、audit flush 先写后清、network 端口 NaN、tool 结果边界包裹、数据流规则扩展、rate limit IP 伪造、anomaly 内存泄漏、symlink 逃逸、注入正则误报、audit 查询 DoS

### Phase 5 — Code Review（2026-03-09）

→ [详细日志](devlogs/phase3-extension.md)

- **Code Review**：全面审查 49 项问题（9 CRITICAL / 15 HIGH / 25 MEDIUM）
- **修复 CRITICAL (4)**：auto-indexer searchFts 缺 await、docker-shell 超时资源泄漏、worker-host 错误恢复、MediaStore 文件大小限制
- **修复 HIGH (6)**：sessions/Chat JSON.parse 防护、uploadMedia 超时、health check TCP 超时、子进程 stdio、前端文件校验
- **修复 MEDIUM (4)**：media 处理超时保护、worker 超时终止、indexed Set 上限、cron delivery 失败上报

### Phase 4 — 安全 + 审批 + 扩展（2026-03-09）

→ [详细日志](devlogs/phase3-extension.md)

- **Bearer Token 认证**：auth 中间件、token 自动生成写文件、前端 `apiFetch()` 统一注入、免认证端点
- **执行审批系统**：ApprovalManager、三种审批模式、WebSocket 广播 + 响应、REST API、safeBins 白名单
- **Docker 沙箱**：createDockerShellTool 容器隔离、memory/CPU/PID 限制、网络隔离
- **WebChat 文件拖拽**：drag-and-drop 上传、附件预览、Paperclip 按钮
- **会话归档导出**：JSON/Markdown 两种格式导出、Content-Disposition 下载
- **记忆预热 + 自动索引**：新会话自动搜索相关记忆、目录文件自动索引入记忆库
- **间隔/单次调度**：Cron + interval + once 三种调度模式
- **插件 Worker 隔离**：Worker thread RPC 沙箱执行、30 秒超时
- **媒体处理**：缩略图生成、图片格式转换、PDF 文本提取
- **全局快捷键**：Ctrl+Shift+Y 显示/聚焦窗口
- **托盘状态**：Gateway 连接状态实时显示、15 秒健康检查
- **JSON-RPC 订阅**：topic 通配符过滤（chat.\*、approval.\*、\*）

### Phase 3 — P3 扩展功能（2026-03-09）

→ [详细日志](devlogs/phase3-extension.md)

- **Tauri 桌面壳**：Tauri v2 项目、IPC 命令、系统托盘、global-shortcut/updater/single-instance 插件
- **Discord 适配器**：discord.js v14，DM + Guild + Thread，@mention 过滤，长消息分段
- **会话自动清理**：启动时按 `session.pruneAfterDays` 清理过期会话 + 媒体
- **插件系统**：discovery → loader → registry → hooks，5 个生命周期钩子

### Phase 2 — P1/P2 核心功能（2026-03-09）

→ [详细日志](devlogs/phase2-core.md)

- **Onboarding 引导**：3 步向导（模型 → 通道 → 完成），首次启动自动跳转
- **Slack 适配器**：@slack/bolt Socket Mode，DM + Channel，@mention + 附件 + 线程
- **Playwright 浏览器**：navigate/screenshot/action 三工具，懒加载 Chromium 单例
- **媒体管道 + 视觉**：MediaStore 文件存储、Telegram 附件提取、多模态 Agent 支持
- **向量记忆**：FTS5 + 余弦相似度混合搜索，memory_store/search/delete 工具
- **通道健康监控**：30 秒周期检查 + 指数退避自动重连
- **Cron 定时任务**：CronService 调度器 + API + 页面
- **通道系统 + Telegram**：ChannelManager + grammY 适配器 + Channels 页面
- **模型故障转移**：多 Profile 轮换 + 冷却恢复
- **Sessions 页面**：会话浏览、筛选、搜索、分页
- **ownerOnly 工具限制**：非 owner 自动过滤高风险工具

### Phase 1 — P0 MVP + 基础 P1

→ [详细日志](devlogs/phase1-mvp.md)

- 数据库 ORM 迁移（Drizzle）、Chat UI（prompt-kit）、消息路由引擎
- 上下文窗口管理、Web 工具、多 Agent 管理
