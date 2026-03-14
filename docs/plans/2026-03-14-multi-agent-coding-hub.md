# 多智能体编程管理中心 — 开发计划

> 需求文档：`docs/todos/2026-03-14-multi-agent-coding-hub.md`

## 现状基线

经源码验证，以下基础设施已就绪：

| 已有能力 | 位置 | 状态 |
|----------|------|------|
| `runtime: "claude-code"` config 定义 | `server/src/config/schema.ts` | ✅ schema 就绪，runtime 分发逻辑待补全 |
| `AgentRuntime.run()` 流式执行 | `server/src/agents/runtime.ts` | ✅ 支持 default runtime |
| `AgentEvent` 类型（delta/tool_call/done 等） | `server/src/agents/runtime.ts` | ✅ 可复用 |
| `SessionStore` 持久化 | `server/src/db/sessions.ts` | ✅ 完整 CRUD |
| `ApprovalManager` 工具审批 | `server/src/routes/approvals.ts` | ✅ 可扩展 |
| `session_send/list/history` 工具 | `server/src/agents/tools/` | ✅ Agent 间通信基础 |
| `ChannelManager` 多频道推送 | `server/src/channels/` | ✅ TG/Discord/Slack/Feishu |
| `UsageTracker` token 统计 | `server/src/usage/` | ✅ |
| WebSocket 实时推送 | `server/src/routes/ws.ts` | ✅ |
| Hono RPC 类型安全 API | `server/src/app.ts` | ✅ |

---

## Phase 1：Agent Supervisor 核心

**目标**：进程管理器，能 spawn/stop/list 外部 Agent 子进程，产出统一事件流。

### Step 1.1 — AgentProcess 数据模型

**文件**：`server/src/agents/supervisor/types.ts`（新建）

```typescript
interface AgentProcess {
  id: string;                    // cuid2
  agentId: string;               // 引用 config.agents[].id
  status: "starting" | "running" | "waiting-approval" | "idle" | "stopped" | "error";
  pid?: number;
  workDir: string;
  sessionKey: string;            // 映射到 SessionStore
  task?: string;
  worktreePath?: string;         // git worktree 路径
  startedAt: number;
  lastActivityAt: number;
  tokenUsage: { input: number; output: number };
  error?: string;
}
```

不新建数据库表——用内存 `Map<id, AgentProcess>` + SessionStore 持久化消息。进程重启后通过 PID 检活恢复状态。

### Step 1.2 — AgentSupervisor 类

**文件**：`server/src/agents/supervisor/index.ts`（新建）

```typescript
class AgentSupervisor {
  private processes = new Map<string, AgentProcess>();
  private eventBus = new EventEmitter();

  async spawn(config: SpawnConfig): Promise<AgentProcess>;
  async stop(id: string): Promise<void>;
  async send(id: string, message: string): Promise<void>;
  async approve(id: string, requestId: string, allow: boolean): Promise<void>;
  list(filter?: { agentId?: string }): AgentProcess[];
  subscribe(handler: (event: SupervisorEvent) => void): Unsubscribe;

  // 内部
  private checkStaleProcesses(): void;  // 60s 定时，kill(pid,0) 检活
  private handleAdapterEvent(processId: string, event: AgentEvent): void;
}
```

**依赖**：注入 `GatewayContext`，注册到 `gateway.ts` 的 `initGateway` 流程中。

### Step 1.3 — Adapter 接口

**文件**：`server/src/agents/supervisor/adapter.ts`（新建）

```typescript
interface AgentAdapter {
  readonly type: string;
  spawn(options: AdapterSpawnOptions): Promise<{ pid: number; sessionId?: string }>;
  send(message: string): Promise<void>;
  respondPermission(requestId: string, allow: boolean): Promise<void>;
  stop(): Promise<void>;
  onEvent(handler: (event: AgentEvent) => void): Unsubscribe;
}

interface AdapterSpawnOptions {
  workDir: string;
  task?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  env?: Record<string, string>;
}
```

### Step 1.4 — 进程健康检查

参考 Happy Daemon 实现：
- 每 60 秒 `process.kill(pid, 0)` 检活
- 检测到进程退出 → 更新 status 为 `stopped` 或 `error`
- 发射 `status-change` 事件
- spawn 时使用 `{detached: true}` 让子进程独立于主进程

