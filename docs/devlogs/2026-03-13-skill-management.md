# 2026-03-13 Skill 管理系统

## 概述

实现完整的 Skill 管理系统，让 Plugin 系统从"摆设"变为可用。三个阶段：打通 Plugin→Agent Runtime 桥梁、定义 skill.json 格式与安装机制、提供 REST API 和管理 UI。

## 背景

YanClaw 已有 Plugin 系统框架（类型安全接口、Worker 隔离、命名空间、3 层 tool policy），但存在关键缺口：

1. Plugin tools 未接入 agent runtime — `createToolset()` 不包含 plugin tools
2. Lifecycle hooks 未实际调用 — `beforeToolCall`/`afterToolCall`/`onMessageInbound` 已定义但未接线
3. 无安装/管理 UI — 只有 `GET /api/plugins` 列表接口
4. 无 Skill 格式定义 — Plugin 需要写 TypeScript 代码，门槛较高

## Phase 1：Plugin → Agent Runtime 桥梁

### Plugin Tools 接入 createToolset()

在 `createToolset()` 中 MCP tools 之后加入 plugin tools 桥接。遍历 `PluginRegistry.getTools()`，使用 `tool()` 包装成 AI SDK 格式注入 `allTools`。

关键设计决策：
- Plugin tools 的 capability 需求从 `PluginDefinition.capabilities` 字段读取，通过新增的 `getToolCapabilities()` 方法获取动态 map
- `hasCapabilities()` 接受可选的 `extraCaps` 参数，同时查内置 `TOOL_CAPABILITIES` 和插件 caps，避免使用模块级可变状态（并发安全）
- Owner-only 检查同时走内置 `OWNER_ONLY_TOOLS` 和 `PluginRegistry.isOwnerOnlyTool()`

### Lifecycle Hooks 接线

三处接线：

1. **beforeToolCall**（`runtime.ts` tool-call 事件处）：在 loopDetector + checkDataFlow 之后调用 `pluginRegistry.runBeforeToolCall()`，返回 null 则 yield blocked 事件并 break
2. **afterToolCall**（`runtime.ts` tool-result 事件处）：在 wrapUntrustedContent + detectInjection 之后调用
3. **onMessageInbound**（`manager.ts` handleInbound 入口）：在 approval command 检查之后、DM policy 之前调用，返回 null 则 drop 消息

### 传递 PluginRegistry

- `PluginDefinition` 新增 `capabilities?: string[]` 和 `ownerOnly?: boolean` 字段
- `AgentRuntime` 构造函数新增 `pluginRegistry` 参数
- `gateway.ts` 中将 `PluginRegistry` 创建提前到 `AgentRuntime` 之前，同时注入 `ChannelManager`

## Phase 2：Skill 格式 + 安装

### SkillLoader — skill.json 加载器

新建 `skill-loader.ts`，核心流程：

1. 读取 `skill.json` → Zod 验证 manifest（id/name/version/description/capabilities/config/prompt 等）
2. 检查依赖（env 变量是否存在、CLI 工具是否可用）
3. 加载 `prompt.md` → 长度限制 2000 字符 → `detectInjection()` 扫描 → 移除危险模式 → 包裹 `[SKILL:id]...[/SKILL:id]` 边界标记
4. `import(main)` 获取 PluginDefinition → 合并 manifest 元数据
5. 返回 `SkillDefinition`（扩展 PluginDefinition，含 manifest + sanitizedPrompt + warnings）

### PluginLoader 集成

`loadAll()` 新增扫描 `~/.yanclaw/skills/` 目录。`loadPlugin()` 优先尝试 SkillLoader（检测 skill.json），无则回退到原有逻辑。

### System Prompt 集成

`buildSystemPrompt()` 新增 `skillPrompts` 参数，在 Bootstrap files 之后、Memory context 之前注入：

```
## Available Skills

[SKILL:tavily-search]
当用户要求搜索互联网...
[/SKILL:tavily-search]
```

`PluginRegistry.getSkillPrompts()` 遍历所有已加载插件，提取 `SkillDefinition.sanitizedPrompt`。

### SkillInstaller — 安装/卸载

新建 `skill-installer.ts`，支持三种安装来源：

