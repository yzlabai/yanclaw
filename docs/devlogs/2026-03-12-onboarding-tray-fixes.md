# 2026-03-12 桌面应用 Bug 修复合集

## 概述

修复 Windows 桌面应用的一系列 Bug：Onboarding 循环、托盘菜单、Ollama 无 Profile 报错、双托盘图标、控制台窗口弹出、Rate Limit 过严导致前端崩溃。

## Bug 1：Onboarding 配置完成后无限循环

### 现象

在 Onboarding 中选择 Ollama 作为模型提供商，跳过 Channel 配置，点击完成进入主界面后，页面又自动跳回 Onboarding。

### 原因

`SetupGuard` 组件（`packages/web/src/App.tsx`）在 `useEffect` 中只在组件首次挂载时（`[]` 空依赖数组）调用 `/api/system/setup` 检查是否需要引导。Onboarding 完成后通过 `navigate("/")` 跳转，但 `SetupGuard` 仍缓存着 `needsSetup = true`，不会重新请求，导致又被重定向回 `/onboarding`。

### 修复

将 `SetupGuard` 拆分为两个 `useEffect`：

1. **启动 Effect**（`[]` 依赖）：仅负责 Tauri 模式下启动 Gateway 并等待就绪，完成后设置 `gatewayReady = true`
2. **检查 Effect**（`[gatewayReady, location.pathname]` 依赖）：Gateway 就绪后以及每次路径变化时重新请求 `/api/system/setup`

这样 Onboarding 完成跳转到 `/` 时，路径变化触发重新检查，服务端返回 `needsSetup = false`，正常进入主界面。

### 改动文件

- `packages/web/src/App.tsx` — `SetupGuard` 组件

## Bug 2：Windows 托盘右键无菜单

### 现象

Windows 上关闭窗口后应用在后台运行，托盘图标可见，但右键点击没有任何菜单弹出，无法退出应用。

### 原因

`TrayIconBuilder`（`src-tauri/src/lib.rs`）的两个问题：

1. **菜单触发方式**：Tauri 默认在左键点击时显示菜单，但 `on_tray_icon_event` 捕获了所有 `Click` 事件并调用 `show_window()`，拦截了菜单显示
2. **缺少右键配置**：Windows 用户习惯右键打开托盘菜单，但未配置 `.show_menu_on_left_click(false)`

### 修复

- 添加 `.show_menu_on_left_click(false)`：菜单改为右键触发（Windows 标准行为）
- `on_tray_icon_event` 中匹配 `MouseButton::Left`：仅左键点击唤起窗口，右键留给系统菜单

### 改动文件

- `src-tauri/src/lib.rs` — `setup_tray()` 函数，导入 `MouseButton`

## Bug 3：Ollama 对话报错 "No auth profiles configured"

### 现象

Onboarding 配置 Ollama 后进入聊天，发送消息报错：`No auth profiles configured for provider "ollama"`

### 原因

Onboarding 为 Ollama 保存 `profiles: []`（因为 `needsApiKey = false`），但 `ModelManager.selectProfile()` 对空 profiles 数组直接抛异常，不区分 Provider 类型。而 Ollama 本身不需要 API Key。

### 修复

`selectProfile()` 新增 `providerType` 参数。当 `type === "ollama"` 且 profiles 为空时，返回合成的 `{ id: "default", apiKey: "ollama" }`。所有 3 个调用点（`resolveByModelId`、`resolveEmbedding`、`findProviderForModel`）均传入 `providerConfig.type`。

### 改动文件

- `packages/server/src/agents/model-manager.ts` — `selectProfile()` 及 3 个调用点
- `packages/server/src/agents/model-manager.test.ts` — 新增 "ollama works without profiles" 测试

## Bug 4：Windows 双托盘图标

### 现象

应用启动后托盘区出现两个 YanClaw 图标：一个有右键菜单和 "Connected" 状态，另一个无菜单仅显示 "YanClaw"。

### 原因

`tauri.conf.json` 的 `trayIcon` 配置自动创建了一个默认托盘图标（无菜单事件），同时 `setup_tray()` 代码又通过 `TrayIconBuilder::new()` 创建了第二个。

### 修复

- 移除 `tauri.conf.json` 中的 `trayIcon` 配置
- 在 `setup_tray()` 中用 `Image::from_bytes(include_bytes!("../icons/icon.png"))` 显式加载图标
- `Cargo.toml` 添加 `image-png` feature 支持 PNG 解码

### 改动文件

- `src-tauri/tauri.conf.json` — 移除 `trayIcon` 段
- `src-tauri/src/lib.rs` — `TrayIconBuilder` 添加 `.icon(icon)`，导入 `Image`
- `src-tauri/Cargo.toml` — tauri features 添加 `image-png`

## Bug 5：Windows 弹出控制台窗口

### 现象

启动桌面应用时，除了主窗口外还弹出一个黑色终端窗口（yanclaw-server.exe 的控制台）。

### 原因

`tokio::process::Command::spawn()` 在 Windows 上默认创建可见的控制台窗口。

### 修复

添加 Windows 平台条件编译，设置 `CREATE_NO_WINDOW` (0x08000000) creation flag：

```rust
#[cfg(target_os = "windows")]
command.creation_flags(0x08000000);
```

### 改动文件

- `src-tauri/src/lib.rs` — `start_gateway()` 函数

## Bug 6：Rate Limit 过严导致前端崩溃

### 现象

页面加载后控制台大量 `429 Too Many Requests` 错误，随后 `e.map is not a function` TypeError 导致页面白屏。

### 原因

1. 全局 Rate Limit 设为 60 req/min，对桌面应用的前端请求量（页面加载、SetupGuard 检查、各组件数据获取、MCP 10 秒轮询）来说太低
2. 429 响应返回 `{error: "Too many requests"}` 对象，前端多个页面直接对 API 响应调 `.map()`，未检查是否为数组，导致 TypeError

### 修复

1. **放宽 Rate Limit**（`packages/server/src/app.ts`）：
   - 全局：60 → 300 req/min
   - Chat：10 → 20 req/min
   - Approvals：30 → 60 req/min
2. **MCP 页面防护**（`packages/web/src/pages/McpServers.tsx`）：
   - `fetchServers` 添加 `r.ok` 检查，非 200 响应走 reject
   - `setServers` 前添加 `Array.isArray(data)` 防护
   - 轮询间隔从 10 秒放宽到 30 秒

### 改动文件

- `packages/server/src/app.ts` — Rate Limit 参数调整
- `packages/web/src/pages/McpServers.tsx` — 响应防护 + 轮询频率

## 改动文件汇总

| 文件 | 改动 |
|------|------|
| `packages/web/src/App.tsx` | SetupGuard 拆分双 Effect |
| `packages/web/src/pages/McpServers.tsx` | API 响应防护、轮询降频 |
| `packages/server/src/app.ts` | Rate Limit 放宽 |
| `packages/server/src/agents/model-manager.ts` | Ollama 空 profiles 支持 |
| `packages/server/src/agents/model-manager.test.ts` | 新增 Ollama 测试 |
| `src-tauri/src/lib.rs` | 托盘图标重构、CREATE_NO_WINDOW、左/右键分离 |
| `src-tauri/tauri.conf.json` | 移除重复 trayIcon 配置 |
| `src-tauri/Cargo.toml` | 添加 image-png feature |