**涉及文件**：
- 新建 `server/src/agents/supervisor/types.ts`
- 新建 `server/src/agents/supervisor/index.ts`
- 新建 `server/src/agents/supervisor/adapter.ts`
- 修改 `server/src/gateway.ts` — 注册 Supervisor 到 GatewayContext

---

## Phase 2：Claude Code Adapter

**目标**：通过 Agent SDK 程序化启动和控制 Claude Code。

### Step 2.1 — SDK 模式 Adapter

**文件**：`server/src/agents/supervisor/adapters/claude-code.ts`（新建）

核心流程：

```
spawn():
  1. 安装/检测 @anthropic-ai/claude-agent-sdk
  2. 调用 query({ prompt, options: { cwd, allowedTools, ... } })
  3. 消费 AsyncGenerator，映射为 AgentEvent
  4. control_request → permission-request 事件 → 等待用户审批
  5. 用户审批 → control_response 回写

消息映射：
  SDK assistant.text       → AgentEvent { type: "delta", text }
  SDK tool_use             → AgentEvent { type: "tool_call", ... }
  SDK tool_result          → AgentEvent { type: "tool_result", ... }
  SDK control_request      → AgentEvent { type: "permission-request", ... }  // 自定义扩展
  SDK result               → AgentEvent { type: "done", usage }
```

### Step 2.2 — Wrapper 模式（监控已有实例）

**文件**：`server/src/agents/supervisor/adapters/claude-code-watcher.ts`（新建）

参考 Happy `sessionScanner.ts` 实现：

```
spawn():
  1. 生成 SessionStart Hook 配置文件（临时 JSON）
  2. spawn claude --settings {hookSettingsPath} --output-format stream-json
  3. 启动 SessionScanner：
     - 等待 webhook 获取 sessionId
     - fs.watch + 3s 轮询 ~/.claude/sessions/{sessionId}.jsonl
     - 逐行解析，跳过 file-history-snapshot/change/queue-operation
     - UUID 去重（summary 用 leafUuid+text 组合键）
     - 映射为 AgentEvent
```

### Step 2.3 — 运行时路由补全

**文件**：修改 `server/src/agents/runtime.ts`

当前 `run()` 方法中 `runtime: "claude-code"` 分支尚未完整实现。补全：

```typescript
if (agentConfig.runtime === "claude-code") {
  // 委托给 Supervisor 管理的 AgentProcess
  yield* this.ctx.supervisor.delegateToProcess(agentId, sessionKey, message, ...);
}
```

**涉及文件**：
- 新建 `server/src/agents/supervisor/adapters/claude-code.ts`
- 新建 `server/src/agents/supervisor/adapters/claude-code-watcher.ts`
- 修改 `server/src/agents/runtime.ts` — 补全 claude-code runtime 分支
- `package.json` — `bun add @anthropic-ai/claude-agent-sdk`

---

## Phase 3：Agent Hub API + WebSocket

**目标**：REST API + 实时推送，前端可管理所有 Agent 进程。

### Step 3.1 — API 路由

**文件**：`server/src/routes/agent-hub.ts`（新建）

```
POST   /api/agent-hub/spawn          启动新 Agent 进程
POST   /api/agent-hub/:id/send       发送消息
POST   /api/agent-hub/:id/approve    审批权限请求
POST   /api/agent-hub/:id/stop       停止进程
GET    /api/agent-hub/processes      列出所有进程
GET    /api/agent-hub/:id/events     SSE 事件流（单个 Agent）
GET    /api/agent-hub/events         SSE 事件流（全局，聚合所有 Agent）
```

### Step 3.2 — WebSocket 扩展

**文件**：修改 `server/src/routes/ws.ts`

新增 WebSocket 消息类型：

```typescript
// Server → Client
{ type: "agent-hub:event", processId: string, event: AgentEvent }
{ type: "agent-hub:status", processes: AgentProcess[] }

// Client → Server
{ type: "agent-hub:send", processId: string, message: string }
{ type: "agent-hub:approve", processId: string, requestId: string, allow: boolean }
```

### Step 3.3 — 注册路由

**文件**：修改 `server/src/app.ts`

```typescript
import agentHub from "./routes/agent-hub";
app.route("/api/agent-hub", agentHub);
```

