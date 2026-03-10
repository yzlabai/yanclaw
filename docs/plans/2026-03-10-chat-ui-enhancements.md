# Chat UI 增强 — 开发计划

对应评估文档：`docs/todos/2026-03-10-chat-ui-enhancements.md`

---

## Phase 1: File Attachments 下载链接（0.5-1d）✅ 已完成

### Step 1.1: 附件卡片组件

**文件:** `packages/web/src/components/prompt-kit/file-attachment.tsx`

新建 `<FileAttachment>` 组件：
- Props: `{ filename, size, mimeType, url, thumbnail? }`
- 图片类型：缩略图预览 + 点击放大
- 非图片类型：文件图标 + 文件名 + 大小 + 下载按钮
- 样式：`bg-card border border-border rounded-lg p-2`，与现有 Message 风格一致

### Step 1.2: 消息中渲染附件

**文件:** `packages/web/src/pages/Chat.tsx`

- `ChatMessage` 接口新增 `attachments?: { filename, size, mimeType, url }[]`
- 用户消息：上传的文件显示在消息气泡下方
- Assistant 消息：agent 生成的文件（来自 `file_write` 工具结果）渲染为附件卡片

### Step 1.3: 服务端 file_write 关联 media

**文件:** `packages/server/src/agents/tools.ts`

- `file_write` 工具执行成功后，调用 `MediaStore.store()` 保存副本
- `tool_result` 事件中携带 `mediaUrl` 字段
- 前端从 `tool_result` 中提取 `mediaUrl` → 追加到 assistant 消息的 `attachments`

---

## Phase 2: Dark/Light Theme（2-3d）✅ 已完成

### Step 2.1: 定义语义色彩 token

**文件:** `packages/web/src/index.css`

```css
@theme {
  /* 现有暗色值作为默认 */
  --color-background: oklch(0.145 0 0);
  --color-foreground: oklch(0.985 0 0);
  /* ... 其余现有变量 ... */
}

@media (prefers-color-scheme: light) {
  :root {
    --color-background: oklch(0.985 0 0);
    --color-foreground: oklch(0.145 0 0);
    --color-primary: oklch(0.55 0.2 260);
    --color-secondary: oklch(0.92 0.01 260);
    --color-muted: oklch(0.92 0.01 260);
    --color-card: oklch(0.97 0 0);
    --color-border: oklch(0.85 0 0);
    /* ... */
  }
}
```

### Step 2.2: 全局颜色替换

逐文件扫描，将硬编码颜色类替换为语义 token：

| 硬编码 | 替换为 |
|--------|--------|
| `bg-gray-950` | `bg-background` |
| `bg-gray-900` | `bg-card` 或 `bg-secondary` |
| `bg-gray-800` | `bg-muted` |
| `text-gray-100`, `text-white` | `text-foreground` |
| `text-gray-400`, `text-gray-500` | `text-muted-foreground` |
| `border-gray-700`, `border-gray-800` | `border-border` |

**涉及文件（全量扫描）：**
- `packages/web/src/pages/*.tsx` — Chat, Sessions, Channels, Agents, Settings, Onboarding
- `packages/web/src/components/prompt-kit/*.tsx` — 全部 prompt-kit 组件
- `packages/web/src/App.tsx` — 导航栏、布局容器

### Step 2.3: ThemeToggle 组件（可选）

**文件:** `packages/web/src/components/theme-toggle.tsx`

- 三态切换：System / Light / Dark
- `localStorage.setItem("theme", preference)`
- 通过 `document.documentElement.classList` 强制 `dark` / `light`
- 放在导航栏底部或 Settings 页

---

## Phase 3: Thought/Draft Panels（1-2d）✅ 已完成

### Step 3.1: 服务端捕获 reasoning 事件

**文件:** `packages/server/src/agents/runtime.ts`

在 `fullStream` 迭代中增加 `reasoning` case：

```typescript
case "reasoning":
  yield { type: "thinking", sessionKey, text: part.textDelta };
  break;
```

**文件:** `packages/shared/src/types.ts`

`AgentEvent` union 新增：
```typescript
| { type: "thinking"; sessionKey: string; text: string }
```

### Step 3.2: 前端 ThinkingPanel 组件

**文件:** `packages/web/src/components/prompt-kit/thinking-panel.tsx`

- 可折叠面板，默认收起，标题 "Thinking..."
- 流式追加 thinking 文本（斜体、`text-muted-foreground`、`bg-muted` 背景）
- 流式结束后标题变为 "Thought for Xs"（记录持续时间）
- 使用 Radix Collapsible（已有依赖）

### Step 3.3: Chat.tsx 集成

**文件:** `packages/web/src/pages/Chat.tsx`

- `ChatMessage` 新增 `thinking?: string`
- `onEvent` 回调处理 `thinking` 事件：追加到当前 assistant 消息的 `thinking` 字段
- 渲染顺序：ThinkingPanel → ToolCalls → MessageContent

---

## Phase 4: Live Steering — 双线程模式（3-4d）✅ 已完成

### Step 4.1: AbortSignal 支持 ✅

**文件:** `packages/server/src/agents/runtime.ts`

