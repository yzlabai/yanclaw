# Phase 4 — 构建与发布修复

## 2026-03-10: Tauri 桌面应用构建与运行修复 (v0.1.1 → v0.1.2)

本次集中修复了从构建到安装运行的全链路问题，确保 Tauri 桌面应用可以开箱即用。

### 问题 1：Server 构建失败

**现象**：`bun run build` 时 `@yanclaw/server` 报错，无法 resolve `electron`、`chromium-bidi` 等模块。

**原因**：`bun build` 尝试打包 `playwright-core` 内部所有模块，而 `electron` 和 `chromium-bidi` 是 Playwright 的可选依赖，本地并未安装。

**修复**：在 server build 命令中标记为 external：
```
bun build src/index.ts --outdir dist --target bun \
  --external playwright --external playwright-core \
  --external electron --external chromium-bidi
```

### 问题 2：GitHub Actions Linux 构建失败

**现象**：Ubuntu 22.04 上 `apt-get install` 报 `held broken packages` 错误。

**原因**：同时安装了 `libappindicator3-dev` 和 `libayatana-appindicator3-dev`，两者互相 Conflicts。

**修复**：移除 `libappindicator3-dev`，Tauri v2 只需要 `libayatana-appindicator3-dev`。

### 问题 3：安装后无法运行 — Server 未打包

**现象**：NSIS/MSI 安装后启动应用，Gateway 无法启动。

**原因**：
- Tauri 只打包了前端（`packages/web/dist`），未包含后端 server 代码
- `start_gateway` 依赖系统安装了 `bun` 命令，普通用户不会有

**修复**：使用 `bun build --compile` 将 server 编译为独立可执行文件（内含 bun runtime，约 120MB），通过 Tauri `bundle.resources` 打包进安装包（NSIS 压缩后约 31MB）。

关键改动：
- `packages/server/package.json` 新增 `build:compile` 脚本
- `tauri.conf.json` 的 `beforeBuildCommand` 调用 `build:compile`
- `tauri.conf.json` 添加 `"resources": ["server/*"]`
- `src-tauri/src/lib.rs` 的 `find_server_entry()` 改为查找编译后的二进制文件，支持 Windows/macOS/Linux 三种资源路径
- `start_gateway` 直接执行编译后的二进制，不再调用 `bun run`

### 问题 4：App 启动 Crash — global-shortcut 配置

**现象**：双击 exe 闪退，错误信息 `Error deserializing 'plugins.global-shortcut': invalid type: map, expected unit`。

**原因**：`tauri.conf.json` 中 `"global-shortcut": {}` 空对象无法反序列化为 unit type。

**修复**：改为 `"global-shortcut": null`。

### 问题 5：App 启动 Crash — Tokio Runtime

**现象**：修复问题 4 后仍然闪退，错误 `there is no reactor running, must be called from the context of a Tokio 1.x runtime`。

**原因**：`setup_tray` 函数中使用 `tokio::spawn` 启动健康检查定时任务，但在 Tauri 的 `setup` 回调中 tokio reactor 尚未就绪。

**修复**：将 `tokio::spawn` 替换为 `tauri::async_runtime::spawn`，后者由 Tauri 管理 runtime 生命周期。

### 问题 6：Biome Lint CI 失败

**现象**：CI 上 `bun run check` 报 6 个错误。

**原因**：
- Biome 扫描了 `tmp/`、`.claude/`、`src-tauri/gen/` 等不应检查的目录
- `vitest.config.ts` import 顺序不符合规范
- Tailwind CSS 4 的 `@plugin`、`@theme` 指令 Biome CSS parser 不认识

**修复**：
- `biome.json` 的 `files.includes` 排除 `!tmp`、`!.claude`、`!**/src-tauri/gen`
- 修复 import 排序，添加 `biome-ignore` 注释
- CSS overrides 中启用 `allowWrongLineComments`

### 问题 7：macOS x86_64 CI 构建

**潜在问题**：`macos-latest` 是 ARM runner，`bun build --compile` 只能编译当前架构的二进制。

**修复**：macOS x86_64 target 改用 `macos-13`（Intel runner）。

### 版本变更

- v0.1.0 → v0.1.1：版本号升级 + 初步修复
- v0.1.1 → v0.1.2：完成全部修复，可正常构建、安装、运行