**涉及文件**：
- 新建 `server/src/routes/agent-hub.ts`
- 修改 `server/src/routes/ws.ts`
- 修改 `server/src/app.ts`

---

## Phase 4：Dashboard UI

**目标**：Web 界面管理多 Agent 编程会话，所有后端功能均有对应 UI 呈现。

> **设计约束**：遵循现有 YanClaw UI 规范 — Radix + Tailwind、OKLCH 暖色系、
> dark-first、`.card-hover` 动效、Lucide 图标、`cn()` 工具函数、
> CVA variant 体系、无 React Query（useState + useCallback）。

### Step 4.1 — 页面布局：三栏式 Agent Hub

**文件**：`web/src/pages/AgentHub.tsx`（新建）

```
┌──────────────────────────────────────────────────────────────┐
│  Sidebar (已有)  │           Agent Hub 主区域                 │
│                  │                                            │
│  ...             │  ┌─ 顶部工具栏 ──────────────────────────┐│
│  [Agent Hub] ←── │  │ [+ 启动 Agent]  筛选  搜索  审批(3) ││
│  ...             │  └───────────────────────────────────────┘│
│                  │                                            │
│                  │  ┌─ 进程卡片网格 ─┐  ┌─ 详情面板 ────────┐│
│                  │  │ ● frontend     │  │ 实时输出流          ││
│                  │  │ ● backend      │  │ (prompt-kit 复用)   ││
│                  │  │ ○ tester       │  │                     ││
│                  │  │                │  │ 工具调用折叠         ││
│                  │  │                │  │ 文件变更 diff        ││
│                  │  │                │  │                     ││
│                  │  │                │  │ ┌─ 输入区 ────────┐ ││
│                  │  │                │  │ │ 发送消息/中断    │ ││
│                  │  │                │  │ └────────────────┘ ││
│                  │  └────────────────┘  └───────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

**响应式**：
- 桌面（≥1024px）：左侧卡片列表 `w-80` + 右侧详情面板 `flex-1`
- 平板（768-1023px）：卡片列表全宽，点击卡片推入详情（滑入动画）
- 手机（<768px）：卡片列表全宽，详情覆盖为全屏 overlay

### Step 4.2 — 顶部工具栏

**文件**：`web/src/components/agent-hub/HubToolbar.tsx`（新建）

```
┌──────────────────────────────────────────────────────────┐
│ [+ 启动 Agent]   [筛选: 全部 ▾]  [🔍 搜索]   [⚠ 审批 3] │
└──────────────────────────────────────────────────────────┘
```

| 元素 | 组件 | 样式规范 |
|------|------|----------|
| 启动按钮 | `<Button>` variant=default | `gap-2`，图标 `Plus` (Lucide) |
| 状态筛选 | `<Select>` | 选项：全部 / 运行中 / 等待审批 / 已完成 / 出错 |
| 搜索框 | `<Input>` | `w-48`，placeholder "搜索任务..."，300ms 防抖 |
| 审批入口 | `<Button>` variant=outline | 右上角 `<Badge>` 显示待审批数（红色脉冲动画） |

### Step 4.3 — 进程卡片（ProcessCard）

**文件**：`web/src/components/agent-hub/ProcessCard.tsx`（新建）

```
┌─────────────────────────────────┐
│  ● frontend-coder       12:03  │  ← 状态灯 + Agent 名 + 启动时间
│                                 │
│  实现登录页面 UI                 │  ← 任务描述（1行截断）
│                                 │
│  claude-code  claude-sonnet-4-6 │  ← runtime Badge + model Badge
│  ./packages/web                 │  ← 工作目录（muted）
│                                 │
│  ⬤ 23k tokens   ⏱ 8分钟        │  ← token + 运行时间
│                                 │
│  [查看] [发送] [■ 停止]          │  ← hover 时显示操作按钮
└─────────────────────────────────┘
```

**状态灯颜色**（复用项目已有 badge 色彩规范）：

| 状态 | 圆点颜色 | Badge 样式 |
|------|----------|-----------|
| running | `bg-green-500` + 脉冲动画 `animate-pulse` | `bg-green-500/20 text-green-400 border-green-500/30` |
| waiting-approval | `bg-amber-500` + 脉冲 | `bg-amber-500/20 text-amber-400 border-amber-500/30` |
| starting | `bg-blue-500` + 脉冲 | `bg-blue-500/20 text-blue-400 border-blue-500/30` |
| idle | `bg-gray-400` | `bg-muted text-muted-foreground` |
| stopped | `bg-gray-500` | `bg-muted text-muted-foreground` |
| error | `bg-red-500` | `bg-red-500/20 text-red-400 border-red-500/30` |

**交互**：
- 卡片使用 `.card-hover` 效果（translateY -2px + shadow-warm）
- 选中卡片左边框高亮 `border-l-2 border-primary`（同 Sidebar active 样式）
- 操作按钮默认 `opacity-0`，hover 时 `opacity-100`（`transition-opacity duration-200`）

### Step 4.4 — 详情面板（ProcessDetail）

**文件**：`web/src/components/agent-hub/ProcessDetail.tsx`（新建）

顶部信息栏 + 输出流 + 底部输入区，三段式布局。

**顶部信息栏**：

```
┌──────────────────────────────────────────────────────────┐
│  ← 返回(mobile)  frontend-coder           ● Running     │
│                                                          │
│  任务: 实现登录页面 UI                                     │
│  目录: /Users/dev/my-app/packages/web                    │
│  Token: 23,412 输入 / 8,901 输出   耗时: 8m 23s          │
│                                                          │
│  [暂停]  [■ 停止]  [⋮ 更多]                               │
└──────────────────────────────────────────────────────────┘
```

- 信息栏背景 `bg-card`、底边框 `border-b border-border`
- Token 数字使用 `tabular-nums` 等宽字体
- "更多" 菜单：导出日志、查看 session、复制 Agent ID

**输出流区域**：

复用 prompt-kit 组件，保持与 Chat 页面一致体验：

| 内容类型 | 组件 | 渲染方式 |
|----------|------|----------|
| 文本输出 | `<Message>` role=assistant | Markdown 渲染，左对齐 `bg-muted` 气泡 |
| 思考过程 | `<ThinkingPanel>` | 可折叠，`text-muted-foreground italic` |
| 工具调用 | `<ToolCall>` | 折叠式，显示工具名 + 参数 + 结果 |
| 权限请求 | **`<PermissionCard>`**（新组件） | 高亮卡片，内含审批按钮 |
| 文件变更 | **`<FileChangeCard>`**（新组件） | diff 预览，路径 + 操作类型 |
| 错误 | `<Message>` | `border-destructive` 左边框 |
| 用户消息 | `<Message>` role=user | 右对齐 `bg-primary` 气泡 |

auto-scroll 使用 `use-stick-to-bottom`（同 Chat 页面）。

**底部输入区**：

复用 `<PromptInput>`：
- `<PromptInputTextarea>` placeholder "向此 Agent 发送指令..."
- `<PromptInputActions>` 包含发送按钮
- Agent 处于 `waiting-approval` 时，输入区上方显示审批横幅

### Step 4.5 — 权限审批卡片（PermissionCard）

**文件**：`web/src/components/agent-hub/PermissionCard.tsx`（新建）

嵌入输出流中，在 permission-request 事件位置内联显示：

```
┌─ ⚠ 权限请求 ──────────────────────────────────────────────┐
│                                                            │
│  Bash                                                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ $ rm -rf dist/ && npm run build                      │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  风险: 高 (destructive file operation)                      │
│                                                            │
│  ⏱ 28:42 剩余                    [拒绝]  [✓ 批准]         │
└────────────────────────────────────────────────────────────┘
```

样式规范：
- 边框 `border-amber-500/30`、背景 `bg-amber-500/5`
- 工具参数区 `bg-muted rounded-lg p-3 font-mono text-sm`
- 风险等级：高=`text-red-400`、中=`text-amber-400`、低=`text-green-400`
- 倒计时 `tabular-nums text-muted-foreground`
- 已审批后卡片变灰：`opacity-60`，按钮替换为结果文字（"已批准 ✓" / "已拒绝 ✗"）
- 批准按钮 `variant=default`，拒绝按钮 `variant=outline`

### Step 4.6 — 文件变更卡片（FileChangeCard）

**文件**：`web/src/components/agent-hub/FileChangeCard.tsx`（新建）

```
┌─ 📄 文件变更 ─────────────────────────────────────────────┐
│  ✏️ edit  src/components/Login.tsx                         │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ - <div className="old-class">                        │  │
│  │ + <div className="new-class">                        │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