- `run()` params 新增 `signal?: AbortSignal`
- 传递给 `streamText({ ..., abortSignal: signal })`
- abort 时保存已输出的 `fullText` 到 session（标记 `[interrupted]`）
- `AgentEvent` 新增 `aborted` 类型：`{ type: "aborted"; sessionKey; partial }`

### Step 4.2: SteeringManager ✅

**新建文件:** `packages/server/src/agents/steering.ts`

- `SteeringManager` 类：每个 session 一个 `AbortController` + `pendingMessages[]`
- `register(sessionKey)` → 返回 `AbortSignal`
- `steer(sessionKey, message)` → 关键词分类意图（cancel / redirect / supplement）
- `dequeue(sessionKey)` → 取出下一条排队消息
- `unregister(sessionKey)` / `remove(sessionKey)` → 清理
- 意图分类：纯关键词匹配（中英文），无需小模型调用
  - cancel: "stop", "cancel", "停", "取消", "算了", "不用了" 等
  - redirect: "actually", "instead", "wait", "不对", "重新", "换个方向" 等
  - supplement: 默认（排队等当前回复完成后自动续跑）

### Step 4.3: HTTP + WebSocket 路由扩展 ✅

**文件:** `packages/server/src/routes/chat.ts`

- `/send`：集成 `chatSteering`，run 结束后自动 `dequeue()` 续跑，通过同一 NDJSON 流发送 `steering_resume` 事件
- `/steer`：新 POST 端点，调用 `chatSteering.steer()`
- `/cancel`：新 POST 端点，调用 `chatSteering.steer("cancel")`
- `chatSteering` 实例导出供 WS 路由共享

**文件:** `packages/server/src/routes/ws.ts`

- `chat.send`：同样集成 `chatSteering`，支持 steering 循环
- `chat.steer`：新 JSON-RPC method
- `chat.cancel`：从占位改为实际调用 `chatSteering`

### Step 4.4: 前端交互 ✅

**文件:** `packages/web/src/pages/Chat.tsx`

- 输入框在 streaming 期间可用，placeholder 提示 "Send a follow-up..."
- 发送时检测 `isStreaming`：有 → `steerChat()`，无 → `sendChatMessage()`
- 停止按钮调用 `cancelChat(sessionKey)`
- `ChatMessage` 新增 `isPending` / `isAborted` 标志
- pending 消息显示半透明 + "Queued — waiting for current response..."
- aborted 消息显示 "Response interrupted"
- `steering_resume` 事件：清除 pending 标记，添加新 assistant 占位
- `aborted` 事件：标记当前 assistant 消息为 aborted

**文件:** `packages/web/src/lib/api.ts`

- `AgentEvent` 新增 `aborted` 类型
- 新增 `steerChat(sessionKey, message)` → `POST /api/chat/steer`
- 新增 `cancelChat(sessionKey)` → `POST /api/chat/cancel`

---

## Phase 5: Mobile Layout + PWA（3-4d）✅ 已完成

### Step 5.1: 响应式导航 ✅

**文件:** `packages/web/src/App.tsx`

- `md:` 以上：保持固定侧边栏（`hidden md:flex`）
- `md:` 以下：overlay drawer（`fixed z-50 translate-x` 动画）+ 半透明遮罩
- hamburger 按钮触发，导航后自动关闭
- 移动端顶部栏显示 hamburger + 品牌名

### Step 5.2: 响应式 Chat 布局 ✅

**文件:** `packages/web/src/pages/Chat.tsx`

- Session 侧栏提取为 `sidebarContent` 共享
- `md:` 以上：`hidden md:flex w-64` 固定侧栏
- `md:` 以下：`fixed z-50 w-72 translate-x` overlay + 遮罩
- Chat header 增加 Menu 按钮（`md:hidden`）触发 session 侧栏
- 输入区底部 padding 使用 `env(safe-area-inset-bottom)` 适配 iOS

### Step 5.3: PWA 配置 ✅

**文件:** `packages/web/index.html`

- 添加 `viewport-fit=cover`、`theme-color`（dark/light 双色）
- 添加 `apple-mobile-web-app-capable` + `black-translucent` 状态栏
- 链接 `manifest.json`

**新建文件:** `packages/web/public/manifest.json`

- `display: "standalone"`，`start_url: "/"`
- SVG 图标（192x192 + 512x512）

**新建文件:** `packages/web/public/icon-192.svg`, `icon-512.svg`

---

## 依赖关系与进度

```
Phase 1 (File Attachments) ─── ✅ 已完成
Phase 2 (Theme) ─────────────── ✅ 已完成
Phase 3 (Thought Panels) ────── ✅ 已完成
Phase 4 (Live Steering) ─────── ✅ 已完成
Phase 5 (Mobile + PWA) ──────── ✅ 已完成

后续优化（已完成 3/5）:
  ThemeToggle 手动切换 ──────── ✅ 已完成
  file_write → MediaStore ───── ✅ 已完成
  PWA Service Worker ─────────── ✅ 已完成
  Live Steering 小模型意图 ──── 🔲 可选
  PWA 正式图标 ───────────────── 🔲 可选
```
