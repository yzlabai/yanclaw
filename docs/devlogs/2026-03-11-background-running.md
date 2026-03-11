# 2026-03-11 后台运行 + CLI 管理

## 概述

实现关闭窗口后应用继续在后台运行（类似 Docker Desktop / Ollama），新增 CLI 工具查看状态和管理 Gateway。

对应计划文档：`docs/plans/2026-03-11-background-running.md`

## 改动摘要

### 1. 窗口关闭 → 隐藏到托盘

**文件：** `src-tauri/src/lib.rs`

- 在 `setup` 中注册 `on_window_event`，拦截 `CloseRequested` 事件
- 调用 `api.prevent_close()` + `window.hide()`，窗口隐藏但应用不退出
- Gateway 子进程继续运行，托盘图标保持可见

### 2. 托盘交互增强

**文件：** `src-tauri/src/lib.rs`

- **托盘图标点击**：注册 `on_tray_icon_event`，点击托盘图标直接唤起窗口
- **菜单增强**：从 3 项扩展到 7 项 + 分隔符
  - Gateway 状态显示
  - Show Window
  - Start / Stop / Restart Gateway（根据运行状态动态启用/禁用）
  - Check for Updates
  - Quit
- **TrayState 扩展**：存储 start/stop/restart 菜单项引用，健康检查循环中动态更新启用状态
- **Show Window 修复**：补上缺失的 `unminimize()` 调用
- 提取 `show_window()` 公用函数，消除重复代码

### 3. 优雅退出

**文件：** `src-tauri/src/lib.rs`

- Quit 从直接 `app.exit(0)` 改为异步优雅退出流程：
  1. `POST /api/system/shutdown` 让 Gateway 自行断开渠道、flush 数据
  2. 轮询进程状态，等待最多 5 秒
  3. 超时才 force kill
  4. 最后 `app.exit(0)`
- `stop_gateway` IPC 命令同样改用优雅退出
- 解决 `std::sync::Mutex` guard 不能跨 `.await` 的问题：在 await 前 drop guard，force kill 时先 `take()` 再 await

### 4. DevTools 仅开发模式

**文件：** `src-tauri/src/lib.rs`

- `open_devtools()` 改为 `#[cfg(debug_assertions)]` 条件编译，生产包不再打开 DevTools

### 5. Status API 增强

**文件：** `packages/server/src/routes/system.ts`

- `GET /api/system/status` 从简单计数扩展为完整运行状态：
  - 新增：version、uptime、PID、port
  - 渠道：按类型分组，包含连接状态和账号数
  - Agent 列表：id、name、model
  - 内存：启用状态 + 条目总数
- 模块级 `startedAt` 变量记录启动时间

### 6. Shutdown API

**文件：** `packages/server/src/routes/system.ts`

- 新增 `POST /api/system/shutdown`
- 先返回 HTTP 响应，然后异步执行：断开所有渠道 → 停止健康监控 → 停止 Cron → `process.exit(0)`

### 7. CLI 工具

**新建文件：** `packages/server/src/cli.ts`

- 命令：`serve`（前台启动）、`start`（后台 daemon）、`stop`（优雅停止）、`restart`、`status`、`help`
- Thin client 模式：所有管理命令通过 HTTP API 代理，与桌面应用共用同一个 Gateway 实例
- `status` 命令格式化输出：版本、运行状态、uptime、渠道、Agent、会话数、内存
- 根 `package.json` 添加 `yanclaw` 脚本快捷方式

### 8. 依赖变更

- `src-tauri/Cargo.toml`：新增 `reqwest` 用于 HTTP 优雅关闭请求
- `packages/server/package.json`：添加 `bin` 配置指向 CLI 入口

## 测试阶段修复

### 9. CLI Auth Token 集成

**文件：** `packages/server/src/cli.ts`

- 测试时 CLI 命令返回 401，原因：服务端 `/api/*` 路由受 `authMiddleware` 保护，CLI 未携带 token
- 新增 `getAuthHeaders()` 读取 `~/.yanclaw/auth.token`，`apiFetch()` 封装自动附加 `Authorization: Bearer` 头
- 与 Tauri 桌面端共用同一个 token 文件，保持一致

### 10. cron-parser v5 API 修复

**文件：** `packages/server/src/cron/service.ts`

- 启动报错：`parseExpression is not a function`
- 原因：cron-parser v5 移除了 `parseExpression` 导出，改为 `CronExpressionParser.parse()`
- 修复：`import { CronExpressionParser } from "cron-parser"` + `CronExpressionParser.parse(schedule)`
- 此为已有 bug（与本次功能无关），顺带修复

## 验证结果

- `bun run check`：通过（0 errors）
- `bun run build`：server + web 均通过
- `bun run test`：91 tests 全部通过
- `cargo check`：通过
- 实际启动测试：Gateway 正常启动，CLI `status` 命令成功返回运行状态