- 操作类型 Badge：create=`text-green-400`、edit=`text-amber-400`、delete=`text-red-400`
- diff 区域：`font-mono text-xs`，行前缀 `+` 绿色、`-` 红色
- 可折叠（默认折叠，仅显示文件路径 + 操作类型）

### Step 4.7 — 启动 Agent 对话框（SpawnDialog）

**文件**：`web/src/components/agent-hub/SpawnDialog.tsx`（新建）

使用 `<Dialog>` 组件（同 Agents 页面的编辑对话框模式）：

```
┌─ 启动新 Agent ──────────────────────────────────────────┐
│                                                          │
│  Agent 模板                                               │
│  ┌────────────────────────────────────────────────────┐  │
│  │ claude-coder                                    ▾  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  任务描述                                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ 实现登录页面的表单验证逻辑                            │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  工作目录                                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ ./packages/web                                     │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ☐ 使用 Git Worktree 隔离                                 │
│                                                          │
│  ▸ 高级选项                                               │
│    Model 覆盖: [默认 ▾]                                   │
│    System Prompt 追加: [                              ]   │
│                                                          │
│                             [取消]  [启动]                │
└──────────────────────────────────────────────────────────┘
```

表单规范：
- Label：`block text-sm text-muted-foreground mb-1`
- Input/Textarea：`h-9 rounded-md border border-input`
- Select：复用 `<Select>` 组件，选项来自 `GET /api/agents` 接口
- Checkbox：`<Switch>` 组件 + 文字说明
- 高级选项：`<Collapsible>` 默认折叠
- 提交按钮 `variant=default`，loading 时显示 `<CircularLoader>`

