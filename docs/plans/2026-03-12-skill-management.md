# Skill 管理系统 — 设计文档

> 日期：2026-03-12
> 状态：Draft — 待 Review

## 背景

OpenClaw 的 Skill 系统是其核心竞争力之一：ClawHub 上有 13,700+ 社区 Skill，用户通过 `/skill install @author/name` 一键安装即可扩展 agent 能力。但其设计存在致命缺陷：

- **SKILL.md 直接注入 agent prompt** — prompt injection by design
- **无沙箱** — Skill 拥有 agent 全部权限
- **无代码签名** — ClawHavoc 事件中 1,184 个恶意 Skill 感染 9,000+ 用户
- **扁平命名空间** — 同名 Skill 靠优先级覆盖，易被恶意替换

YanClaw 已有 Plugin 系统框架（类型安全接口、Worker 隔离、命名空间、3 层 tool policy），但存在关键缺口：

1. **Plugin tools 未接入 agent runtime** — `createToolset()` 不包含 plugin tools
2. **Lifecycle hooks 未实际调用** — `beforeToolCall` / `afterToolCall` / `onMessageInbound` 已定义但未接线
3. **无安装/管理 UI** — 只有 `GET /api/plugins` 列表接口
4. **无 Skill 格式定义** — Plugin 需要写 TypeScript 代码，门槛较高

本文档设计一个**安全优先、类型安全**的 Skill 管理系统，取 OpenClaw 的易用性，弃其安全缺陷。

---

## 设计原则

1. **安全闭环** — Skill 必须声明 capabilities，走现有 3 层 tool policy + capability 过滤
2. **类型安全** — Skill 定义用 JSON Schema + TypeScript，不用 Markdown prompt injection
3. **渐进式** — 先打通已有 Plugin → Agent Runtime 的桥梁，再加 UI 和安装流程
4. **向下兼容** — 不破坏现有 Plugin 系统，Skill 是 Plugin 的一个特化子集

---

## 核心概念

### Skill vs Plugin 的关系

```
Plugin（底层）
  ├── tools         → 注册到 agent 工具集
  ├── channels      → 注册到 channelRegistry
  └── hooks         → lifecycle 拦截

Skill（上层封装）= Plugin + 元数据 + prompt + UI 管理
  ├── skill.json    → 元数据（id, 依赖, capabilities, 配置项）
  ├── prompt.md     → 使用说明（经 sanitize 后注入 system prompt）
  ├── index.ts      → Plugin 实现（tools, hooks）
  └── README.md     → 人类可读文档（不注入 agent）
```

Skill 本质是一个拥有标准化元数据的 Plugin。`PluginRegistry` 不需要修改——Skill 加载后注册为普通 Plugin。

### Skill 定义格式 — `skill.json`

```json5
{
  // 基本信息
  "id": "tavily-search",
  "name": "Tavily Web Search",
  "version": "1.0.0",
  "description": "使用 Tavily API 搜索互联网获取实时信息",
  "author": "yanclaw",
  "license": "MIT",
  "tags": ["search", "web", "research"],
  "icon": "🔍",               // 可选，UI 展示用

  // 依赖声明
  "requires": {
    "env": ["TAVILY_API_KEY"],    // 必需的环境变量
    "bins": [],                    // 必需的 CLI 工具
    "yanclaw": ">=0.7.0"          // 最低 YanClaw 版本
  },

  // 安全声明
  "capabilities": ["net:http"],   // 声明需要的能力（对应 TOOL_CAPABILITIES）
  "isolated": false,              // 是否要求 Worker 隔离
  "ownerOnly": false,             // 是否仅 owner 可用

  // 配置项（Skill 专用配置，用户在 UI 上填写）
  "config": {
    "maxResults": {
      "type": "number",
      "default": 5,
      "description": "每次搜索返回的最大结果数"
    },
    "searchDepth": {
      "type": "string",
      "enum": ["basic", "advanced"],
      "default": "basic",
      "description": "搜索深度"
    }
  },

  // Agent 接入
  "prompt": "prompt.md",          // 可选，经 sanitize 注入 system prompt 的使用说明
  "tools": ["search", "news"],    // 声明导出的 tool 名称（用于 UI 展示）

  // 入口
  "main": "index.ts"              // Plugin 入口文件
}
```

### prompt.md — 安全的指令注入

与 OpenClaw SKILL.md body 直接注入不同，YanClaw 的 prompt.md：

