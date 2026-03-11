# 后台运行 + CLI 管理 — 开发计划

对应需求文档：`docs/todos/2026-03-11-background-running.md`

---

## 概览

实现关闭窗口后应用继续在后台运行（类似 Docker Desktop / Ollama），并提供 CLI 工具查看状态和管理 Gateway。

**交付物**：
1. 窗口关闭 → 隐藏到托盘（Gateway 持续运行）
2. 托盘菜单增强（Gateway 启停控制）
3. 优雅退出（Quit 时先停止 Gateway）
4. Gateway 异常退出自动重启
5. Status / Shutdown API
6. CLI 工具（`yanclaw status/serve/start/stop`）
7. DevTools 仅开发模式

分两个 Phase 交付：
- **Phase 1**：桌面体验（Tauri 侧，Step 1-4）
- **Phase 2**：CLI + API（Server 侧，Step 5-7）

---

## Phase 1：桌面体验

### Step 1: 窗口关闭 → 隐藏到托盘（核心）

**修改文件:** `src-tauri/src/lib.rs`

在 `setup` 回调中注册窗口关闭事件监听：

```rust
let window = app.get_webview_window("main").unwrap();
let window_clone = window.clone();
window.on_window_event(move |event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window_clone.hide();
    }
});
```

行为变更：
- 点击窗口关闭按钮（×）→ 窗口隐藏，不退出应用
- Gateway 子进程继续运行
- 系统托盘图标保持可见

**验收标准**：
- [ ] 关闭窗口后应用不退出
- [ ] Gateway 健康检查仍在运行
- [ ] 通过 Ctrl+Shift+Y 可以恢复窗口

---

### Step 2: 托盘交互增强

**修改文件:** `src-tauri/src/lib.rs`

#### 2.1 托盘图标点击唤起窗口

当前托盘图标点击无反应，注册点击事件：

```rust
tray.on_tray_icon_event(|tray, event| {
    if let TrayIconEvent::Click { .. } = event {
        if let Some(window) = tray.app_handle().get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
});
```

#### 2.2 托盘菜单增加 Gateway 控制

当前菜单：
```
Gateway: Connected ✓
Show Window
Check for Updates
Quit
```

改为：
```
Gateway: Connected ✓
──────────────────
Show Window
──────────────────
Start Gateway          // 仅在 Gateway 未运行时启用
Stop Gateway           // 仅在 Gateway 运行时启用
Restart Gateway
──────────────────
Check for Updates
──────────────────
Quit
```

实现要点：
- 新增 IPC 命令 `restart_gateway`（内部先 stop 再 start）
- 菜单项启用/禁用状态跟随 Gateway 运行状态
- 状态更新复用现有的 15 秒健康检查循环，每次检查后更新菜单项

**验收标准**：
- [ ] 点击托盘图标可唤起隐藏的窗口
- [ ] Start/Stop/Restart 菜单项按状态正确启用/禁用
- [ ] Start Gateway 可以在手动 Stop 后重新启动

---

### Step 3: 优雅退出

**修改文件:** `src-tauri/src/lib.rs`

修改 Quit 菜单项处理，退出前先通过 HTTP API 让 Gateway 优雅关闭：

```rust
"quit" => {
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let port = get_gateway_port().await.unwrap_or(18789);

        // 1. 先尝试 HTTP 优雅关闭（让 Gateway 断开渠道、flush 数据）
        let client = reqwest::Client::new();
        let _ = client.post(format!("http://127.0.0.1:{}/api/system/shutdown", port))
            .send().await;

        // 2. 等待进程退出（最多 5 秒）
        let state = handle.state::<GatewayState>();
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        loop {
            if tokio::time::Instant::now() > deadline { break; }
            if let Ok(mut guard) = state.process.lock() {
                match guard.as_mut().and_then(|c| c.try_wait().ok()) {
                    Some(Some(_)) | None => break,
                    _ => {}
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        // 3. 超时则 force kill
        if let Ok(mut guard) = state.process.lock() {
            if let Some(ref mut child) = *guard {
                let _ = child.kill().await;
            }
        }

        handle.exit(0);
    });
}
```

> **注意**：当前 `stop_gateway` IPC 直接 `child.kill()` 发 SIGKILL，Gateway 无机会优雅清理。必须先通过 HTTP 请求 shutdown，超时才 force kill。这也意味着 Phase 2 的 Shutdown API（Step 6）是 Phase 1 优雅退出的前置依赖，需要提前实现。

同时修复现有 Show Window 菜单项缺少 `unminimize()` 的问题。

**验收标准**：
- [ ] 点击 Quit 后 Gateway 进程被终止（无孤儿进程）
- [ ] 退出过程不超过 5 秒

---

### Step 4: Gateway 异常退出自动重启 + DevTools 条件化

**修改文件:** `src-tauri/src/lib.rs`

#### 4.1 子进程监控

在 `start_gateway` 完成后，spawn 一个 tokio task 监控子进程退出状态：