### Step 4.8 — 审批队列面板（ApprovalQueue）

**文件**：`web/src/components/agent-hub/ApprovalQueue.tsx`（新建）

点击工具栏 "审批" 按钮打开侧边抽屉（Sheet）：

```
┌─ 待审批请求 (3) ─────────────────────────────┐
│                                               │
│  [全部批准]  [全部拒绝]                        │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │ frontend-coder · Bash                    │ │
│  │ $ npm run build                          │ │
│  │ 风险: 低    ⏱ 29:12         [拒] [✓ 批]  │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │ backend-coder · Edit                     │ │
│  │ src/db/schema.ts (+42 -3)                │ │
│  │ 风险: 中    ⏱ 25:03         [拒] [✓ 批]  │ │
│  └──────────────────────────────────────────┘ │
│                                               │
│  ┌──────────────────────────────────────────┐ │
│  │ backend-coder · Bash                     │ │
│  │ $ DROP TABLE users;                      │ │
│  │ 风险: 高    ⏱ 18:44         [拒] [✓ 批]  │ │
│  └──────────────────────────────────────────┘ │
└───────────────────────────────────────────────┘
```

- 高风险请求卡片 `border-red-500/30 bg-red-500/5`
- 中风险 `border-amber-500/30`
- 低风险默认 `border-border`
- 批量操作前弹出 `<AlertDialog>` 确认
- 空状态显示 `text-muted-foreground` 居中图标 + "暂无待审批请求"

### Step 4.9 — 侧边栏入口

**文件**：修改 `web/src/App.tsx`

Sidebar 菜单项位置：在 "Sessions" 和 "Agents" 之间插入：

```typescript
{ icon: Monitor, label: "Agent Hub", path: "/agent-hub" }
```

图标使用 Lucide `Monitor`（或 `LayoutDashboard`）。

当有待审批请求时，菜单项右侧显示红色小圆点（notification dot）：

```tsx
{pendingApprovals > 0 && (
  <span className="absolute right-2 top-1/2 -translate-y-1/2 size-2 rounded-full bg-red-500 animate-pulse" />
)}
```

### Step 4.10 — 实时数据流

**数据获取策略**（遵循项目无 React Query 的约定）：

