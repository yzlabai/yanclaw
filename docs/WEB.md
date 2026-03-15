# YanClaw Web 前端

> React 19 + Vite + Tailwind CSS 4 构建的 Web 管理界面。

---

## 1. 概述

`@yanclaw/web` 是 YanClaw 的前端界面，提供 AI 对话、Agent 管理、通道配置、会话浏览、系统监控等功能。既可在浏览器中独立运行，也嵌入 Tauri 桌面壳作为 WebView。

---

## 2. 快速开始

```bash
# 开发模式（端口 1420）
bun run dev

# 生产构建
bun run build

# 预览生产构建
bun run preview
```

开发时需同时启动后端：`bun run dev:server`（端口 18789）。

---

## 3. 技术栈

| 库 | 用途 |
|------|------|
| React 19 | UI 框架 |
| react-router-dom 7 | 客户端路由 |
| Vite + Tailwind CSS 4 | 构建 + 样式 |
| Hono RPC (`hc<AppType>`) | 类型安全 API 客户端 |
| @radix-ui/* | 无障碍基础组件 |
| lucide-react | 图标库 |
| react-markdown + rehype/remark | Markdown 渲染 |
| highlight.js | 代码高亮 |
| katex | LaTeX 数学公式 |
| mermaid | 图表渲染 |
| sonner | Toast 通知 |
| motion | 动画 |
| @tauri-apps/api | 桌面 IPC 集成 |

---

## 4. 页面结构

| 路由 | 页面 | 功能 |
|------|------|------|
| `/` | Chat | AI 对话：流式输出、Markdown、代码高亮、工具调用展示、审批、文件拖拽、语音输入、记忆回溯 |
| `/dashboard` | Dashboard | 错误监控：严重度/模块/时间筛选、30 秒自动刷新 |
| `/agent-hub` | AgentHub | 任务循环：进程卡片、DAG 视图、审批队列、任务生成对话框 |
| `/sessions` | Sessions | 会话管理：分页列表、筛选、导出、删除 |
| `/agents` | Agents | Agent 配置：CRUD、模型、提示词、运行时选择、工具策略编辑器 |
| `/channels` | Channels | 通道管理：适配器状态、路由绑定 CRUD、身份关联 |
| `/skills` | Skills | 插件管理：安装/配置/启停 |
| `/mcp` | McpServers | MCP 服务器：状态、工具检查器 |
| `/cron` | Cron | 定时任务：cron/间隔/单次、手动触发 |
| `/pim` | PIM | 个人信息：8 类标签页（人物/事件/物品/地点/时间/信息/组织/账本） |
| `/knowledge` | Knowledge | 向量记忆：FTS5 搜索、标签管理 |
| `/settings` | Settings | 系统设置：提供商 API Key、模型覆盖、网关端口 |
| `/onboarding` | Onboarding | 首次引导：3 步向导（提供商→API Key→完成） |

---

## 5. 组件体系

### 5.1 prompt-kit — 对话 UI 组件

```
components/prompt-kit/
├── chat-container.tsx     # 对话容器（自动滚动）
├── message.tsx            # 消息气泡（头像 + 内容）
├── prompt-input.tsx       # 输入框（自动调整高度）
├── markdown.tsx           # Markdown 渲染（代码高亮、数学、Mermaid）
├── thinking-panel.tsx     # 扩展思考面板（可折叠）
├── tool-call.tsx          # 工具调用展示（可展开详情）
├── recall-panel.tsx       # 记忆回溯面板
├── file-attachment.tsx    # 文件附件预览
├── loader.tsx             # 流式输出加载动画
└── scroll-button.tsx      # 滚动到底部按钮
```

### 5.2 ui — 基础 UI 组件

基于 Radix UI + Tailwind，包含 15+ 组件：`button`、`dialog`、`input`、`select`、`table`、`tabs`、`tooltip`、`badge`、`pagination`、`switch`、`sheet`、`skeleton`、`collapsible`、`alert-dialog`、`avatar`、`textarea`。

### 5.3 agent-hub — 任务管理组件

```
components/agent-hub/
├── SpawnDialog.tsx         # 进程生成表单
├── ProcessCard.tsx         # 进程卡片（状态/Agent/任务名）
├── ProcessDetail.tsx       # 进程详情 + 操作按钮
├── ApprovalQueue.tsx       # 审批队列
├── TaskLoopCard.tsx        # 任务循环状态
├── TaskLoopSpawnDialog.tsx # 任务循环生成表单
└── TaskDAGView.tsx         # DAG 依赖图可视化
```

---

## 6. API 客户端

### 类型安全 RPC

```typescript
// lib/api.ts
import type { AppType } from "@yanclaw/server/app";
import { hc } from "hono/client";

const client = hc<AppType>(API_BASE);

// 完整类型推断，无需手写接口
const res = await client.api.agents.$get();
const agents = await res.json();
```

### 流式对话

```typescript
import { sendChatMessage, AgentEvent } from "@yanclaw/web/lib/api";

sendChatMessage(agentId, sessionKey, message, (event: AgentEvent) => {
  switch (event.type) {
    case "delta":      // 文本片段
    case "thinking":   // 扩展思考
    case "tool_call":  // 工具调用
    case "tool_result":// 工具结果
    case "recall":     // 记忆回溯
    case "done":       // 完成 + Token 用量
    case "error":      // 错误
  }
}, imageUrls);
```

### 认证

- **Tauri 桌面**：通过 IPC `get_auth_token()` 获取 Bearer Token
- **浏览器**：从 localStorage 读取
- `apiFetch()` 自动附加 `Authorization` header

---

## 7. Tauri 集成

```typescript
// lib/tauri.ts
import { isTauri } from "@yanclaw/web/lib/tauri";

if (isTauri()) {
  // 桌面模式：HashRouter（file:// 协议兼容）
  // IPC 调用：getAuthToken(), startGateway(), stopGateway()
  // 自动更新：checkForUpdates(), installUpdate()
} else {
  // 浏览器模式：BrowserRouter
  // Token 从 localStorage 读取
}
```

---

## 8. 国际化

支持中文（zh）和英文（en），基于 Context API：

```typescript
import { useI18n } from "@yanclaw/web/i18n";

const { t, locale, setLocale } = useI18n();
t("chat.send"); // → "发送" | "Send"
```

语言检测优先级：localStorage → navigator.language → 默认 en。

翻译文件：`src/i18n/locales/{zh,en}.json`。

---

## 9. 自定义 Hooks

| Hook | 用途 |
|------|------|
| `useAvailableModels` | 获取可用模型列表 + 状态 |
| `useAgentHub` | Agent Hub 进程 CRUD + 审批 |
| `useTaskLoop` | 任务循环创建/审批/取消 |
| `useProcessEvents` | WebSocket 进程事件流 |
| `useVoiceInput` | 语音输入（Web Audio → STT） |

---

## 10. 主题与样式

- **暗色优先**：CSS 变量（`--background`、`--foreground`、`--accent` 等）
- **Tailwind 工具类**：100 字符行宽（Biome 格式化）
- **响应式**：移动端 Drawer 导航，桌面端侧边栏
- **图标**：Lucide React（描边风格，20-24px）

---

## 11. 构建配置

```typescript
// vite.config.ts
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 1420, strictPort: true },
  resolve: {
    alias: { "@yanclaw/web": resolve(__dirname, "src") }
  }
});
```

TypeScript 引用 `../shared` 和 `../server`，实现跨包类型推断。

---

## 12. 关键源码位置

| 模块 | 路径 |
|------|------|
| 入口 | `packages/web/src/main.tsx` |
| 路由 + 布局 | `packages/web/src/App.tsx` |
| API 客户端 | `packages/web/src/lib/api.ts` |
| Tauri IPC | `packages/web/src/lib/tauri.ts` |
| 页面组件 | `packages/web/src/pages/` |
| 对话 UI | `packages/web/src/components/prompt-kit/` |
| 基础组件 | `packages/web/src/components/ui/` |
| 国际化 | `packages/web/src/i18n/` |
