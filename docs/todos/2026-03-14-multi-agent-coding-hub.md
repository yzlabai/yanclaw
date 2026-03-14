# 多智能体编程管理中心 — 需求分析

## 一、问题陈述

开发者使用 Claude Code、Codex、Gemini CLI 等 Agent 编程工具时，每个 Agent 各占一个终端窗口。多 Agent 并行工作时（如前端 Agent、后端 Agent、测试 Agent），需要在多个窗口间反复切换，难以统一掌握进展、审批权限请求、管理工作流。

**核心需求**：YanClaw 作为统一管控面板，让用户在一处管理多个 Agent 编程会话。

### 参考项目

| 项目 | 架构 | 启发 |
|------|------|------|
| [Happy CLI](https://github.com/slopus/happy) | CLI wrapper + Daemon + 移动端 | Hook 拦截、JSONL 扫描、Daemon 多会话管理、Socket.io 实时同步 |
| Claude Code Remote Control | 浏览器→本地 Agent | WebSocket 双向控制 |

### Happy 实现细节（源码验证）

Happy 的架构比表面看起来更精巧，以下是从源码中提取的关键实现模式：

**1. 会话追踪：Hook + JSONL 双通道**

并非简单的 JSONL 轮询。Happy 使用 Claude Code 原生 `hooks.SessionStart` 注入一个 forwarder 脚本：

```
生成临时 settings → ~/.happy/tmp/hooks/session-hook-{pid}.json
内容: hooks.SessionStart[].command = "node forwarder.cjs {port}"
传递: claude --settings {path}
```

forwarder 脚本在每次 SessionStart 事件（新建/resume/compact）时 HTTP POST 到 Happy 的本地 HTTP 服务，上报 sessionId + 元数据。之后再通过 `fs.watch` + 3 秒轮询双保险扫描 `~/.claude/sessions/{id}.jsonl`。

**关键发现**：SessionScanner 同时追踪多个 session 文件（current + pending + finished），因为 Claude Code 在 `--resume` 后仍会写入旧 session 文件。

**2. SDK 控制协议：stdin/stdout JSON 管道**

Claude Code SDK 通过 `--output-format stream-json --verbose` 启动子进程，使用 **control_request/control_response** 协议实现工具权限审批：

```
Claude stdout → {"type":"control_request", tool, input}  // 请求权限
Happy stdin  → {"type":"control_response", behavior:"allow"|"deny"}  // 回复
```

这是实现远程权限审批的核心机制。支持 AbortController 中断。

**3. Daemon 进程管理**

- `Map<pid, TrackedSession>` 追踪所有会话
- 两种 spawn 路径：tmux（`tmux new-window` + PID 恢复）和直接 `child_process.spawn({detached:true})`
- 会话通过 webhook POST `/session-started` 自报到 Daemon
- 外部启动的 Claude Code 也可通过 webhook 被 Daemon 发现（不要求 Daemon 启动）
- 每 60 秒用 `process.kill(pid, 0)` 清理僵尸进程
- webhook 超时 15 秒（经验值，10 秒不够）

**4. Codex 接入：MCP 而非 stdout 解析**

Codex **不是**通过 stdout 解析，而是通过 MCP 协议：

```
spawns: codex mcp-server (v0.43.0+) 或 codex mcp (旧版)
transport: StdioClientTransport
权限: elicitation request 机制（非 control_request）
```

支持 sandbox 包装、版本检测、会话 resume（搜索 `${CODEX_HOME}/sessions/`）。

**5. 模式切换与消息队列**

`MessageQueue2` 按 `hash({permissionMode, model})` 分组消息。模式变更时触发会话边界，Codex 的实现甚至会重启整个 MCP session。

**6. 统一 Session Protocol（happy-wire 包）**

```typescript
Envelope { id, time, role:'user'|'agent', turn?, subagent?, ev: SessionEvent }
SessionEvent = text | service | tool-call-start | tool-call-end |
               file | turn-start | turn-end | start | stop
```

Zod 验证 + 角色约束（service/start/stop 仅 role=agent）。

### 与 Happy 的定位差异

| 维度 | Happy | YanClaw |
|------|-------|---------|
| 核心场景 | 一个用户远程监控一个 Claude Code | 一个用户管理多个异构 Agent |
| Agent 类型 | Claude Code 为主，Codex/Gemini 为辅 | Claude Code / Codex / Gemini / 自定义，平等对待 |
| 交互模式 | 移动端只读+简单输入 | Web/Desktop 全功能管理面板 |
| 多项目 | 单项目 | 多项目多工作区并行 |

---

## 二、用户故事

```
作为开发者，我想：
1. 在 YanClaw 面板上启动多个 Agent 编程会话，分配到不同子任务
2. 在一个仪表盘看到所有 Agent 的实时状态（运行中/等待审批/完成/出错）
3. 当 Agent 需要权限审批时，收到通知并在面板上一键批准/拒绝
4. 查看每个 Agent 的输出流（文本、工具调用、文件变更）
5. 随时向任意 Agent 发送指令或中断
6. 通过 Telegram/Slack 收到关键事件通知（完成、出错、等待审批）
7. 管理多个项目的工作区，每个项目可启动独立的 Agent 组
```

---

## 三、系统架构

```
┌──────────────────────────────────────────────────────────────┐
│                    YanClaw Multi-Agent Hub                    │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │                   Agent Supervisor                      │  │
│  │                                                         │  │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────┐ │  │
│  │  │ Claude   │  │ Codex   │  │ Gemini  │  │ Custom   │ │  │
│  │  │ Code     │  │ (MCP)   │  │ CLI     │  │ Agent    │ │  │
│  │  │ Adapter  │  │ Adapter │  │ Adapter │  │ Adapter  │ │  │
│  │  └────┬─────┘  └────┬────┘  └────┬────┘  └────┬─────┘ │  │
│  │       │              │            │             │        │  │
│  │       ▼              ▼            ▼             ▼        │  │
│  │  ┌──────────────────────────────────────────────────┐   │  │
│  │  │           Unified Event Bus (EventEmitter)        │   │  │
│  │  │  Events: text / tool-call / tool-result /         │   │  │
│  │  │          permission-request / status-change /      │   │  │
│  │  │          file-change / error / done                │   │  │
│  │  └──────────────────────────────────────────────────┘   │  │
│  └────────────────────────────────────────────────────────┘  │
│                            │                                  │
│          ┌─────────────────┼─────────────────┐               │
│          ▼                 ▼                  ▼               │
│   ┌────────────┐   ┌────────────┐    ┌──────────────┐       │
│   │  Web UI     │   │  Channel   │    │  Session     │       │
│   │  Dashboard  │   │  Notifier  │    │  Store (DB)  │       │
│   │  (WebSocket)│   │  (TG/Slack)│    │              │       │
│   └────────────┘   └────────────┘    └──────────────┘       │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、核心模块设计

### 4.1 Agent Supervisor（核心调度器）

管理所有 Agent 进程的生命周期。

```typescript
interface AgentProcess {
  id: string;                     // 唯一标识
  projectId: string;              // 所属项目
  type: "claude-code" | "codex" | "gemini" | "custom";
  status: "starting" | "running" | "waiting-approval" | "idle" | "stopped" | "error";
  pid?: number;                   // 子进程 PID
  workDir: string;                // 工作目录
  task?: string;                  // 当前任务描述
  startedAt: number;
  lastActivityAt: number;
  tokenUsage: { input: number; output: number };
}

interface AgentSupervisor {
  spawn(config: SpawnConfig): Promise<AgentProcess>;
  stop(id: string): Promise<void>;
  send(id: string, message: string): Promise<void>;
  approve(id: string, requestId: string): Promise<void>;
  deny(id: string, requestId: string): Promise<void>;
  list(): AgentProcess[];
  getEvents(id: string, since?: number): AgentEvent[];
}
```

### 4.2 Agent Adapters（适配层）

每种 Agent 工具一个 Adapter，统一为 `AgentEvent` 流。

#### Claude Code Adapter

两种接入模式：

| 模式 | 机制 | 适用场景 |
|------|------|----------|
| **SDK 模式** | `@anthropic-ai/claude-agent-sdk` `query()` | 程序化控制，完全集成 |
| **Wrapper 模式** | 子进程 + SessionStart Hook + JSONL 扫描 | 监控已有 Claude Code 实例 |

**SDK 模式**（推荐，已在 `2026-03-11-screenshot-and-claude-code.md` 中设计）直接调用 Agent SDK。

**Wrapper 模式**（参考 Happy）用于监控用户自行启动的 Claude Code：

```
1. 注入 SessionStart Hook → 获取 sessionId（Hook 在 resume/compact 时也触发）
2. fs.watch + 3s 轮询 ~/.claude/sessions/{sessionId}.jsonl
3. 逐行解析 JSONL，跳过内部事件（file-history-snapshot, change, queue-operation）
4. 去重：user/assistant/system 按 UUID，summary 按 leafUuid+text 组合键
5. 同时追踪多个 session 文件（current + pending + finished）
6. 通过 SDK control_request/control_response 管道实现权限审批
```

注意：Wrapper 模式下无法通过 stdin 直接输入（Claude Code 的 stdin 被 SDK 占用），
需通过 SDK 的 `query()` 接口或等待 Claude Code 开放的 RPC 通道发送消息。

#### Codex Adapter

Codex 通过 MCP 协议接入（参考 Happy 实现，非 stdout 解析）：

```
spawn: codex mcp-server (StdioClientTransport)
  → MCP message → mapCodexMcpMessageToSessionEnvelopes() → AgentEvent
  → 权限: elicitation request 机制
  → 版本检测: codex --version 区分 mcp vs mcp-server 子命令
  → resume: 搜索 ${CODEX_HOME}/sessions/ 恢复上下文
```

注意：Codex 模式变更（权限/模型切换）时需重启整个 MCP session。

#### Gemini CLI Adapter

Gemini 使用 ACP（Agent Communication Protocol），Happy 通过 `streamText()` + AgentBackend 抽象层接入：

```
Gemini agent (ACP transport)
  → AgentBackend.onMessage() → AgentEvent
  → 权限模式映射: yolo→bypassPermissions, safe-yolo→default
```

#### 自定义 Adapter

YanClaw 现有的 `streamText` 运行时（Vercel AI SDK）作为自定义 Agent，已有完整实现。

### 4.3 统一事件协议

```typescript
type AgentEvent =
  | { type: "text"; agentId: string; text: string; thinking?: boolean }
  | { type: "tool-call"; agentId: string; name: string; args: unknown; callId: string }
  | { type: "tool-result"; agentId: string; callId: string; result: unknown }
  | { type: "permission-request"; agentId: string; requestId: string;
      tool: string; args: unknown; description: string }
  | { type: "file-change"; agentId: string; path: string; action: "create" | "edit" | "delete" }
  | { type: "status-change"; agentId: string; status: AgentProcess["status"] }
  | { type: "error"; agentId: string; message: string }
  | { type: "done"; agentId: string; summary?: string; usage?: TokenUsage };
```

### 4.4 Dashboard UI

| 视图 | 功能 |
|------|------|
| **总览** | 所有 Agent 卡片，状态灯（绿=运行/黄=等待/红=出错/灰=停止），一键操作 |
| **Agent 详情** | 实时输出流（文本+工具调用折叠展示）、文件变更 diff、token 用量 |
| **权限审批** | 待审批队列，显示工具名+参数+风险等级，批量批准/拒绝 |
| **项目视图** | 按项目分组 Agent，显示项目级进度 |
| **任务分配** | 创建任务描述 → 选择 Agent 类型 → 选择工作目录 → 启动 |

### 4.5 通知与告警

利用 YanClaw 已有的 Channel 体系（Telegram/Slack/Discord），当 Agent 状态变化时通过绑定的频道推送通知：

```
[🔔 Agent coder-frontend] 等待审批: shell_exec `npm run build`
[✅ Agent coder-backend] 任务完成: "实现用户认证 API"，耗时 12 分钟，token: 45k
[❌ Agent tester] 错误: 测试运行失败，3 个用例未通过
```

---

## 五、与现有架构的关系

> **重要发现**：经源码验证，以下模块已部分实现，无需从零开始：
> - `runtime: "claude-code"` 已在 config schema 中定义（含 `claudeCode` 配置段）
> - `session_send` / `session_list` / `session_history` 工具已存在，可作为 Agent 间通信基础
> - `ApprovalManager` 已有完整的工具执行审批框架
> - `AgentEvent` 已定义 `delta` / `thinking` / `tool_call` / `tool_result` / `done` / `error` 等类型

| YanClaw 现有模块 | 复用方式 |
|------------------|----------|
| `AgentRuntime` | 已支持 `runtime: "claude-code"` 分发，需补充 `codex` / `gemini` runtime |
| `SessionStore` | 每个 AgentProcess 对应一个 session，复用消息存储 |
| `ChannelManager` | 复用现有通知推送能力 |
| `ApprovalManager` | 直接复用工具审批流，扩展为远程 Agent 权限审批 |
| `ToolPolicy` | 扩展应用到外部 Agent 的权限审批 |
| `session_send` 工具 | 已有 Agent 间消息发送能力，扩展为 Agent 协作通信 |
| `MediaStore` | 复用存储 Agent 产生的截图/文件 |
| `Config Schema` | 新增 `projects` 配置段（`runtime`/`claudeCode` 已有） |
| Web UI | 新增 `/agents-hub` 路由，复用 prompt-kit 组件 |

---

## 六、配置示例

**配置层（静态）**：定义可用 Agent 模板和项目工作区

```jsonc
// config.json5 — agents 段（已有，扩展 runtime 类型）
{
  "agents": [
    {
      "id": "claude-coder",
      "name": "Claude Coder",
      "runtime": "claude-code",        // 已有字段
      "workspaceDir": "/Users/dev/my-app",
      "claudeCode": {                   // 已有配置段
        "allowedTools": ["Read", "Edit", "Bash", "Glob", "Grep"],
        "permissionMode": "acceptEdits"
      }
    },
    {
      "id": "codex-coder",
      "name": "Codex Coder",
      "runtime": "codex",              // 新增 runtime 类型
      "workspaceDir": "/Users/dev/my-app",
      "codex": { "mode": "full-auto" }
    }
  ],
  // 新增：多 Agent 管理中心配置
  "agentHub": {
    "enabled": true,
    "notifyChannel": "telegram:owner",
    "notifyEvents": ["permission-request", "done", "error"],
    "maxConcurrentAgents": 5,
    "approvalTimeout": 1800             // 秒，默认 30 分钟
  }
}
```

**运行时层（动态）**：任务通过 API/UI 创建，不写入 config

```
POST /api/agent-hub/tasks
{
  "agentId": "claude-coder",
  "task": "实现登录页面 UI",
  "workDir": "./packages/web",    // 可选覆盖 agent 的 workspaceDir
  "worktree": true                // 自动创建 git worktree 隔离
}
→ 返回 { processId, status: "starting" }
```

---

## 七、实现阶段

| 阶段 | 内容 | 前置依赖 | 复杂度 |
|------|------|----------|--------|
| **P1: Agent Supervisor 核心** | 进程管理、生命周期、事件总线 | 无 | 高 |
| **P2: Claude Code Adapter** | SDK 模式 + Wrapper 模式 | P1 + `@anthropic-ai/claude-agent-sdk` | 中 |
| **P3: Dashboard UI** | 总览、详情、审批界面 | P1 | 高 |
| **P4: Codex Adapter** | MCP client (StdioClientTransport) + 权限映射 | P1 | 中 |
| **P5: 通知集成** | Channel 推送 Agent 事件 | P1 + 现有 ChannelManager | 低 |
| **P6: Gemini Adapter** | 子进程接入 | P1 | 中 |
| **P7: 项目管理** | 多项目视图、任务分配 UI | P3 | 中 |
| **P8: 高级功能** | Agent 协作（共享上下文/成果物传递）、自动任务拆分 | P7 | 高 |

---

## 八、关键技术决策

### 8.1 进程管理策略

**推荐：子进程模式**

每个 Agent 作为独立子进程运行，YanClaw 通过 stdio/IPC 通信。

优点：进程隔离、崩溃不影响主进程、可独立资源限制
缺点：进程间通信开销、需要处理孤儿进程

参考 Happy 的 Daemon 模式：PID 追踪 + 控制 HTTP Server + 状态文件。

### 8.2 Agent 间协作

阶段性实现：

1. **V1 - 独立并行**：各 Agent 独立工作，用户手动协调
2. **V2 - 成果物传递**：Agent A 完成后自动将结果传递给 Agent B
3. **V3 - 共享上下文**：Agent 间可查看彼此的文件变更和输出

### 8.3 权限审批流

```
Agent 请求执行危险操作
  → Adapter 拦截，生成 permission-request 事件
  → Supervisor 推入审批队列
  → 通知用户（Web UI badge + Channel 推送）
  → 用户审批/拒绝
  → Supervisor 回传结果给 Adapter
  → Adapter 响应 Agent
```

超时策略：可配置自动拒绝超时（默认 30 分钟）。

---

## 九、从 Happy 实现中提取的经验教训

| 经验 | Happy 做法 | YanClaw 应用 |
|------|-----------|-------------|
| **不要只靠轮询** | fs.watch + 3s 轮询双保险，避免 fs.watch 在某些 OS 不可靠 | 同样采用双通道 |
| **Hook 比侵入式好** | 利用 Claude Code 原生 hooks 配置，不修改 Claude 行为 | 优先用官方扩展点 |
| **session 切换要平滑** | 新 session 创建后旧 session 文件仍可能写入，需同时监控 | SessionScanner 追踪 current+pending+finished |
| **权限审批是阻塞的** | control_request 写到 stdout 后 Claude 会暂停等 response | 审批超时必须有默认策略 |
| **Codex 重启代价高** | 模式切换导致整个 MCP session 重建 | 尽量减少运行时模式变更 |
| **Daemon 必须 detached** | spawn({detached:true}) 让 session 存活于 Daemon 重启 | 进程解耦，PID 文件+webhook 自报 |
| **webhook 超时要宽** | 15s（经验值，10s 不够） | 设 20s 或可配置 |
| **tmux 是好的多窗口方案** | Daemon 优先用 tmux 管理多 session | 可选 tmux 后端，方便用户直接 attach 调试 |

---

## 十、开放问题

1. **Git 冲突**：多个 Agent 同时修改同一仓库时如何处理 git 冲突？方案：每个 Agent 使用独立 git worktree（参考 Claude Code 的 worktree 模式）
2. **Token 预算**：是否需要为每个 Agent 设置 token 上限？超限自动停止？
3. **Agent 编排语言**：是否需要支持声明式的任务编排（如 DAG），还是 V1 仅支持手动管理？
4. **Codex 稳定性**：Codex CLI 的输出格式是否有稳定的解析契约？需要持续适配风险评估
5. **安全边界**：多个 Agent 在同一台机器上运行，是否需要 OS 级隔离（Docker/sandbox）？
6. **Wrapper 模式的局限**：JSONL 扫描模式只能监控本机 Claude Code，远程机器上的 Agent 如何接入？
