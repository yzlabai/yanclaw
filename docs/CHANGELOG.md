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

## 时间线

### Phase 5 — 安全加固 + Code Review（2026-03-09）

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