```typescript
// web/src/hooks/useAgentHub.ts（新建）
function useAgentHub() {
  const [processes, setProcesses] = useState<AgentProcess[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState(0);

  // 初始加载
  useEffect(() => {
    apiFetch("/api/agent-hub/processes").then(setProcesses);
  }, []);

  // WebSocket 实时更新
  useEffect(() => {
    const ws = getWebSocket();
    ws.on("agent-hub:status", setProcesses);
    ws.on("agent-hub:event", handleEvent);
    return () => ws.off(...);
  }, []);

  return { processes, pendingApprovals, spawn, stop, send, approve };
}
```

单个 Agent 输出流使用 SSE：

```typescript
// web/src/hooks/useProcessEvents.ts（新建）
function useProcessEvents(processId: string) {
  const [events, setEvents] = useState<AgentEvent[]>([]);

  useEffect(() => {
    const es = new EventSource(`/api/agent-hub/${processId}/events`);
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      setEvents(prev => [...prev, event]);
    };
    return () => es.close();
  }, [processId]);

  return events;
}
```

### Step 4.11 — 空状态与加载态

| 场景 | 展示 |
|------|------|
| 无进程 | 居中图标 `Monitor` (64px, muted) + "尚未启动任何 Agent" + `<Button>` 启动第一个 |
| 加载中 | `<Skeleton>` 卡片占位（同 Sessions 页面模式） |
| 未选中详情 | 右侧面板居中提示 "选择一个 Agent 查看详情" |
| Agent 出错 | 详情面板顶部红色横幅 `bg-destructive/10 border-destructive/30` + 错误信息 |
| 网络断开 | 全局 toast 提示 "连接已断开，正在重连..." |

**涉及文件**：
- 新建 `web/src/pages/AgentHub.tsx` — 主页面布局
- 新建 `web/src/hooks/useAgentHub.ts` — 进程列表 + WebSocket 状态
- 新建 `web/src/hooks/useProcessEvents.ts` — 单进程 SSE 事件流
- 新建 `web/src/components/agent-hub/HubToolbar.tsx` — 工具栏
- 新建 `web/src/components/agent-hub/ProcessCard.tsx` — 进程卡片
- 新建 `web/src/components/agent-hub/ProcessDetail.tsx` — 详情面板
- 新建 `web/src/components/agent-hub/PermissionCard.tsx` — 权限审批内联卡片
- 新建 `web/src/components/agent-hub/FileChangeCard.tsx` — 文件变更 diff 卡片
- 新建 `web/src/components/agent-hub/ApprovalQueue.tsx` — 审批队列抽屉
- 新建 `web/src/components/agent-hub/SpawnDialog.tsx` — 启动 Agent 对话框
- 修改 `web/src/App.tsx` — 路由 + Sidebar 菜单项

---

## Phase 5：通知集成

**目标**：Agent 关键事件推送到 Telegram/Slack/Discord。

### Step 5.1 — 事件通知桥

**文件**：`server/src/agents/supervisor/notifier.ts`（新建）

```typescript
class AgentHubNotifier {
  constructor(private channelManager: ChannelManager, private config: AgentHubConfig) {}

  // 订阅 Supervisor 事件，按 notifyEvents 过滤，格式化后推送
  attach(supervisor: AgentSupervisor): void {
    supervisor.subscribe((event) => {
      if (!this.config.notifyEvents.includes(event.type)) return;
      const text = this.formatNotification(event);
      this.channelManager.send(this.config.notifyChannel, text);
    });
  }
}
```

消息格式：

```
[⏳ claude-coder] 等待审批: Bash `rm -rf dist/`
[✅ claude-coder] 完成: "实现登录页面"，token: 45k
[❌ codex-coder] 错误: MCP connection lost
```

### Step 5.2 — Config Schema 扩展

**文件**：修改 `server/src/config/schema.ts`

```typescript
agentHub: z.object({
  enabled: z.boolean().default(false),
  notifyChannel: z.string().optional(),
  notifyEvents: z.array(z.enum(["permission-request", "done", "error", "status-change"])).default(["done", "error"]),
  maxConcurrentAgents: z.number().default(5),
  approvalTimeout: z.number().default(1800),
}).default({})
```

**涉及文件**：
- 新建 `server/src/agents/supervisor/notifier.ts`
- 修改 `server/src/config/schema.ts`
- 修改 `server/src/gateway.ts` — 初始化 notifier

---

