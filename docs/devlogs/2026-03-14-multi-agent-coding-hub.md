# 2026-03-14 Multi-Agent Coding Hub — 开发总结

## 概述

为 YanClaw 新增多智能体编程管理中心（Agent Hub），用户可通过统一 Dashboard 管理 Claude Code、Codex、Gemini CLI 等多个 AI 编程 Agent 的启停、输出查看、权限审批和任务编排，无需切换多个终端窗口。

对照计划文档：`docs/plans/2026-03-14-multi-agent-coding-hub.md`

## 架构设计

```
┌─────────────────────────────────────────────────────────┐
│  Web Dashboard (React + shadcn/ui)                      │
│  AgentHub / ProcessCard / ProcessDetail / TaskDAGView   │
│        ↕ SSE + REST API                                 │
├─────────────────────────────────────────────────────────┤
│  Hono Routes: /api/agent-hub/*                          │
│  spawn / stop / send / approve / worktree / dags        │
├─────────────────────────────────────────────────────────┤
│  AgentSupervisor                                        │
│  ├── AdapterFactory Registry                            │
│  ├── Process Map + Event Bus                            │
│  ├── Permission Approval (risk classification)          │
│  ├── Git Worktree Manager                               │
│  ├── onDone Inter-Agent Communication                   │
│  └── Task DAG Orchestrator (cycle detection + topo)     │
├─────────────────────────────────────────────────────────┤
│  Adapters (AgentAdapter interface)                      │
│  ├── ClaudeCodeAdapter  — Agent SDK query()             │
│  ├── CodexAdapter       — MCP StdioClientTransport      │
│  └── GeminiAdapter      — CLI child_process + JSONL     │
├─────────────────────────────────────────────────────────┤
│  AgentHubNotifier → ChannelManager (TG/Slack/Discord)   │
└─────────────────────────────────────────────────────────┘
```

## 功能矩阵

### Phase 1-3：核心后端

| 功能 | 说明 | 关键文件 |
|------|------|----------|
| AgentSupervisor | 进程生命周期管理，60s 检活，并发上限控制 | `agents/supervisor/index.ts` |
| Adapter 模式 | 统一接口，工厂注册，3 种 runtime 适配器 | `agents/supervisor/adapter.ts` |
| 权限审批 | 3 级风险分类（low/medium/high），超时自动拒绝 | `supervisor/index.ts:classifyRisk` |
| Git Worktree | spawn 时自动创建隔离分支，stop 时可清理 | `supervisor/index.ts:cleanupWorktree` |
| REST API | 9 个端点（CRUD + SSE 事件流） | `routes/agent-hub.ts` |
| SSE 推送 | 单进程 + 全局两级事件流，30s keepalive | `routes/agent-hub.ts` |

### Phase 4：Dashboard UI

| 组件 | 说明 | 关键文件 |
|------|------|----------|
| AgentHub 页面 | 三栏布局，响应式（桌面/平板/手机） | `pages/AgentHub.tsx` |
| ProcessCard | 6 种状态颜色 + 脉冲动画，token/时长统计 | `components/agent-hub/ProcessCard.tsx` |
| ProcessDetail | 信息栏 + prompt-kit 输出流 + 输入区 | `components/agent-hub/ProcessDetail.tsx` |
| SpawnDialog | Agent 模板选择、任务描述、Worktree 开关、高级选项 | `components/agent-hub/SpawnDialog.tsx` |
| ApprovalQueue | 侧边抽屉，风险色卡片，批量操作，倒计时 | `components/agent-hub/ApprovalQueue.tsx` |

### Phase 5-7：适配器与通知

| 功能 | 说明 | 关键文件 |
|------|------|----------|
| Claude Code | Agent SDK `query()` 流式消费，权限拦截，会话恢复 | `adapters/claude-code.ts` |
| Codex | MCP 协议，`StdioClientTransport`，版本检测 | `adapters/codex.ts` |
| Gemini | CLI 子进程，JSONL + 纯文本双模式解析 | `adapters/gemini.ts` |
| 通知桥 | 事件过滤 → 格式化 → Channel 推送，热重载配置 | `supervisor/notifier.ts` |

### Phase 8：高级功能

| 功能 | 说明 | 关键文件 |
|------|------|----------|
| Worktree UI | 分支名、commit 数、变更文件展示 + 清理按钮 | `ProcessDetail.tsx` |
| onDone 通信 | 完成后通知其他进程 / 自动 spawn 后续 Agent | `supervisor/index.ts:executeOnDone` |
| 任务 DAG | 声明式依赖图，环检测，拓扑推进，级联跳过 | `supervisor/index.ts:startDAG` |
| DAG UI | DAG 卡片列表 + 创建对话框（动态任务节点） | `TaskDAGView.tsx` |

## 文件变更清单

### 新建文件 — Server（7 个）

| 文件 | 说明 |
|------|------|
| `server/src/agents/supervisor/types.ts` | AgentProcess、PermissionRequest、TaskDAG 等类型 |
| `server/src/agents/supervisor/adapter.ts` | AgentAdapter 接口 |
| `server/src/agents/supervisor/index.ts` | AgentSupervisor 核心（~650 行） |
| `server/src/agents/supervisor/notifier.ts` | Channel 通知桥 |
| `server/src/agents/supervisor/adapters/claude-code.ts` | Claude Code SDK 适配器 |
| `server/src/agents/supervisor/adapters/codex.ts` | Codex MCP 适配器 |
| `server/src/agents/supervisor/adapters/gemini.ts` | Gemini CLI 适配器 |