1. **经过 `detectInjection()` 扫描** — 检测角色覆盖、系统提示覆盖等注入模式
2. **经过 `sanitizePrompt()` 清洗** — 移除危险指令（如"ignore previous instructions"）
3. **包裹在边界标记中** — `[SKILL:tavily-search] ... [/SKILL:tavily-search]`
4. **长度限制** — 最大 2000 字符（超出截断并警告）
5. **可在 UI 中预览和编辑** — 用户可以审阅注入内容

```markdown
当用户要求搜索互联网、查找最新信息、或需要实时数据时，使用 tavily-search.search 工具。
- 默认使用 basic 深度，仅在用户明确要求深入搜索时使用 advanced
- 搜索结果已包含摘要，无需重复访问链接
- 对于新闻类查询，优先使用 tavily-search.news 工具
```

---

## 实现计划

### Phase 1：Plugin → Agent Runtime 桥梁（核心）

**目标**：让已有的 Plugin tools 能被 agent 使用，打通完整链路。

#### 1.1 Plugin Tools 接入 createToolset()

**修改文件**：`packages/server/src/agents/tools/index.ts`

在 `createToolset()` 中，MCP tools 之后加入 plugin tools：

```typescript
// Plugin tools — bridge from PluginRegistry into the toolset
if (opts.pluginRegistry) {
  for (const [qualifiedName, pluginTool] of opts.pluginRegistry.getTools()) {
    // qualifiedName = "pluginId.toolName"
    allTools[qualifiedName] = tool({
      description: pluginTool.description,
      parameters: pluginTool.parameters,
      execute: async (input) => pluginTool.execute(input),
    }) as ReturnType<typeof createShellTool>;

    // Register capability requirements for plugin tools
    // Read from skill.json capabilities, default to empty (no restriction)
  }
}
```

**新增 opts 参数**：

```typescript
export async function createToolset(opts: {
  // ... 现有参数 ...
  pluginRegistry?: PluginRegistry;  // 新增
})
```

**对 `TOOL_CAPABILITIES` 的扩展**：

Plugin tools 的 capability 需求从 `skill.json` 的 `capabilities` 字段读取，在加载时注入到一个动态 map：

```typescript
// PluginRegistry 新增方法
getToolCapabilities(): Map<string, string[]>
```

`createToolset` 中的 `hasCapabilities()` 检查需要同时查 `TOOL_CAPABILITIES`（内置）和 `pluginRegistry.getToolCapabilities()`（插件）。

#### 1.2 Lifecycle Hooks 接线

**修改文件**：`packages/server/src/agents/runtime.ts`

在 `_runInternal()` 中：

```
tool-call 事件处: （现有的 loopDetector.check + checkDataFlow 之后）
  + await pluginRegistry.runBeforeToolCall({ name, input: args })
  + if (result === null) → skip tool execution, yield blocked event

tool-result 事件处:（现有的 loopDetector.recordOutput + wrapUntrustedContent 之后）
  + await pluginRegistry.runAfterToolCall({ name, input }, result)
```

**修改文件**：`packages/server/src/channels/manager.ts`

在消息处理入口：

```
收到 inbound message 后:
  + const filtered = await pluginRegistry.runMessageInbound(message)
  + if (filtered === null) → drop message, return
```

#### 1.3 传递 PluginRegistry 到 AgentRuntime

**修改文件**：

| 文件 | 修改 |
|------|------|
| `packages/server/src/agents/runtime.ts` | 构造函数新增 `pluginRegistry` 参数 |
| `packages/server/src/gateway.ts` | `new AgentRuntime(...)` 时传入 `pluginRegistry` |

AgentRuntime 在调 `createToolset()` 时传入 `pluginRegistry`。

---

### Phase 2：Skill 加载器 + 配置

**目标**：支持 `skill.json` 格式，增强加载和配置能力。

#### 2.1 SkillLoader — 增强的加载器

**新建文件**：`packages/server/src/plugins/skill-loader.ts`

```typescript
export interface SkillManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  tags?: string[];
  icon?: string;
  requires?: {
    env?: string[];
    bins?: string[];
    yanclaw?: string;
  };
  capabilities?: string[];
  isolated?: boolean;
  ownerOnly?: boolean;
  config?: Record<string, SkillConfigField>;
  prompt?: string;       // prompt.md 路径
  tools?: string[];      // 导出的 tool 名称列表
  main?: string;         // 入口文件，默认 index.ts
}

export interface SkillConfigField {
  type: "string" | "number" | "boolean";
  default?: unknown;
  description?: string;
  enum?: unknown[];
}

export class SkillLoader {
  /**
   * 从 skill.json 加载 Skill。
   * 1. 读取 skill.json → 验证 manifest
   * 2. 检查依赖（env, bins, version）
   * 3. 加载 prompt.md → sanitize
   * 4. import(main) → 得到 PluginDefinition
   * 5. 合并 manifest 元数据到 Plugin
   * 6. 注册到 PluginRegistry
   */
  async loadSkill(skillPath: string, config: SkillConfig): Promise<SkillDefinition | null>;
}
```

