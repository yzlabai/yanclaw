# YanClaw 桌面应用（Tauri）

> Tauri v2 Rust 桌面壳：系统托盘、IPC 命令、自动更新、全局快捷键。

---

## 1. 概述

YanClaw 桌面应用基于 Tauri v2 构建，将 Web 前端嵌入原生窗口，并通过 Rust 代码管理 Gateway 子进程的生命周期。相比 Electron，Tauri 具有更小的安装包体积、更快的启动速度和更低的内存占用。

---

## 2. 快速开始

### 开发

```bash
# 启动 Tauri 开发模式（自动启动 Vite + Rust）
bun run dev:tauri
```

### 构建

```bash
# 构建生产安装包
bun run build
bunx tauri build
```

构建链：Web 构建 → Server 编译为独立二进制 → Tauri 打包为安装程序。

### 构建产物

| 平台 | 格式 |
|------|------|
| Windows | NSIS (.exe) + MSI |
| macOS | DMG（Universal: aarch64 + x86_64） |
| Linux | DEB + RPM |

---

## 3. 架构

```
┌─────────────────────────────────────┐
│         Tauri Desktop Shell          │
│                                      │
│  ┌──────────┐  ┌─────────────────┐  │
│  │ 系统托盘  │  │   WebView       │  │
│  │  • 状态   │  │   (React 前端)  │  │
│  │  • 菜单   │  │   HashRouter    │  │
│  └─────┬────┘  └────────┬────────┘  │
│        │    IPC Commands  │          │
│        └────────┬─────────┘          │
│                 ↓                     │
│  ┌──────────────────────────────┐   │
│  │    Rust Backend (lib.rs)      │   │
│  │    • Gateway 进程管理         │   │
│  │    • 健康检查（15s 周期）     │   │
│  │    • 文件读取（auth.token）   │   │
│  │    • 自动更新                 │   │
│  └──────────────┬───────────────┘   │
│                 ↓                     │
│  ┌──────────────────────────────┐   │
│  │    Gateway 子进程 (Bun)       │   │
│  │    HTTP :18789 + WebSocket   │   │
│  └──────────────────────────────┘   │
└─────────────────────────────────────┘
```

---

## 4. IPC 命令

前端通过 `@tauri-apps/api` 调用 Rust 后端命令：

| 命令 | 说明 |
|------|------|
| `get_auth_token()` | 读取 `~/.yanclaw/auth.token` |
| `get_gateway_port()` | 从 config.json5 解析端口号 |
| `start_gateway()` | 启动 Gateway 子进程 |
| `stop_gateway()` | 优雅关闭（HTTP → 等待 → 强杀） |
| `is_gateway_running()` | 检查子进程状态 |
| `check_for_updates()` | 检查 GitHub Releases 新版本 |
| `install_update()` | 下载并安装更新 |

### 前端调用示例

```typescript
import { startGateway, getAuthToken, isTauri } from "@yanclaw/web/lib/tauri";

if (isTauri()) {
  await startGateway();
  const token = await getAuthToken();
}
```

---

## 5. Gateway 进程管理

### 启动

1. Tauri 启动后，`SetupGuard` 组件自动调用 `start_gateway()`
2. Rust 端查找 Server 二进制：
   - **生产**：`./server/yanclaw-server`（与应用捆绑）
   - **开发**：`bun run packages/server/src/index.ts`
3. 子进程 stdout/stderr 重定向到 `~/.yanclaw/server.log`
4. 前端轮询 `GET /api/system/health`（500ms 间隔，最长 10s）

### 关闭

```
1. HTTP POST /api/system/shutdown（带 auth token，3s 超时）
2. 等待进程退出（最长 5s）
3. 超时则强制终止
```

### 健康检查

- 每 15 秒 GET `/api/system/health`
- 更新托盘状态（Connected / Disconnected）
- 更新托盘菜单项可用状态

---

## 6. 系统托盘

### 菜单项

| 菜单 | 功能 |
|------|------|
| 状态行 | 显示 "Connected ✓" 或 "Disconnected" |
| 显示窗口 | 激活并聚焦主窗口 |
| 启动 Gateway | 启动子进程（运行中时禁用） |
| 停止 Gateway | 优雅关闭（未运行时禁用） |
| 重启 Gateway | 先停再启 |
| 检查更新 | 从 GitHub Releases 检查 |
| 退出 | 关闭 Gateway + 退出应用 |

### 行为

- **左键点击托盘图标**：显示/聚焦窗口
- **关闭窗口**：隐藏到托盘（不退出）
- **Tooltip**：显示当前连接状态

---

## 7. 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+Y` | 显示/聚焦主窗口 |

---

## 8. 自动更新

- **检查端点**：GitHub Releases `latest.json`
- **签名验证**：Public key 配置在 `tauri.conf.json`
- **安装方式**：Windows 静默模式（passive），macOS/Linux 标准更新
- 可通过托盘菜单手动检查，或前端调用 `checkForUpdates()`

---

## 9. 窗口配置

| 属性 | 值 |
|------|------|
| 默认尺寸 | 1200 × 800 |
| 最小尺寸 | 800 × 600 |
| 位置 | 居中 |
| 可调整大小 | 是 |
| 路由模式 | HashRouter（file:// 兼容） |

### CORS

WebView 的 origin 为 `tauri.localhost`，Server 端 CORS 配置：

```
http://localhost:1420       # Tauri 开发
http://localhost:5173       # Vite 开发
http://tauri.localhost      # Tauri WebView
https://tauri.localhost     # Tauri WebView (HTTPS)
```

---

## 10. 单实例保护

使用 `tauri-plugin-single-instance`，防止用户重复打开应用。重复启动时会激活已有窗口。

---

## 11. 开发调试

- **DevTools**：Debug 模式下按 F12 打开（`debug_assertions` 编译标志）
- **日志**：`tauri-plugin-log` 输出到控制台
- **Server 日志**：`~/.yanclaw/server.log`

---

## 12. Capabilities（权限）

在 `src-tauri/capabilities/default.json` 中声明：

| 权限 | 说明 |
|------|------|
| `core:default` | 基础窗口管理 |
| `shell:allow-open` | 打开浏览器链接 |
| `process:default` | 子进程管理 |
| `global-shortcut:default` | 全局快捷键注册 |
| `updater:default` | 自动更新 |

---

## 13. 依赖

| 包 | 版本 | 用途 |
|------|------|------|
| tauri | 2.10.3 | 核心框架 |
| tauri-plugin-log | 2 | 日志输出 |
| tauri-plugin-shell | 2 | 子进程管理 |
| tauri-plugin-process | 2 | 进程控制 |
| tauri-plugin-global-shortcut | 2 | 快捷键 |
| tauri-plugin-updater | 2 | 自动更新 |
| tauri-plugin-single-instance | 2 | 单实例保护 |
| tokio | 1 | 异步运行时 |
| reqwest | 0.12 | HTTP 客户端（优雅关闭） |

---

## 14. 关键源码位置

| 模块 | 路径 |
|------|------|
| Rust 入口 | `src-tauri/src/lib.rs` |
| Main | `src-tauri/src/main.rs` |
| 应用配置 | `src-tauri/tauri.conf.json` |
| Cargo 依赖 | `src-tauri/Cargo.toml` |
| 权限声明 | `src-tauri/capabilities/default.json` |
| 前端 IPC 封装 | `packages/web/src/lib/tauri.ts` |
| SetupGuard | `packages/web/src/App.tsx` |