## Phase 6：Codex Adapter

**目标**：通过 MCP 协议接入 Codex。

### Step 6.1 — Codex MCP Adapter

**文件**：`server/src/agents/supervisor/adapters/codex.ts`（新建）

参考 Happy `codexMcpClient.ts`：

```
spawn():
  1. codex --version → 检测版本，确定 mcp vs mcp-server 子命令
  2. 通过 StdioClientTransport spawn codex mcp-server
  3. MCP message → AgentEvent 映射
  4. 权限: elicitation request → permission-request 事件
  5. sandbox 支持（可选）

send():
  MCP tool call 发送用户消息

stop():
  关闭 MCP transport，kill 子进程
```

**注意**：模式变更需重建 MCP session，Adapter 内部需处理 reconnect 逻辑。

### Step 6.2 — Config Schema 扩展

```typescript
// config.agents[].runtime 新增 "codex"
runtime: z.enum(["default", "claude-code", "codex"]).default("default"),
codex: z.object({
  mode: z.enum(["interactive", "full-auto"]).default("full-auto"),
  model: z.string().optional(),
}).optional()
```

**涉及文件**：
- 新建 `server/src/agents/supervisor/adapters/codex.ts`
- 修改 `server/src/config/schema.ts`
- `package.json` — 视需要添加 MCP SDK 依赖

---

## Phase 7：Gemini Adapter

**目标**：接入 Gemini CLI。

### Step 7.1 — Gemini ACP Adapter

**文件**：`server/src/agents/supervisor/adapters/gemini.ts`（新建）

参考 Happy `agent/core/AgentBackend.ts` + ACP transport：

```
spawn():
  1. 检测 gemini CLI 是否安装
  2. 通过 ACP transport 启动 Gemini agent
  3. AgentBackend.onMessage() → AgentEvent 映射
  4. 权限模式: yolo→bypassPermissions, safe-yolo→default

// Config
runtime: z.enum(["default", "claude-code", "codex", "gemini"]),
gemini: z.object({
  model: z.string().optional(),
  permissionMode: z.enum(["default", "yolo", "safe-yolo"]).default("default"),
}).optional()
```

**涉及文件**：
- 新建 `server/src/agents/supervisor/adapters/gemini.ts`
- 修改 `server/src/config/schema.ts`

---

## Phase 8：高级功能

**目标**：Agent 间协作、Git worktree 隔离、任务编排。

### Step 8.1 — Git Worktree 自动管理

```
spawn 时 worktree=true:
  1. git worktree add /tmp/yanclaw-wt-{processId} -b agent/{processId}
  2. Agent 在 worktree 中工作，互不冲突
  3. 完成后提示用户 merge 或创建 PR
  4. stop 时可选清理 worktree
```

### Step 8.2 — Agent 间成果物传递

利用已有 `session_send` 工具扩展：
- Agent A done → 触发回调 → 自动将 summary 发送给 Agent B
- 配置：`onDone: { notifyAgents: ["tester"] }`

### Step 8.3 — 任务 DAG 编排（远期）

声明式任务依赖图：

```jsonc
{
  "tasks": [
    { "id": "backend", "agent": "claude-coder", "task": "实现 API" },
    { "id": "frontend", "agent": "claude-coder", "task": "实现 UI", "dependsOn": ["backend"] },
    { "id": "test", "agent": "claude-coder", "task": "集成测试", "dependsOn": ["backend", "frontend"] }
  ]
}
```

---

## 文件变更清单

### 新建文件 — Server 端（9 个）

| 文件 | Phase | 说明 |
|------|-------|------|
| `server/src/agents/supervisor/types.ts` | 1 | AgentProcess 类型定义 |
| `server/src/agents/supervisor/index.ts` | 1 | AgentSupervisor 核心类 |
| `server/src/agents/supervisor/adapter.ts` | 1 | AgentAdapter 接口 |
| `server/src/agents/supervisor/adapters/claude-code.ts` | 2 | Claude Code SDK 适配器 |
| `server/src/agents/supervisor/adapters/claude-code-watcher.ts` | 2 | Claude Code Wrapper 监控 |
| `server/src/agents/supervisor/adapters/codex.ts` | 6 | Codex MCP 适配器 |
| `server/src/agents/supervisor/adapters/gemini.ts` | 7 | Gemini ACP 适配器 |
| `server/src/agents/supervisor/notifier.ts` | 5 | Channel 通知桥 |
| `server/src/routes/agent-hub.ts` | 3 | Agent Hub API 路由 |