```rust
// 在 start_gateway 中，启动后监控
tokio::spawn(async move {
    loop {
        if let Ok(mut guard) = state.0.lock() {
            if let Some(child) = guard.as_mut() {
                match child.try_wait() {
                    Ok(Some(status)) => {
                        // 进程已退出，尝试重启
                        eprintln!("[tauri] Gateway exited with {status}, restarting...");
                        // 重启逻辑
                        break;
                    }
                    Ok(None) => {} // 仍在运行
                    Err(_) => break,
                }
            }
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    }
});
```

自动重启策略：
- 异常退出后等 3 秒重启
- 最多连续重启 3 次
- 连续失败后停止重启，更新托盘状态显示错误

#### 4.2 DevTools 仅开发模式

```rust
#[cfg(debug_assertions)]
if let Some(window) = app.get_webview_window("main") {
    window.open_devtools();
}
```

**验收标准**：
- [ ] Gateway 进程被 kill 后自动重启
- [ ] 连续失败 3 次后停止重启
- [ ] 生产包不打开 DevTools

---

## Phase 2：CLI + API

### Step 5: Status API

**修改文件:** `packages/server/src/routes/system.ts`

#### 5.1 增强 `GET /api/system/status`

现有端点已返回 agents/channels/sessions/cron 计数，需增强为完整运行状态：

```typescript
systemApp.get("/status", async (c) => {
    const ctx = c.get("gateway");
    const config = ctx.configStore.get();

    const channels: Record<string, { connected: boolean; accounts: number }> = {};
    for (const [name, adapter] of ctx.channelManager.adapters) {
        channels[name] = {
            connected: adapter.isConnected(),
            accounts: adapter.accountCount(),
        };
    }

    const sessionCount = ctx.sessionStore.getActiveCount();
    const memoryCount = ctx.memoryStore?.getEntryCount() ?? 0;

    return c.json({
        version: VERSION,
        status: "running",
        uptime: process.uptime(),
        port: config.gateway?.port ?? 18789,
        pid: process.pid,
        channels,
        agents: config.agents.map(a => ({ id: a.id, name: a.name, model: a.model })),
        sessions: { active: sessionCount },
        memory: {
            enabled: !!config.memory?.enabled,
            entries: memoryCount,
        },
    });
});
```

需要新增的辅助方法：
- `ChannelAdapter` 基类增加 `isConnected()` 和 `accountCount()` 方法（或通过 HealthMonitor 获取）
- `SessionStore` 增加 `getActiveCount()` 方法
- `MemoryStore` 增加 `getEntryCount()` 方法

#### 5.2 版本常量

在 `packages/server/src/version.ts` 中导出版本号（从 package.json 读取或硬编码）。

**验收标准**：
- [ ] `GET /api/system/status` 返回完整状态信息
- [ ] 渠道连接状态准确反映实际情况
- [ ] 响应时间 < 50ms（纯内存查询）

---

### Step 6: Shutdown API

**修改文件:** `packages/server/src/routes/system.ts`, `packages/server/src/gateway.ts`

#### 6.1 `POST /api/system/shutdown`

```typescript
systemApp.post("/shutdown", async (c) => {
    const ctx = c.get("gateway");

    // 先返回响应
    setTimeout(async () => {
        await ctx.channelManager.stopAll();
        ctx.configStore.stopWatcher();
        process.exit(0);
    }, 100);

    return c.json({ message: "Shutting down..." });
});
```

#### 6.2 Gateway 增加 `stopGateway()` 函数

```typescript
export async function stopGateway(ctx: GatewayContext): Promise<void> {
    console.log("[gateway] Shutting down...");
    await ctx.channelManager.stopAll();
    ctx.configStore.stopWatcher();
    // flush pending writes if any
}
```

**验收标准**：
- [ ] `POST /api/system/shutdown` 触发优雅关停
- [ ] 所有渠道适配器断开连接
- [ ] 进程正常退出

---

### Step 7: CLI 工具

**新建文件:** `packages/server/src/cli.ts`

#### 7.1 CLI 入口

```typescript
#!/usr/bin/env bun

const API_BASE = process.env.YANCLAW_API ?? "http://localhost:18789";

const commands: Record<string, () => Promise<void>> = {
    serve: cmdServe,
    start: cmdStart,
    stop: cmdStop,
    restart: cmdRestart,
    status: cmdStatus,
    channels: cmdChannels,
    sessions: cmdSessions,
    config: cmdConfig,
    help: cmdHelp,
};

const cmd = process.argv[2] ?? "help";
const handler = commands[cmd];
if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
}
await handler();
```

#### 7.2 核心命令实现

**`yanclaw serve`** — 前台启动 Gateway：
```typescript
async function cmdServe() {
    const { startServer } = await import("./index");
    await startServer();
}
```

**`yanclaw start`** — 后台启动 Gateway（daemon 模式）：
```typescript
async function cmdStart() {
    // 先检查是否已在运行
    try {
        const res = await fetch(`${API_BASE}/api/system/status`);
        if (res.ok) {
            console.log("Gateway is already running.");
            return;
        }
    } catch {}

    // 启动子进程（detach）
    const child = Bun.spawn(["bun", "run", import.meta.dir + "/index.ts"], {
        stdio: ["ignore", "ignore", "ignore"],
        detached: true,
    });
    child.unref();
    console.log(`Gateway started (PID: ${child.pid})`);
}
```

