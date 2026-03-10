# Chat UI 增强功能评估

## 背景

评估 5 项 WebChat 前端增强功能的可行性与优先级，基于当前架构（Hono NDJSON 流式、prompt-kit 组件、Tailwind 4 语义色彩主题、MediaStore 媒体管道）。

> **状态：全部已完成** — 详见开发计划 `docs/plans/2026-03-10-chat-ui-enhancements.md`

---

## 功能清单

### 1. File Attachments — 消息内附件下载链接 ✅ 已完成

**工作量:** 0.5-1 天

**实现内容:**
- 新建 `FileAttachment` 组件（`prompt-kit/file-attachment.tsx`）
  - 图片类型：缩略图预览 + 点击放大 lightbox
  - 非图片：文件图标 + 文件名 + 大小 + 下载按钮
- `ChatMessage` 新增 `attachments?: AttachmentInfo[]` 字段
- 上传流程：拖放/点击 → `uploadMedia()` → 附件元数据挂到用户消息
- 用户消息和 assistant 消息均支持附件渲染

---

### 2. Dark/Light Theme — 跟随系统偏好 ✅ 已完成

**工作量:** 2-3 天

**实现内容:**
- `index.css` 新增 `@media (prefers-color-scheme: light)` 亮色变量集（OKLCH）
- 全部 14+ 前端文件硬编码颜色替换为语义 token：
  - `bg-gray-*` → `bg-background` / `bg-card` / `bg-muted`
  - `text-gray-*` / `text-white` → `text-foreground` / `text-muted-foreground`
  - `border-gray-*` → `border-border`
  - `bg-blue-*` → `bg-primary`，`focus:ring-blue-*` → `focus:ring-ring`
- `prose dark:prose-invert` 适配 Markdown 渲染
- 未实现 ThemeToggle 手动切换（可后续添加）

---

### 3. Thought/Draft Panels — 流式输出时展示推理过程 ✅ 已完成

**工作量:** 1-2 天

**实现内容:**
- 服务端 `runtime.ts` 捕获 Vercel AI SDK `reasoning` 流事件 → yield `{ type: "thinking" }`
- `AgentEvent` 类型同步更新（`runtime.ts` + `api.ts`）
- 新建 `ThinkingPanel` 组件（Radix Collapsible）：
  - 流式中：`animate-pulse` Brain 图标 + "Thinking..."
  - 完成后：展示 "Thought for Xs"（自动计算持续时间）
- `ChatMessage` 新增 `thinking` / `thinkingStartedAt` / `thinkingDurationMs`
- 渲染顺序：ThinkingPanel → ToolCalls → MessageContent

**局限:** 仅 Claude 模型支持 extended thinking。

---

### 4. Live Steering — 流式输出中发送追加指令 ✅ 已完成

**工作量:** 3-4 天

**设计决策：** 采用关键词匹配意图分类（非小模型），降低延迟和成本。

**实现内容:**

服务端：
- `SteeringManager`（`agents/steering.ts`）：session 级 `AbortController` + 消息队列
  - 意图分类：关键词匹配 → cancel / redirect / supplement
  - cancel 关键词："stop", "cancel", "停", "取消", "算了", "不用了"
  - redirect 关键词："actually", "instead", "不对", "重新", "换个方向"
  - 默认 supplement：排队等当前回复完成后自动续跑
- `runtime.ts`：`run()` 新增 `signal?: AbortSignal` → `streamText({ abortSignal })`
  - abort 时保存已输出内容（标记 `[interrupted]`）+ yield `{ type: "aborted" }`
- `chat.ts`：新增 `POST /steer` 和 `POST /cancel` 端点
  - `/send` 集成 steering 循环，自动 dequeue 续跑
- `ws.ts`：`chat.steer` / `chat.cancel` JSON-RPC method

前端：
- 输入框在 streaming 期间不再禁用，placeholder 改为 "Send a follow-up..."
- 发送时若 `isStreaming` → 调用 `steerChat()` 而非 `sendChatMessage()`
- 停止按钮调用 `cancelChat(sessionKey)`
- pending 消息：半透明 + "Queued — waiting for current response..."
- aborted 消息："Response interrupted"
- `steering_resume` 事件：自动清除 pending 标记 + 新建 assistant 占位

**流程示意:**
```
用户发送 "分析这段代码"
  → streamText 开始输出...
用户追加 "重点看安全问题"
  → steerChat → 意图=supplement → 排队
  → 主线程继续输出...
  → done → 自动 dequeue → 新 run("重点看安全问题")

用户追加 "算了，换成中文回答"
  → steerChat → 意图=redirect → abort + 排队
  → 主线程中断 → 保存 [interrupted]
  → 自动 dequeue → 新 run("算了，换成中文回答")

用户追加 "停"
  → steerChat → 意图=cancel → abort + 清空队列
  → 主线程中断 → 保存 [interrupted]
```

---

### 5. Mobile Layout + PWA ✅ 已完成

**工作量:** 3-4 天

**实现内容:**

响应式导航（`App.tsx`）：
- 桌面端（`md:` 以上）：保持 w-56 固定侧边栏
- 移动端（`md:` 以下）：overlay drawer + 半透明遮罩 + `translate-x` 动画
- 移动端顶部栏：hamburger 按钮 + 品牌名
- 导航后自动关闭 drawer

响应式 Chat 布局（`Chat.tsx`）：
- Session 侧栏提取为共享 `sidebarContent`
- 桌面端：`hidden md:flex w-64` 固定侧栏
- 移动端：`fixed z-50 w-72` overlay + Menu 按钮触发
- 输入区底部 `env(safe-area-inset-bottom)` 适配 iOS

PWA 配置：
- `index.html`：`viewport-fit=cover`、`theme-color`（dark/light 双色）、Apple web app meta
- `manifest.json`：`display: "standalone"`，SVG 图标
- 占位 SVG 图标（192x192 + 512x512），可替换为正式设计

---

## 完成总结

| 功能 | 工作量 | 状态 |
|------|--------|------|
| File Attachments 下载链接 | 0.5-1d | ✅ 已完成 |
| Dark/Light Theme | 2-3d | ✅ 已完成 |
| Thought/Draft Panels | 1-2d | ✅ 已完成 |
| Live Steering (双线程模式) | 3-4d | ✅ 已完成 |
| Mobile Layout + PWA | 3-4d | ✅ 已完成 |

## 待优化项

- ~~**ThemeToggle 组件**~~：✅ 已实现 — `theme-toggle.tsx` 三态切换（System/Light/Dark），`localStorage` 持久化，`data-theme` 属性 + CSS 覆盖
- **Live Steering 意图分类**：可接入小模型提升准确率（当前纯关键词）
- ~~**PWA Service Worker**~~：✅ 已实现 — `sw.js` 基础缓存策略（静态资源 cache-first，API 请求 network-first），`main.tsx` 注册
- **PWA 图标**：当前为占位 SVG，需替换为正式设计的 PNG 图标
- ~~**file_write 自动关联 media**~~：✅ 已实现 — `file.ts` 写入后自动调用 `MediaStore.store()`，返回 JSON 含 `mediaUrl`；`Chat.tsx` 解析 `tool_result` 生成附件卡片
