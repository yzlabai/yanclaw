# 后台运行 — 需求分析

## 目标

关闭窗口后应用继续在后台运行（类似 Docker Desktop / Ollama），通过系统托盘图标可以重新打开窗口或退出。支持 CLI 查看状态和管理。

---

## 1. 现状分析

### 1.1 当前行为

| 行为 | 现状 | 问题 |
|------|------|------|
| 点击窗口关闭按钮 | 窗口关闭，应用退出 | Gateway 子进程成为孤儿进程，不会被清理 |
| 系统托盘 | ✅ 已实现（Show Window / Check Updates / Quit） | "Quit" 没有调用 `stop_gateway()`，直接 `app.exit(0)` |
| Gateway 生命周期 | 有 `start_gateway` / `stop_gateway` IPC | `stop_gateway` **从未被调用**，前端和关闭事件都没有触发 |
| 全局快捷键 | Ctrl+Shift+Y 唤起窗口 | ✅ 正常工作，已支持 show + unminimize + focus |
| 单实例守卫 | ✅ 已实现 | 第二次启动时聚焦已有窗口 |
| DevTools | 生产环境也会打开 | 应该仅在开发模式打开 |

### 1.2 关键文件

- `src-tauri/src/lib.rs` — Tauri 主逻辑（托盘、IPC、快捷键）
- `src-tauri/tauri.conf.json` — 窗口、托盘、打包配置
- `packages/web/src/lib/tauri.ts` — 前端 IPC 封装
- `packages/web/src/App.tsx` — SetupGuard，自动启动 Gateway

### 1.3 Gateway 架构

Gateway 作为 `tokio::process::Child` 运行在 Tauri 管理的子进程中：
- **启动**：App.tsx SetupGuard 调用 `startGateway()` → IPC `start_gateway` → 启动 bun/compiled binary
- **停止**：IPC `stop_gateway` → `child.kill()` (SIGKILL)
- **健康检查**：托盘每 15 秒 TCP 连接 gateway 端口，更新状态

---

## 2. 需求定义

### 2.1 核心需求：关闭窗口 → 最小化到托盘

**行为描述**：
1. 用户点击窗口关闭按钮（×）→ **窗口隐藏**，不退出应用
2. Gateway 子进程继续运行
3. 系统托盘图标保持可见，tooltip 显示运行状态
4. 通过以下方式恢复窗口：
   - 点击托盘图标
   - 托盘菜单 → "Show Window"
   - 全局快捷键 Ctrl+Shift+Y（已实现）
   - 再次启动应用（单实例守卫已实现，会唤起窗口）

**真正退出方式**：
- 托盘菜单 → "Quit"

### 2.2 优雅退出

**行为描述**：
1. 用户点击 "Quit" → 先调用 `POST /api/system/shutdown` 让 Gateway 优雅关闭（断开渠道、flush 数据）
2. 等待 Gateway 进程退出（超时 5 秒后 force kill）
3. 然后 `app.exit(0)`

> **注意**：当前 `stop_gateway` IPC 直接 `child.kill()` 发 SIGKILL，Gateway 无法优雅清理。应改为先通过 HTTP API 请求关闭，超时才 force kill。

### 2.3 托盘菜单改进

当前菜单：
```
Gateway: Connected ✓
──────────────────
Show Window
Check for Updates
Quit
```

建议菜单：
```
Gateway: Connected ✓
──────────────────
Show Window
──────────────────
Start Gateway          // 仅在 Gateway 未运行时可用
Stop Gateway           // 仅在 Gateway 运行时可用
Restart Gateway
──────────────────
Check for Updates
──────────────────
Quit
```

### 2.4 现有代码问题修复

1. **DevTools**：当前 `lib.rs` 在 `setup` 中无条件调用 `window.open_devtools()`，生产环境应该去掉
2. **Show Window 缺 unminimize**：托盘菜单 "Show Window" 只调了 `show()` + `set_focus()`，缺少 `unminimize()`，最小化后唤起仍是最小化状态
3. **`GET /api/system/status` 已存在**：`routes/system.ts` 已有此端点，只需增强返回内容（加 uptime、PID、渠道连接状态、内存条目数），不需要新建

---

## 3. 实施方案

### 3.1 拦截窗口关闭事件（核心）

在 `src-tauri/src/lib.rs` 的 `setup` 回调中注册窗口事件监听：

```rust
let window = app.get_webview_window("main").unwrap();
window.on_window_event(move |event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();   // 阻止默认关闭
        window.hide().unwrap(); // 隐藏到托盘
    }
});
```

这是整个功能的**核心**，仅需几行代码。Tauri v2 原生支持 `CloseRequested` 事件和 `api.prevent_close()`。

### 3.2 托盘图标点击唤起窗口

当前托盘图标点击无反应，需要注册点击事件：

