# 2026-03-10 修复 Tauri 桌面端白屏问题

## 问题现象

Tauri 桌面应用构建安装后，窗口完全白屏，无任何 UI 渲染。

## 根因分析

白屏由 **三个独立问题** 叠加导致：

### 1. Service Worker 拦截请求返回 HTML（MIME 类型错误）

**错误信息：**
```
Failed to load module script: Expected a JavaScript-or-Wasm module script
but the server responded with a MIME type of "text/html".
```

**原因：** `main.tsx` 注册了 PWA Service Worker，SW 的 fetch handler 拦截了所有请求。在 Tauri WebView (`tauri.localhost`) 中，SW 缓存了 `index.html`，当浏览器请求 JS 模块时，SW 从缓存返回了 HTML 内容，导致 MIME 类型不匹配。

**修复：** 在 Tauri 环境中跳过 SW 注册：
```tsx
// main.tsx
if ("serviceWorker" in navigator && !("__TAURI_INTERNALS__" in window)) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
}
```

### 2. CORS 策略阻止 API 请求

**错误信息：**
```
Access to fetch at 'http://localhost:18789/api/system/setup' from origin
'http://tauri.localhost' has been blocked by CORS policy
```

**原因：** Tauri v2 WebView 的 origin 是 `http://tauri.localhost`，而服务端 CORS 白名单只包含开发服务器地址 (`localhost:1420`、`localhost:5173`)。所有 API 请求被浏览器 CORS 策略拦截。

**修复：** 在 `app.ts` CORS 配置中添加 Tauri origin：
```ts
cors({
    origin: [
        "http://localhost:1420",
        "http://localhost:5173",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ],
})
```

### 3. 前端页面渲染依赖 API 响应

`SetupGuard` 组件在 `useEffect` 中调用 `/api/system/setup`，如果请求失败（CORS 阻止），`needsSetup` 保持 `null`，组件返回 `null`（loading 状态），整个页面永远空白。

这不是 bug，但它放大了 CORS 问题的影响——任何 API 不可用都会导致白屏而非错误提示。

## 修改文件

| 文件 | 改动 |
|------|------|
| `packages/web/src/main.tsx` | Tauri 环境跳过 SW 注册 |
| `packages/server/src/app.ts` | CORS 白名单增加 `tauri.localhost` |
| `packages/web/vite.config.ts` | 移除 `base: "./"` 回归默认值 |

## 调试过程中的其他改动（前序提交已包含）

- `src-tauri/Cargo.toml`: 添加 `devtools` feature
- `src-tauri/src/lib.rs`: 开启 `window.open_devtools()` 以便调试
- `src-tauri/tauri.conf.json`: `global-shortcut` 设为 `null`、构建目标排除 AppImage
- `packages/web/src/App.tsx`: Tauri 模式使用 `HashRouter`、自动启动 gateway

## 经验总结

1. **Tauri v2 WebView origin 是 `tauri.localhost`**，不是 `localhost`。后端 CORS 必须显式允许。
2. **PWA Service Worker 在桌面 WebView 中有害**：SW 的缓存策略会干扰 Tauri 的资产协议。
3. **DevTools 是 Tauri 调试的关键**：白屏问题需要 `devtools` feature + `open_devtools()` 才能看到真实错误。
4. **不要同时修多个问题**：SW 和 CORS 是独立问题，应逐个排查验证。