**`yanclaw stop`** — 优雅停止：
```typescript
async function cmdStop() {
    try {
        const res = await fetch(`${API_BASE}/api/system/shutdown`, { method: "POST" });
        if (res.ok) console.log("Gateway is shutting down...");
    } catch {
        console.error("Gateway is not running or unreachable.");
    }
}
```

**`yanclaw status`** — 状态概览：
```typescript
async function cmdStatus() {
    try {
        const res = await fetch(`${API_BASE}/api/system/status`);
        if (!res.ok) throw new Error();
        const data = await res.json();

        console.log(`YanClaw Gateway v${data.version}`);
        console.log(`Status:   Running ✓`);
        console.log(`Uptime:   ${formatUptime(data.uptime)}`);
        console.log(`Port:     ${data.port}`);
        console.log(`PID:      ${data.pid}`);
        console.log();

        console.log("Channels:");
        for (const [name, ch] of Object.entries(data.channels)) {
            const icon = ch.connected ? "✓" : "✗";
            const status = ch.connected ? "Connected" : "Disconnected";
            console.log(`  ${name.padEnd(12)} ${status} ${icon}   (${ch.accounts} accounts)`);
        }
        console.log();

        console.log("Agents:");
        for (const a of data.agents) {
            console.log(`  ${a.id.padEnd(12)} ${a.model}`);
        }
        console.log();

        console.log(`Active Sessions: ${data.sessions.active}`);
        if (data.memory.enabled) {
            console.log(`Memory:    Enabled (${data.memory.entries.toLocaleString()} entries)`);
        }
    } catch {
        console.log("YanClaw Gateway");
        console.log("Status:   Not Running ✗");
    }
}
```

#### 7.3 package.json bin 配置

在 `packages/server/package.json` 添加：

```json
{
    "bin": {
        "yanclaw": "./src/cli.ts"
    }
}
```

#### 7.4 根目录快捷脚本

在根 `package.json` 添加：

```json
{
    "scripts": {
        "yanclaw": "bun run packages/server/src/cli.ts"
    }
}
```

**验收标准**：
- [ ] `bun run yanclaw status` 正确显示运行状态
- [ ] `bun run yanclaw status` 在 Gateway 未运行时显示 "Not Running"
- [ ] `bun run yanclaw serve` 正确启动 Gateway
- [ ] `bun run yanclaw stop` 正确停止运行中的 Gateway
- [ ] `bun run yanclaw start` 后台启动 Gateway，重复执行提示已在运行

---

## 实施顺序与依赖

```
Phase 1（Tauri 桌面）
    Step 1 (窗口隐藏) ← 核心，无依赖
        ↓
    Step 2 (托盘增强) ← 依赖 Step 1 的隐藏行为
        ↓
    Step 3 (优雅退出) ← 可与 Step 2 并行
        ↓
    Step 4 (自动重启 + DevTools) ← 独立

Phase 2（CLI + API）
    Step 5 (Status API) ← 无依赖，可与 Phase 1 并行开发
        ↓
    Step 6 (Shutdown API) ← 可与 Step 5 并行
        ↓
    Step 7 (CLI 工具) ← 依赖 Step 5 + Step 6 的 API
```

**关键路径**：Step 6 (Shutdown API) → Step 3 (优雅退出) → Step 1 → Step 2

> **依赖发现**：Phase 1 的优雅退出（Step 3）依赖 Phase 2 的 Shutdown API（Step 6）。建议调整实施顺序：先做 Step 5+6（API），再做 Step 1-4（Tauri）。

---

## 风险与注意事项

| 风险 | 应对 |
|------|------|
| **Windows 下窗口隐藏行为差异** | Tauri v2 的 `hide()` 在 Windows 上测试正常，但需确认任务栏图标是否同步隐藏 |
| **Gateway 自动重启死循环** | 设置最大连续重启次数（3 次），超过后停止并更新托盘状态 |
| **CLI daemon 模式孤儿进程** | `yanclaw start` 使用 detached + unref，需确保 `yanclaw stop` 能可靠终止 |
| **Shutdown API 安全性** | 仅本地访问（127.0.0.1），且需要 auth token |
| **多实例冲突** | `yanclaw start` 先检查端口是否已被占用，避免重复启动 |

---

## 暂不实施（后续迭代）

| 功能 | 原因 |
|------|------|
| **开机自启动** | 需要平台特定实现（Windows 注册表、macOS launchd），独立迭代 |
| **systemd service 文件** | Linux 服务器部署场景，等 CLI 稳定后再做 |
| **CLI 配置编辑** | `yanclaw config set key=value`，等配置 API 完善后再做 |
| **CLI 日志查看** | `yanclaw logs --follow`，需要日志文件输出支持 |
| **远程管理** | CLI 连接远程 Gateway 实例，安全模型待设计 |