```rust
tray.on_tray_icon_event(|tray, event| {
    if let TrayIconEvent::Click { .. } = event {
        let window = tray.app_handle().get_webview_window("main").unwrap();
        window.show().unwrap();
        window.unminimize().unwrap();
        window.set_focus().unwrap();
    }
});
```

### 3.3 优雅退出

修改 Quit 菜单项处理：

```rust
"quit" => {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let port = get_gateway_port().await.unwrap_or(18789);

        // 1. 先尝试 HTTP 优雅关闭
        let client = reqwest::Client::new();
        let _ = client.post(format!("http://127.0.0.1:{}/api/system/shutdown", port))
            .send().await;

        // 2. 等待进程退出（最多 5 秒）
        let state = handle.state::<GatewayState>();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if tokio::time::Instant::now() > deadline { break; }
            if let Ok(mut guard) = state.process.lock() {
                if let Some(ref mut child) = *guard {
                    if child.try_wait().ok().flatten().is_some() { break; }
                } else { break; }
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        // 3. 超时则 force kill
        if let Ok(mut guard) = state.process.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill().await;
            }
        }

        // 4. 退出
        handle.exit(0);
    });
}
```

### 3.4 Gateway 控制菜单项

新增 Start/Stop/Restart 菜单项，根据 Gateway 运行状态动态启用/禁用。状态更新复用现有的 15 秒健康检查循环。

### 3.5 DevTools 条件开启

```rust
#[cfg(debug_assertions)]
if let Some(window) = app.get_webview_window("main") {
    window.open_devtools();
}
```

---

## 4. 工作量评估

| 项目 | 改动范围 | 复杂度 |
|------|---------|--------|
| 窗口关闭 → 隐藏 | `lib.rs` 加 ~5 行 | 低 |
| 托盘点击唤起窗口 | `lib.rs` 加 ~8 行 | 低 |
| 优雅退出 | `lib.rs` 修改 Quit 处理 ~10 行 | 低 |
| 托盘菜单增强 | `lib.rs` 菜单构建 + 状态更新 ~40 行 | 中 |
| DevTools 条件化 | `lib.rs` 改 1 行 | 低 |

**总体评估**：改动集中在 `src-tauri/src/lib.rs` 一个文件，无需修改前端代码。核心功能（关闭→隐藏）仅需 5 行 Rust 代码，整体复杂度低。

---

## 5. Ollama 架构参考

### 5.1 Ollama 的 Client-Server 分离模式

Ollama 采用干净的 **CLI ↔ HTTP Server** 分离架构：

| 组件 | 职责 | 实现 |
|------|------|------|
| `ollama serve` | HTTP Server，监听 `127.0.0.1:11434` | Go + Gin |
| `ollama list/ps/run/...` | Thin CLI Client，所有命令翻译为 HTTP 请求 | Go + Cobra |
| Ollama Desktop App | 管理 server 进程 + 系统托盘 | Electron wrapper |

**关键模式**：CLI 从不直接操作，一切通过 REST API 代理。桌面应用、CLI、第三方工具共用同一套 API。

### 5.2 Ollama REST API

```
GET  /api/tags     → 列出本地模型（ollama list）
GET  /api/ps       → 列出运行中的模型（ollama ps）
POST /api/generate → 文本生成
POST /api/chat     → 多轮对话
GET  /              → 健康检查（返回 "Ollama is running"）
```

### 5.3 平台服务管理

| 平台 | 方式 | 自动启动 |
|------|------|---------|
| Windows | Auto-start 快捷方式 + 系统托盘 | 开机启动 |
| macOS | launchd plist | 登录启动 |
| Linux | systemd service (`Restart=always`) | 开机启动 |

### 5.4 Ollama 的不足（我们应避免的）

- **没有 `ollama stop-server` 命令**，只能通过系统托盘退出或 `kill` 进程（社区长期抱怨的问题）
- **`ollama stop <model>` 仅卸载模型**，不停止服务器
- 缺少 `ollama status` 命令查看服务器整体状态

### 5.5 适用于 YanClaw 的模式

1. **统一 REST API 为唯一集成点**：CLI、桌面应用、第三方工具都通过 `localhost:18789` 的 HTTP API 交互
2. **CLI 作为 Thin HTTP Client**：`yanclaw status`、`yanclaw channels` 等命令直接映射到现有 API 路由
3. **健康检查端点**：`GET /api/system/status` 返回服务器状态、运行时间、连接的渠道等
4. **优雅关停 API**：`POST /api/system/shutdown`（Ollama 缺少的，我们要做好）
5. **进程守护 + 自动重启**：Gateway 子进程异常退出后自动重启（类似 systemd `Restart=always`）

---

## 6. CLI 状态管理

### 6.1 需求：命令行查看和管理

除了桌面应用的托盘菜单，还需要支持通过命令行查看运行状态和管理服务，方便：
- 无桌面环境的 Linux 服务器部署
- 开发调试
- 自动化脚本
- 快速查看状态而无需打开 GUI