### 新建文件 — Web（7 个）

| 文件 | 说明 |
|------|------|
| `web/src/pages/AgentHub.tsx` | 主页面 |
| `web/src/hooks/useAgentHub.ts` | 进程列表 + SSE + API 方法 |
| `web/src/hooks/useProcessEvents.ts` | 单进程 SSE 事件流 hook |
| `web/src/components/agent-hub/ProcessCard.tsx` | 进程卡片 |
| `web/src/components/agent-hub/ProcessDetail.tsx` | 详情面板 |
| `web/src/components/agent-hub/SpawnDialog.tsx` | 启动对话框 |
| `web/src/components/agent-hub/ApprovalQueue.tsx` | 审批队列 |
| `web/src/components/agent-hub/TaskDAGView.tsx` | DAG 视图 + 创建对话框 |
| `web/src/components/ui/sheet.tsx` | shadcn Sheet 组件 |

### 修改文件（5 个）

| 文件 | 变更 |
|------|------|
| `server/src/gateway.ts` | GatewayContext 加入 Supervisor + Notifier + 3 adapter factory + configResolver |
| `server/src/config/schema.ts` | agentHub 配置块 + runtime 新增 codex/gemini + 各自配置 |
| `server/src/app.ts` | 注册 agent-hub 路由 |
| `web/src/App.tsx` | 路由 + Sidebar 菜单项 |
| `web/src/i18n/locales/{zh,en}.json` | nav.agentHub 国际化 |

## Code Review 发现

### 已知问题

| # | 级别 | 问题 | 状态 |
|---|------|------|------|
| 1 | 中 | `execSync` → `execFileSync` 避免 shell 注入 | ✅ 已修复 — 5 处改为 array args |
| 2 | 中 | SSE headers 在 `stream()` 回调内设置 | ✅ 已修复 — 移到 `stream()` 前 |
| 3 | 低 | Codex/Gemini adapter token usage 始终为 0 | ⏳ 待修复 — 需对接真实 runtime 测试 |
| 4 | 低 | 已停止进程永不从内存 Map 移除 | ✅ 已修复 — 30min TTL 自动清理 |
| 5 | 低 | 审批超时 setTimeout 无法取消 | ✅ 已修复 — `approvalTimers` Map + clearTimeout |
| 6 | 低 | 风险分类 `classifyRisk` 不区分大小写 | ✅ 已修复 — `toolLower` |
| 7 | 低 | ProcessDetail/ProcessCard elapsed time 不自动刷新 | ✅ 已修复 — useEffect + setInterval(1s) |
| 8 | 低 | Codex/Gemini `tool_result` 缺少 `duration` 字段 | ✅ 已修复 — 补充默认值 0 |
| 9 | 低 | Codex adapter 缺少 `ChildProcess` 类型导入 | ✅ 已修复 |

### 计划偏差（合理简化）

| 计划内容 | 实际 | 原因 |
|----------|------|------|
| `claude-code-watcher.ts` (Wrapper 模式) | 未实现 | SDK 模式已覆盖主场景 |
| WebSocket 双向通信 (Step 3.2) | SSE + REST | SSE 足够，架构更简单 |
| `HubToolbar.tsx` 独立组件 | 内联在 AgentHub.tsx | 代码量不大，无需抽离 |
| `PermissionCard.tsx` / `FileChangeCard.tsx` | 未实现 | 审批走 ApprovalQueue 侧边栏，文件变更在 ToolCall 中展示 |
| Sidebar 审批通知红点 | 未实现 | 需要全局状态穿透 Sidebar |

## Config 示例

```jsonc
{
  "agentHub": {
    "enabled": true,
    "notifyChannel": "telegram:bot_prod#-1001234567890",
    "notifyEvents": ["done", "error", "permission-request"],
    "maxConcurrentAgents": 5,
    "approvalTimeout": 1800
  },
  "agents": [
    {
      "id": "claude-coder",
      "runtime": "claude-code",
      "claudeCode": {
        "permissionMode": "acceptEdits",
        "maxTurns": 50
      }
    },
    {
      "id": "codex-coder",
      "runtime": "codex",
      "codex": {
        "mode": "full-auto"
      }
    },
    {
      "id": "gemini-coder",
      "runtime": "gemini",
      "gemini": {
        "permissionMode": "safe-yolo"
      }
    }
  ]
}
```

## API 端点汇总

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/agent-hub/processes` | 列出所有进程 + 待审批 |
| GET | `/api/agent-hub/processes/:id` | 单个进程详情 |
| POST | `/api/agent-hub/spawn` | 启动新 Agent |
| POST | `/api/agent-hub/processes/:id/send` | 发送消息 |
| POST | `/api/agent-hub/processes/:id/approve` | 审批权限请求 |
| POST | `/api/agent-hub/processes/:id/stop` | 停止进程 |
| GET | `/api/agent-hub/processes/:id/events` | SSE 单进程事件流 |
| GET | `/api/agent-hub/processes/:id/worktree` | Worktree 状态 |
| DELETE | `/api/agent-hub/processes/:id/worktree` | 清理 Worktree |
| GET | `/api/agent-hub/events` | SSE 全局事件流 |
| GET | `/api/agent-hub/approvals` | 所有待审批 |
| POST | `/api/agent-hub/dags` | 创建并启动 DAG |
| GET | `/api/agent-hub/dags` | 列出所有 DAG |
| GET | `/api/agent-hub/dags/:id` | 单个 DAG 详情 |