### 新建文件 — Web 前端（12 个）

| 文件 | Phase | 说明 |
|------|-------|------|
| `web/src/pages/AgentHub.tsx` | 4 | 主页面（三栏布局 + 响应式） |
| `web/src/hooks/useAgentHub.ts` | 4 | 进程列表状态 + WebSocket 实时更新 |
| `web/src/hooks/useProcessEvents.ts` | 4 | 单进程 SSE 事件流 hook |
| `web/src/components/agent-hub/HubToolbar.tsx` | 4 | 顶部工具栏（启动/筛选/搜索/审批入口） |
| `web/src/components/agent-hub/ProcessCard.tsx` | 4 | 进程卡片（状态灯/任务/token/操作） |
| `web/src/components/agent-hub/ProcessDetail.tsx` | 4 | 详情面板（信息栏+输出流+输入区） |
| `web/src/components/agent-hub/PermissionCard.tsx` | 4 | 权限审批内联卡片（嵌入输出流） |
| `web/src/components/agent-hub/FileChangeCard.tsx` | 4 | 文件变更 diff 卡片 |
| `web/src/components/agent-hub/ApprovalQueue.tsx` | 4 | 审批队列侧边抽屉 |
| `web/src/components/agent-hub/SpawnDialog.tsx` | 4 | 启动 Agent 对话框（表单） |

### 修改文件（7 个）

| 文件 | Phase | 变更 |
|------|-------|------|
| `server/src/gateway.ts` | 1,5 | GatewayContext 加入 Supervisor + Notifier |
| `server/src/agents/runtime.ts` | 2 | 补全 claude-code runtime 分支 |
| `server/src/config/schema.ts` | 5,6,7 | agentHub 配置、codex/gemini runtime |
| `server/src/app.ts` | 3 | 注册 agent-hub 路由 |
| `server/src/routes/ws.ts` | 3 | 新增 agent-hub WebSocket 消息类型 |
| `web/src/App.tsx` | 4 | 路由 + Sidebar 菜单项 + 审批通知圆点 |
| `package.json` | 2 | 添加 @anthropic-ai/claude-agent-sdk |

---

## 依赖与风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Claude Agent SDK API 变更 | Adapter 需适配 | SDK 模式封装在单独文件，易替换 |
| Codex MCP 协议不稳定 | 版本检测逻辑失效 | 参考 Happy 的版本检测模式，做好降级 |
| 多进程资源消耗 | 内存/CPU 压力 | maxConcurrentAgents 硬限制 |
| Git worktree 冲突 | merge 失败 | 自动创建 PR 而非直接 merge |
| 权限审批超时 | Agent 长时间阻塞 | 可配置自动拒绝超时（默认 30 分钟） |

## 里程碑

| 里程碑 | Phase | 可验证状态 | 完成日期 |
|--------|-------|-----------|----------|
| **M1: 单 Agent 启停** | P1+P2 | 通过 API 启动 Claude Code Agent，能看到输出流 | 2026-03-14 ✅ |
| **M2: Dashboard 可用** | P3+P4 | Web UI 展示 Agent 卡片、实时输出、审批操作 | 2026-03-14 ✅ |
| **M3: 多 Agent 并行** | P5+P6 | 同时运行 Claude Code + Codex，Channel 通知推送 | 2026-03-14 ✅ |
| **M4: 全功能** | P7+P8 | Gemini 接入、worktree 隔离、任务编排 | 2026-03-14 ✅ |

## 实现状态

> 全部 8 Phase 已于 2026-03-14 完成初始实现。详见 devlog: `docs/devlogs/2026-03-14-multi-agent-coding-hub.md`
>
> **合理偏差**：`claude-code-watcher.ts`（Wrapper 模式）、WebSocket 双向通信、`PermissionCard` / `FileChangeCard` 组件未实现，SSE + REST 替代了 WebSocket 方案。
>
> **已知待修复**：`execSync` → `execFileSync`、SSE headers 设置时机、token usage 零值、内存清理策略等。见 devlog 详细列表。