### 6.2 CLI 命令设计

参考 Ollama 和 Docker CLI 的设计，规划以下命令：

```bash
# 服务管理
yanclaw serve              # 前台启动 Gateway（类似 ollama serve）
yanclaw start              # 后台启动 Gateway（daemon 模式）
yanclaw stop               # 优雅停止 Gateway
yanclaw restart             # 重启 Gateway

# 状态查看
yanclaw status             # 显示运行状态概览
yanclaw channels           # 列出渠道连接状态
yanclaw sessions           # 列出活跃会话

# 配置
yanclaw config             # 显示当前配置摘要
```

### 6.3 `yanclaw status` 输出示例

```
YanClaw Gateway v0.2.0
Status:   Running ✓
Uptime:   2h 15m
Port:     18789
PID:      12345

Channels:
  telegram   Connected ✓   (2 accounts)
  slack      Connected ✓   (1 account)
  discord    Disconnected ✗

Agents:
  main       claude-sonnet-4-20250514

Active Sessions: 3
Memory:    Enabled (1,247 entries)
```

### 6.4 实现方式

**方案：Bun CLI 脚本 + 现有 HTTP API**

CLI 作为 thin client，复用 Gateway 已有的 REST API：

| CLI 命令 | 映射的 API |
|----------|-----------|
| `yanclaw status` | `GET /api/system/status`（需新增） |
| `yanclaw channels` | `GET /api/system/status` 中的渠道部分 |
| `yanclaw sessions` | `GET /api/sessions` |
| `yanclaw stop` | `POST /api/system/shutdown`（需新增） |
| `yanclaw serve` | 直接 `import` 并运行 server |
| `yanclaw start` | 启动 server 子进程（detach） |

需要新增/增强的 API：
1. **`GET /api/system/status`**（已存在，需增强）：增加 uptime、PID、渠道连接状态、活跃会话数、内存条目数
2. **`POST /api/system/shutdown`**（需新增）：优雅关停，先断开渠道 → flush 数据 → 退出

CLI 入口文件：`packages/server/src/cli.ts`，使用轻量参数解析（无需 Cobra 那样的重框架，简单的 `process.argv` 分发即可）。

### 6.5 与 Tauri 桌面应用的关系

```
┌─────────────────────────────────────┐
│  Tauri Desktop App                  │
│  ┌──────────┐  ┌──────────────────┐ │
│  │ WebView  │  │ System Tray      │ │
│  │ (React)  │  │ Start/Stop/Quit  │ │
│  └────┬─────┘  └────┬─────────────┘ │
│       │              │               │
│       ▼              ▼               │
│  ┌──────────────────────────────┐   │
│  │ Gateway (bun 子进程)         │   │
│  │ HTTP Server :18789           │   │
│  └──────────────┬───────────────┘   │
└─────────────────┼───────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
    ▼             ▼             ▼
 CLI Client   第三方工具    浏览器直连
 yanclaw      curl/API     localhost:18789
 status
```

桌面应用管理 Gateway 进程生命周期，CLI 通过 HTTP API 查询状态。两者互不干扰，共用同一个 Gateway 实例。

---

## 7. 工作量评估

| 项目 | 改动范围 | 复杂度 |
|------|---------|--------|
| 窗口关闭 → 隐藏 | `lib.rs` 加 ~5 行 | 低 |
| 托盘点击唤起窗口 | `lib.rs` 加 ~8 行 | 低 |
| 优雅退出 | `lib.rs` 修改 Quit 处理 ~10 行 | 低 |
| 托盘菜单增强 | `lib.rs` 菜单构建 + 状态更新 ~40 行 | 中 |
| DevTools 条件化 | `lib.rs` 改 1 行 | 低 |
| Gateway 自动重启 | `lib.rs` 子进程监控 ~20 行 | 低 |
| Status API | `routes/system.ts` 新增端点 ~50 行 | 低 |
| Shutdown API | `routes/system.ts` + `gateway.ts` ~30 行 | 低 |
| CLI 入口 | 新建 `cli.ts` ~100 行 | 中 |

**总体评估**：
- **Phase 1（桌面体验）**：Tauri 改动集中在 `lib.rs`，~60 行，复杂度低
- **Phase 2（CLI + API）**：Server 侧新增 status/shutdown API + CLI 入口，~180 行，复杂度中

建议分两个 PR 交付。

---

## 8. 参考

- **Ollama**：CLI ↔ HTTP Server 分离架构，但缺少 stop-server 命令（我们要做好）
- **Docker Desktop**：关闭窗口后在托盘运行，托盘菜单可以控制 Docker Engine 启停
- **Tauri v2 `WindowEvent::CloseRequested`**：原生支持窗口隐藏
- 当前全局快捷键 Ctrl+Shift+Y 已实现窗口唤起，关闭到托盘后自然可用
