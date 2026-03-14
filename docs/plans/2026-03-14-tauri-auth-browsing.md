# Phase 6 — 认证浏览：CDP 方案分析与实现

> 日期：2026-03-14 | 状态：已实现

## 问题

Agent 无法访问需登录的网站（GitHub private repo、Notion、内网系统等）。用户不愿把 cookie/token 直接给 Agent。

## 方案选择

| 方案 | 实现量 | 需要 Tauri | 覆盖率 | 安全性 |
|------|--------|-----------|--------|--------|
| Chrome 扩展 | 大 | 否 | 95% | 中（扩展沙箱历史漏洞多） |
| Tauri WebView Relay | 大 | 是 | 95% | 好（域名白名单） |
| **CDP 连接用户浏览器** | **小** | **否** | **95%** | **中（暴露浏览器上下文）** |
| Service API Token | 小 | 否 | 80% | 最好（scope 精确） |

**选择 CDP 方案**：Playwright 原生支持 `connectOverCDP()`，改动量最小，不依赖 Tauri，纯 server 模式也能用。

## 实现

### 原理

```
用户启动 Chrome: chrome --remote-debugging-port=9222
                          ↑
Playwright.connectOverCDP("http://127.0.0.1:9222")
                          ↓
复用用户浏览器的 default context（含所有 cookie/登录态）
                          ↓
Agent 的 browser_navigate 工具直接访问已登录页面
```

### 改动文件

| 文件 | 改动 |
|------|------|
| `packages/server/src/config/schema.ts` | 新增 `tools.browser.cdpUrl` 配置项 |
| `packages/server/src/agents/tools/browser.ts` | `ensureBrowser()` 支持 CDP 分支 |
| `packages/server/src/agents/tools/index.ts` | 传递 `cdpUrl` 到 browser tool |

### 配置

```json5
{
  tools: {
    browser: {
      // 设置后 browser_navigate/screenshot/action 连接用户浏览器
      cdpUrl: "http://127.0.0.1:9222"
    }
  }
}
```

### 用户启动 Chrome

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222

# Windows
chrome.exe --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222
```

### 行为差异

| 维度 | 无 cdpUrl（默认） | 有 cdpUrl |
|------|-------------------|-----------|
| 连接方式 | `chromium.launch()` 无头 | `connectOverCDP()` 连接已运行浏览器 |
| Cookie/登录态 | 无 | 有（用户的） |
| Context | 新建隔离 context | 复用 default context |
| 关闭行为 | 关闭整个浏览器进程 | 仅断开连接，不关闭用户浏览器 |
| 适用场景 | 公开页面、JS 渲染 | 需登录的私有内容 |

### 安全注意

- CDP 端口仅绑定 `127.0.0.1`，外部无法访问
- Agent 通过 `browser_navigate` 能访问用户浏览器的所有已登录站点
- 建议配合 `tools.policy.deny` 或 `tools.byChannel` 限制非 owner 使用
- `closeBrowser()` 在 CDP 模式下只断开连接，不会关闭用户的浏览器