加载优先级：
1. 先尝试读 `skill.json` → 走 SkillLoader
2. 回退到现有 PluginLoader 逻辑（直接 import index.ts）

#### 2.2 Prompt Sanitization

**修改文件**：`packages/server/src/security/sanitize.ts`

新增 `sanitizeSkillPrompt()`:

```typescript
export function sanitizeSkillPrompt(
  raw: string,
  skillId: string,
  maxLength = 2000
): { sanitized: string; warnings: string[] } {
  const warnings: string[] = [];

  // 1. 长度限制
  let text = raw.slice(0, maxLength);
  if (raw.length > maxLength) {
    warnings.push(`Prompt truncated from ${raw.length} to ${maxLength} chars`);
  }

  // 2. 注入检测
  const injection = detectInjection(text);
  if (injection.detected) {
    warnings.push(`Injection patterns detected: ${injection.patterns.join(", ")}`);
    // 移除检测到的危险模式
    for (const pattern of injection.patterns) {
      text = text.replace(new RegExp(pattern, "gi"), "[REMOVED]");
    }
  }

  // 3. 包裹边界标记
  const sanitized = `[SKILL:${skillId}]\n${text}\n[/SKILL:${skillId}]`;

  return { sanitized, warnings };
}
```

#### 2.3 System Prompt 集成

**修改文件**：`packages/server/src/agents/system-prompt-builder.ts`

在 `buildSystemPrompt()` 中，将启用的 Skill prompts 注入 system prompt：

```
## Available Skills

[SKILL:tavily-search]
当用户要求搜索互联网...
[/SKILL:tavily-search]

[SKILL:code-runner]
当用户要求执行代码...
[/SKILL:code-runner]
```

#### 2.4 Config Schema 扩展

**修改文件**：`packages/server/src/config/schema.ts`

```typescript
plugins: z.object({
  enabled: z.record(z.boolean()).default({}),
  dirs: z.array(z.string()).default([]),
  // 新增：Skill 专用配置
  skills: z.record(z.object({
    enabled: z.boolean().default(true),
    config: z.record(z.unknown()).default({}),  // 用户填写的 Skill 配置
    agents: z.array(z.string()).default([]),      // 分配给哪些 agent（空=全部）
  })).default({}),
}).default({}),
```

#### 2.5 Skill 安装机制

**新建文件**：`packages/server/src/plugins/skill-installer.ts`

支持三种安装来源：

```typescript
export class SkillInstaller {
  /** 从本地目录安装（复制到 ~/.yanclaw/skills/） */
  async installLocal(sourcePath: string): Promise<SkillManifest>;

  /** 从 Git URL 安装 */
  async installGit(url: string, ref?: string): Promise<SkillManifest>;

  /** 从 npm 包安装 */
  async installNpm(packageName: string, version?: string): Promise<SkillManifest>;

  /** 卸载 Skill */
  async uninstall(skillId: string): Promise<void>;

  /** 列出已安装的 Skills */
  async listInstalled(): Promise<SkillManifest[]>;
}
```

安装目录结构：

```
~/.yanclaw/skills/
  tavily-search/
    skill.json
    prompt.md
    index.ts
    package.json
  code-runner/
    skill.json
    index.ts
```

---

### Phase 3：Skill 管理 API + Web UI

**目标**：提供完整的 Skill 管理界面。

#### 3.1 REST API

**新建文件**：`packages/server/src/routes/skills.ts`

```typescript
export const skillsRoute = new Hono()
  // 列出所有 Skill（含已安装 + 可用状态）
  .get("/", handler)

  // 获取单个 Skill 详情（manifest + 状态 + prompt 预览）
  .get("/:skillId", handler)

  // 安装 Skill
  .post("/install", zValidator("json", z.object({
    source: z.enum(["local", "git", "npm"]),
    url: z.string(),           // 路径 / Git URL / npm 包名
    ref: z.string().optional(), // Git ref / npm version
  })), handler)

  // 卸载 Skill
  .delete("/:skillId", handler)

  // 启用/禁用 Skill
  .patch("/:skillId", zValidator("json", z.object({
    enabled: z.boolean().optional(),
    config: z.record(z.unknown()).optional(),
    agents: z.array(z.string()).optional(),
  })), handler)

  // 获取 Skill 的 prompt 内容（sanitized 预览）
  .get("/:skillId/prompt", handler)
```