- `installLocal(path)` — cp -r 到 `~/.yanclaw/skills/`
- `installGit(url, ref?)` — git clone --depth 1 → 移除 .git → 移动到 skills 目录 → bun install
- `installNpm(package, version?)` — bun init + bun add → 从 node_modules 提取 → 复制到 skills 目录

### Config Schema 扩展

`plugins` 配置新增 `skills` 字段：

```json5
plugins: {
  enabled: {},
  dirs: [],
  skills: {
    "tavily-search": {
      enabled: true,
      config: { maxResults: 10 },
      agents: []  // 空=所有 agent
    }
  }
}
```

## Phase 3：API + UI

### Skills REST API

新建 `routes/skills.ts`，6 个端点：

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/skills` | 列出所有已安装 Skill（含运行时状态） |
| GET | `/api/skills/:id` | 单个 Skill 详情（manifest + 状态 + prompt） |
| POST | `/api/skills/install` | 安装 Skill（local/git/npm） |
| DELETE | `/api/skills/:id` | 卸载 Skill |
| PATCH | `/api/skills/:id` | 更新配置（启用/禁用、config、agent 分配） |
| GET | `/api/skills/:id/prompt` | Prompt 预览（sanitized） |

### Skills 管理页面

新建 `pages/Skills.tsx`：

- 顶部搜索栏 + 安装按钮
- 安装对话框支持 local/git/npm 三种来源切换
- Skill 卡片列表：icon + 名称 + 版本 + 描述 + 状态 badge
- 展开后显示：Tools 列表、Capabilities、配置项、Prompt 预览、安全信息、启用/禁用/卸载操作
- 警告显示（缺少环境变量、注入检测等）

### 路由注册

- `app.ts` 新增 `.route("/skills", skillsRoute)`
- `App.tsx` 新增 `/skills` 路由 + 侧边栏导航项（Puzzle 图标）

## 安全设计

| 威胁 | 防护措施 |
|------|---------|
| Prompt injection | `detectInjection()` 扫描 + 移除危险模式 + `[SKILL:id]` 边界标记 + 2000 字符长度限制 |
| 恶意工具 | Worker 隔离 + capability 声明 + 3 层 tool policy 过滤 |
| 权限提升 | ownerOnly 标记 + capability-based filtering |
| 命名空间污染 | `pluginId.toolName` 严格命名空间 |

## 改动文件

### 新建文件

| 文件 | 说明 |
|------|------|
| `packages/server/src/plugins/skill-loader.ts` | Skill manifest 解析、依赖检查、prompt sanitize |
| `packages/server/src/plugins/skill-installer.ts` | 安装/卸载（local, git, npm） |
| `packages/server/src/routes/skills.ts` | Skills REST API |
| `packages/web/src/pages/Skills.tsx` | Skills 管理页面 |

### 修改文件

| 文件 | 说明 |
|------|------|
| `packages/server/src/plugins/types.ts` | PluginDefinition 新增 capabilities、ownerOnly |
| `packages/server/src/plugins/registry.ts` | 新增 getToolCapabilities()、isOwnerOnlyTool()、getSkillPrompts() |
| `packages/server/src/plugins/loader.ts` | 集成 SkillLoader，扫描 skills 目录 |
| `packages/server/src/plugins/index.ts` | 导出新类型和类 |
| `packages/server/src/agents/tools/index.ts` | createToolset() 接入 plugin tools |
| `packages/server/src/agents/runtime.ts` | 接入 pluginRegistry，接线 hooks，注入 skill prompts |
| `packages/server/src/agents/system-prompt-builder.ts` | 注入 skill prompts 段落 |
| `packages/server/src/channels/manager.ts` | 接线 onMessageInbound hook |
| `packages/server/src/gateway.ts` | 传递 pluginRegistry 给 AgentRuntime 和 ChannelManager |
| `packages/server/src/config/schema.ts` | plugins.skills 配置项 |
| `packages/server/src/app.ts` | 注册 /api/skills 路由 |
| `packages/web/src/App.tsx` | 新增 /skills 路由和侧边栏导航 |

## 验证

- Biome lint: 通过（仅 1 个预存 warning）
- Build: server + web 均成功
- Tests: 10 文件 122 测试全部通过
