# 截图工具 & Claude Code 接入 — 需求分析

## 一、需求概述

| # | 功能 | 一句话描述 |
|---|------|-----------|
| 1 | **系统截图** | AI Agent 可截取桌面/窗口截图并发送给用户或用于视觉推理 |
| 2 | **Claude Code 接入** | 将 Claude Code (Agent SDK) 作为 Agent 运行时后端，获得代码读写、Shell、子代理等完整编程能力 |

### 参考项目

- [slopus/happy](https://github.com/slopus/happy) — Claude Code 的移动端/Web 客户端，通过 CLI wrapper 包装 Claude Code，支持远程会话同步、E2E 加密
- [slopus/happy-cli](https://github.com/slopus/happy-cli) — Happy 的 CLI 包装层，使用 `@anthropic-ai/claude-agent-sdk` 调用 Claude Code
- [steipete/claude-code-mcp](https://github.com/steipete/claude-code-mcp) — 将 Claude Code 暴露为 MCP Server 的 one-shot 方案

---

## 二、需求 1：系统截图

### 2.1 现状

YanClaw 已有 Playwright 浏览器截图工具（`browser_screenshot`），但仅能截取浏览器页面。缺少**系统级截图能力**——截取桌面全屏、指定窗口、指定区域。

### 2.2 功能描述

| 能力 | 说明 |
|------|------|
| 全屏截图 | 截取主显示器全屏 |
| 窗口截图 | 截取指定窗口（按标题/进程名匹配） |
| 区域截图 | 截取指定坐标区域 (x, y, width, height) |
| 返回格式 | base64 data URL (PNG)，可直接用于 vision 模型推理 |
| 跨平台 | Windows (优先)、macOS、Linux |

### 2.3 技术方案

**方案 A：Tauri IPC + 原生截图（推荐）**

桌面端通过 Tauri command 调用系统截图 API，Server 通过 IPC 获取截图结果。

```
Agent Tool (screenshot) → Server API → Tauri IPC → 系统截图 → base64 返回
```

- Windows: `win32` API (`BitBlt`) 或调用 PowerShell `[System.Windows.Forms.Screen]`
- macOS: `screencapture` CLI
- Linux: `scrot` / `gnome-screenshot` / `xdg` portal
- Tauri Rust 侧可使用 `xcap` crate（跨平台截图库）

优点：无需额外依赖，Tauri 原生支持
缺点：仅桌面端可用，纯 Server 模式不可用

**方案 B：Node.js 截图库**

使用 `screenshot-desktop` (npm) 在 Server 侧直接截图。

```
Agent Tool (screenshot) → screenshot-desktop → base64
```

优点：Server 模式也可用，实现简单
缺点：依赖原生模块，可能有兼容性问题

**方案 C：复用 Playwright**

使用 Playwright 截取任意屏幕（需 headful 模式 + `page.screenshot()`）。

缺点：无法截取浏览器外的内容，不满足需求

**推荐**：方案 A（桌面端）+ 方案 B 作为 fallback（纯 Server 模式）。

### 2.4 新增 Tool 定义

```typescript
// tools/screenshot.ts
screenshot_desktop: {
  description: "Take a screenshot of the desktop, a specific window, or a screen region.",
  parameters: {
    mode: "fullscreen" | "window" | "region",
    target?: string,        // 窗口标题（mode=window 时）
    region?: { x, y, w, h } // mode=region 时
  },
  returns: "data:image/png;base64,..."
}
```

### 2.5 安全考虑

- 该工具应为 **ownerOnly**（可能暴露敏感屏幕内容）
- 加入 `OWNER_ONLY_TOOLS` 和 capability `"desktop:capture"`
- 截图结果不应存入会话历史明文（仅传递 base64 引用，或保存到 MediaStore）
- 配合 leak detector 扫描截图中的 OCR 文本（可选，后续迭代）

### 2.6 工作量估算

| 任务 | 复杂度 |
|------|--------|
| Tauri 侧 `xcap` 截图 command | 中 |
| Server 侧 screenshot tool + fallback | 低 |
| Tool 注册 + 权限控制 | 低 |
| 前端截图结果渲染（image message） | 低 |
| **合计** | **~1-2 天** |

---

## 三、需求 2：Claude Code 接入

### 3.1 现状

YanClaw 的 `AgentRuntime` 使用 Vercel AI SDK (`streamText`) 驱动 Agent 循环，工具由 `createToolset` 注册。当前 Agent 的能力上限取决于手动定义的 tool 集合。

Claude Code（通过 Agent SDK）自带完整的文件读写、Shell、代码编辑、Web 搜索、子代理等能力，且由 Anthropic 持续维护迭代。

### 3.2 目标

引入 Claude Code 作为**可选的 Agent 运行时后端**，与现有 Vercel AI SDK 运行时并存：

```
config.agents[]:
  runtime: "default"       # 现有 streamText 运行时
  runtime: "claude-code"   # Claude Agent SDK 运行时
```

### 3.3 功能描述

| 能力 | 说明 |
|------|------|
| 编程代理 | Claude Code 的完整 tool 集：Read/Write/Edit/Bash/Glob/Grep/WebSearch/WebFetch |
| 流式输出 | Agent SDK `query()` 返回 AsyncGenerator，逐步推送 text-delta / tool_call / tool_result |
| 会话保持 | 利用 Agent SDK 的 session ID 保持上下文，映射到 YanClaw 的 sessionKey |
| 子代理 | 支持 Agent SDK 的 subagents（代码审查、测试运行等并行子代理） |
| 权限控制 | `allowedTools` 限制可用 tool，与 YanClaw 现有 tool policy 对齐 |
| 工作目录 | 使用 agent config 的 `workspaceDir` 作为 Agent SDK 的 `cwd` |
| MCP 集成 | 可选挂载额外 MCP server（如 Playwright MCP、数据库 MCP） |

### 3.4 架构设计

```
┌─────────────────────────────────────────────────┐
│                  AgentRuntime                    │
│                                                  │
│  ┌──────────────┐    ┌───────────────────────┐  │
│  │   default     │    │    claude-code         │  │
│  │  (streamText) │    │  (Agent SDK query())   │  │
│  │               │    │                         │  │
│  │  自定义 tools  │    │  内置 tools             │  │
│  │  Vercel AI    │    │  Read/Write/Edit/Bash   │  │
│  │  maxSteps:25  │    │  Glob/Grep/Web/Agent    │  │
│  └──────────────┘    └───────────────────────┘  │
│         ↓                      ↓                 │
│              统一 AgentEvent 流                   │
│         (delta/tool_call/tool_result/done)        │
└─────────────────────────────────────────────────┘
```

### 3.5 核心接口

```typescript
// agents/claude-code-runtime.ts
import { query } from "@anthropic-ai/claude-agent-sdk";

export async function* runClaudeCode(params: {
  prompt: string;
  sessionKey: string;
  workspaceDir: string;
  allowedTools?: string[];
  sessionId?: string;         // Agent SDK session ID (for resume)
  mcpServers?: Record<string, McpServerConfig>;
  systemPrompt?: string;
}): AsyncGenerator<AgentEvent> {

  for await (const message of query({
    prompt: params.prompt,
    options: {
      allowedTools: params.allowedTools ?? ["Read", "Edit", "Bash", "Glob", "Grep"],
      cwd: params.workspaceDir,
      resume: params.sessionId,
      systemPrompt: params.systemPrompt,
      mcpServers: params.mcpServers,
    },
  })) {
    // 将 Agent SDK message 映射为 YanClaw AgentEvent
    yield mapToAgentEvent(message, params.sessionKey);
  }
}
```

### 3.6 配置 Schema 扩展

```jsonc
// config.json5
{
  "agents": [
    {
      "id": "coder",
      "name": "Claude Coder",
      "runtime": "claude-code",       // 新增字段
      "workspaceDir": "/path/to/project",
      "claudeCode": {                  // 新增 claude-code 专属配置
        "allowedTools": ["Read", "Edit", "Bash", "Glob", "Grep", "WebSearch"],
        "permissionMode": "acceptEdits",  // default | acceptEdits | dangerouslySkipPermissions
        "maxTurns": 50,
        "mcpServers": {},              // 可选 MCP 服务
        "agents": {}                   // 可选子代理定义
      }
    }
  ]
}
```

### 3.7 事件映射

| Agent SDK Message | YanClaw AgentEvent |
|---|---|
| `type: "assistant", content.text` | `{ type: "delta", text }` |
| `type: "tool_use"` | `{ type: "tool_call", name, args }` |
| `type: "tool_result"` | `{ type: "tool_result", name, result }` |
| `type: "result"` | `{ type: "done", usage }` |
| `subtype: "init"` → `session_id` | 保存到 session 元数据，供后续 resume |

### 3.8 与 Happy 项目的区别

| 对比维度 | Happy | YanClaw |
|----------|-------|---------|
| 定位 | Claude Code 的移动端 Remote UI | AI Agent 网关平台 |
| Claude Code 角色 | 核心且唯一的后端 | 可选运行时之一 |
| 多 Agent | 不支持 | 支持多 Agent + 路由 |
| 多频道 | Web/Mobile | Telegram/Discord/Slack/WebChat |
| 会话管理 | E2E 加密同步 | SQLite + Server 端 |
| 适用场景 | 个人远程编程 | 团队/多频道 AI 助手平台 |

YanClaw 接入 Claude Code 是将其作为**编程类 Agent 的增强运行时**，而非替代整个平台。

### 3.9 安全考虑

- `permissionMode` 默认 `acceptEdits`（Claude Code 自带审批机制）
- Agent SDK 的 Bash tool 在 ownerOnly 模式下才可用
- 工作目录限制在 `workspaceDir` 内（Claude Code 默认行为）
- Claude Code 输出仍经过 YanClaw 的 leak detector 扫描
- API Key 使用 Vault 加密存储（已有）

### 3.10 依赖

```bash
bun add @anthropic-ai/claude-agent-sdk
```

需要 `ANTHROPIC_API_KEY` 环境变量或在 providers 中配置 Anthropic profile。

### 3.11 工作量估算

| 任务 | 复杂度 |
|------|--------|
| Config schema 扩展 (`runtime`, `claudeCode`) | 低 |
| `claude-code-runtime.ts` 运行时适配层 | 中 |
| AgentRuntime 路由（按 runtime 字段分发） | 低 |
| 事件映射 + 流式输出对接 | 中 |
| Session ID 映射与 resume | 中 |
| 前端 tool_call 渲染适配 | 低 |
| Onboarding 流程增加 Claude Code Agent 选项 | 低 |
| 测试 | 中 |
| **合计** | **~3-4 天** |

---

## 四、优先级与排期建议

| 阶段 | 内容 | 预计 |
|------|------|------|
| **P5-1** | 系统截图 tool (Tauri IPC + fallback) | 1-2 天 |
| **P5-2** | Claude Code 运行时接入 (核心链路) | 2-3 天 |
| **P5-3** | Claude Code 高级特性 (子代理、MCP) | 1-2 天 |
| **P5-4** | 集成测试 + 文档 | 1 天 |

总计约 **5-8 天**。

---

## 五、开放问题

1. **截图 OCR**：是否需要对截图内容做 OCR 提取文本？（可用 vision 模型替代，无需额外 OCR 库）
2. **Claude Code 会话持久化**：Agent SDK 的 session 保存在本地文件系统，是否需要与 YanClaw 的 SQLite session 双向同步？还是仅保存 session ID 映射？
3. **非 Anthropic 模型**：Claude Agent SDK 仅支持 Claude 模型，`runtime: "claude-code"` 的 agent 是否仍需要支持 model fallback 到 OpenAI？（答：不需要，该运行时专用 Anthropic）
4. **计费追踪**：Agent SDK 调用的 token 用量如何统计回 YanClaw 的 usage tracking？
5. **桌面端 vs Server 模式**：系统截图在纯 Server 模式（无 Tauri）下是否有意义？（headless server 无桌面环境）