**注册路由**：修改 `packages/server/src/app.ts`，新增 `.route("/api/skills", skillsRoute)`

#### 3.2 Web UI — Skills 管理页面

**新建文件**：`packages/web/src/pages/Skills.tsx`

页面布局：

```
┌─────────────────────────────────────────────────┐
│  Skills                          [+ Install]     │
├─────────────────────────────────────────────────┤
│  🔍 Search skills...                             │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ 🔍 Tavily Search         v1.0.0     ✅ ON   │ │
│  │ 使用 Tavily API 搜索互联网              │ │
│  │ Tools: search, news  │  Agents: all          │ │
│  │ Capabilities: net:http                       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ 🐍 Code Runner           v1.0.0     ⚠️ OFF  │ │
│  │ 在沙箱中执行 Python/JS 代码             │ │
│  │ Tools: run_code  │  Agents: dev-agent        │ │
│  │ Capabilities: exec:sandbox                   │ │
│  │ ⚠️ Missing: SANDBOX_ENABLED=true             │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ 📊 DB Query               v0.2.0     ✅ ON   │ │
│  │ 查询 PostgreSQL 数据库                  │ │
│  │ 🔒 Owner Only  │  🔒 Isolated (Worker)       │ │
│  └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

Skill 详情面板（点击展开或跳转）：

```
┌─────────────────────────────────────────────────┐
│  ← Tavily Search v1.0.0              [Uninstall] │
├─────────────────────────────────────────────────┤
│  Description: 使用 Tavily API 搜索互联网          │
│  Author: yanclaw  │  Tags: search, web           │
│                                                   │
│  ── Tools ──                                      │
│  • tavily-search.search — 搜索网页               │
│  • tavily-search.news — 搜索新闻                 │
│                                                   │
│  ── Configuration ──                              │
│  Max Results:    [5      ]                        │
│  Search Depth:   [basic ▼]                        │
│                                                   │
│  ── Agent Assignment ──                           │
│  ☑ All agents                                    │
│  ☐ Specific: [Select agents...]                  │
│                                                   │
│  ── Capabilities ──                               │
│  🔓 net:http (网络访问)                           │
│                                                   │
│  ── Prompt Preview ──                             │
│  ┌─ sanitized ──────────────────────────────────┐│
│  │ [SKILL:tavily-search]                        ││
│  │ 当用户要求搜索互联网...                      ││
│  │ [/SKILL:tavily-search]                       ││
│  └──────────────────────────────────────────────┘│
│                                                   │
│  ── Security ──                                   │
│  Isolated: No  │  Owner Only: No                  │
│  Dependencies: TAVILY_API_KEY ✅                  │
└─────────────────────────────────────────────────┘
```

安装对话框：

```
┌─────────────────────────────────────────────────┐
│  Install Skill                                    │
├─────────────────────────────────────────────────┤
│  Source: ○ Local Path  ○ Git URL  ○ npm Package   │
│                                                   │
│  URL: [https://github.com/user/skill-xxx.git  ]  │
│  Ref: [main                                   ]   │
│                                                   │
│  [Cancel]                            [Install]    │
└─────────────────────────────────────────────────┘
```

**路由注册**：修改 `packages/web/src/App.tsx`，新增 `/skills` 路由。

**侧边栏**：在现有导航中新增 Skills 入口（在 Plugins 旁或替代 Plugins）。

---

## 文件变更清单

### Phase 1（Plugin → Agent 桥梁）

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/tools/index.ts` | 修改 | `createToolset()` 新增 pluginRegistry 参数，合并 plugin tools |
| `packages/server/src/agents/runtime.ts` | 修改 | 构造函数接收 pluginRegistry；tool-call/tool-result 处调用 hooks |
| `packages/server/src/gateway.ts` | 修改 | 传 pluginRegistry 给 AgentRuntime |
| `packages/server/src/channels/manager.ts` | 修改 | 消息入口调用 `runMessageInbound` |
| `packages/server/src/plugins/registry.ts` | 修改 | 新增 `getToolCapabilities()` 方法 |

### Phase 2（Skill 格式 + 安装）

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/plugins/skill-loader.ts` | 新建 | Skill manifest 解析、依赖检查、prompt sanitize |
| `packages/server/src/plugins/skill-installer.ts` | 新建 | 安装/卸载（local, git, npm）|
| `packages/server/src/plugins/loader.ts` | 修改 | 集成 SkillLoader，优先识别 skill.json |
| `packages/server/src/security/sanitize.ts` | 修改 | 新增 `sanitizeSkillPrompt()` |
| `packages/server/src/agents/system-prompt-builder.ts` | 修改 | 注入 Skill prompts |
| `packages/server/src/config/schema.ts` | 修改 | plugins.skills 配置项 |

### Phase 3（API + UI）

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/routes/skills.ts` | 新建 | Skills REST API |
| `packages/server/src/app.ts` | 修改 | 注册 skills 路由 |
| `packages/web/src/pages/Skills.tsx` | 新建 | Skills 管理页面 |
| `packages/web/src/pages/SkillDetail.tsx` | 新建 | Skill 详情/配置页面 |
| `packages/web/src/App.tsx` | 修改 | 新增路由 |
| `packages/web/src/components/Sidebar.tsx`（或等效） | 修改 | 新增导航项 |

---

## 安全对照

| 威胁 | OpenClaw | YanClaw Skill 方案 |
|------|----------|-------------------|
| Prompt injection | SKILL.md 直接注入，无检测 | `sanitizeSkillPrompt()` + `detectInjection()` + 边界标记 + 长度限制 |
| 恶意代码 | 无沙箱，全权限 | Worker 隔离 + capability 声明 + tool policy 过滤 |
| 凭证泄露 | 明文 .env，Skill 可读取 | Vault 加密存储 + LeakDetector 扫描输出 |
| 命名空间污染 | 扁平命名，优先级覆盖 | `pluginId.toolName` 严格命名空间 |
| 供应链攻击 | 1 周 GitHub 账号即可发布 | 本地安装为主，未来市场需签名验证 |
| 权限提升 | Skill 可调用任意工具 | 3 层 policy + capability + ownerOnly |

---

## 示例 Skill：Tavily Search

```
~/.yanclaw/skills/tavily-search/
  ├── skill.json
  ├── prompt.md
  ├── index.ts
  └── package.json
```

**skill.json**:
```json
{
  "id": "tavily-search",
  "name": "Tavily Web Search",
  "version": "1.0.0",
  "description": "使用 Tavily API 搜索互联网获取实时信息",
  "author": "yanclaw",
  "tags": ["search", "web"],
  "icon": "🔍",
  "requires": {
    "env": ["TAVILY_API_KEY"]
  },
  "capabilities": ["net:http"],
  "config": {
    "maxResults": { "type": "number", "default": 5, "description": "最大结果数" }
  },
  "prompt": "prompt.md",
  "tools": ["search"]
}
```

**index.ts**:
```typescript
import { z } from "zod";
import { definePlugin } from "@yanclaw/server/plugins/types";

export default definePlugin({
  id: "tavily-search",
  name: "Tavily Web Search",
  version: "1.0.0",
  tools: [
    {
      name: "search",
      description: "Search the internet using Tavily API",
      parameters: z.object({
        query: z.string().describe("Search query"),
        maxResults: z.number().optional().default(5),
      }),
      execute: async (input) => {
        const { query, maxResults } = input as { query: string; maxResults: number };
        const apiKey = process.env.TAVILY_API_KEY;
        if (!apiKey) throw new Error("TAVILY_API_KEY not set");

        const resp = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            query,
            max_results: maxResults,
            search_depth: "basic",
          }),
        });

        if (!resp.ok) throw new Error(`Tavily API error: ${resp.status}`);
        const data = await resp.json();

        return data.results.map((r: { title: string; url: string; content: string }) => ({
          title: r.title,
          url: r.url,
          snippet: r.content,
        }));
      },
    },
  ],
});
```

---

## 开发优先级

| 阶段 | 工作量 | 价值 |
|------|--------|------|
| Phase 1: Plugin → Agent 桥梁 | 1-2 天 | 🔴 **关键** — 不做这个，plugin 系统等于摆设 |
| Phase 2: Skill 格式 + 安装 | 2-3 天 | 🟠 重要 — 降低 Skill 开发门槛 |
| Phase 3: API + UI | 2-3 天 | 🟡 增强 — 用户友好的管理体验 |

建议 Phase 1 立即开始，Phase 2/3 可合并或分批交付。

---

## 开放问题

1. **热重载**：Skill 安装/卸载后是否需要重启 gateway？建议 Phase 1 不支持热重载，Phase 2+ 加入。
2. **Skill Hub**：是否做类似 ClawHub 的公共仓库？建议远期再考虑，先做好本地安装 + Git 安装。
3. **Skill 间依赖**：Skill A 依赖 Skill B 的场景？建议暂不支持，保持简单。
4. **版本管理**：同一 Skill 多版本共存？建议暂不支持，安装即覆盖。
5. **MCP 与 Skill 的关系**：MCP Server 已有类似的 tool 注入能力，是否将 MCP 也纳入 Skill UI 管理？
