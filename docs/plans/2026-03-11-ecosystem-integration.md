# 生态集成 — 开发计划

对应需求文档：`docs/todos/2026-03-11-openclaw-insights.md`

---

## 概览

基于 OpenClaw 对比分析和市场调研，为 YanClaw 引入三大生态能力：MCP 协议支持、动态模型切换、飞书渠道适配。同时补齐安全短板和 Skills 生态兼容。

**交付物**：
1. MCP Server 管理与工具桥接（stdio + HTTP 双模式）
2. Tool policy 通配符支持（`mcp.*`、`plugin-id.*`）
3. 聊天界面动态模型切换（会话级，含 ModelManager 健康状态）
4. Channel 注册表重构（自注册模式，开放式扩展）
5. Channel 管理 UI（添加/移除/编辑渠道）
6. 飞书 Channel 适配器
7. MCP Registry 浏览/安装 UI
8. 安全加固补充（4 项小改动）

分三个 Phase 交付：
- **Phase 1**：MCP 核心（Step 1-3）— 打通协议，能用
- **Phase 2**：模型切换 + 飞书（Step 4-6）— 日常体验提升
- **Phase 3**：Registry UI + 安全加固（Step 7-9）— 生态闭环

---

## Phase 1：MCP 核心

### Step 1: Config Schema 扩展

**修改文件:** `packages/server/src/config/schema.ts`

在顶层 config schema 中新增 `mcp` 段（与现有 `agents[].claudeCode.mcpServers` 区分——那个是 Claude Code runtime 透传，这个是 YanClaw 原生管理）：

```typescript
const mcpServerSchema = z.object({
	// stdio 模式
	command: z.string().optional(),
	args: z.array(z.string()).default([]),
	env: z.record(z.string()).default({}),
	// HTTP 模式（Streamable HTTP / SSE）
	url: z.string().url().optional(),
	headers: z.record(z.string()).default({}),
	// 通用
	enabled: z.boolean().default(true),
	timeout: z.number().default(30000),
}).refine(
	(d) => d.command || d.url,
	{ message: "Must specify either command (stdio) or url (HTTP)" }
);

const mcpSchema = z.object({
	servers: z.record(mcpServerSchema).default({}),
});
```

Config 示例：
```json5
mcp: {
  servers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/docs"],
    },
    github: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github"],
      env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
    },
    "remote-db": {
      url: "https://mcp.example.com/db",
      headers: { Authorization: "Bearer ${MCP_TOKEN}" },
    },
  },
}
```

**验证**：`bun run check` 通过，现有 config 无 `mcp` 字段时 default 为空。

---

### Step 2: MCP Client 管理器

**新建文件:** `packages/server/src/mcp/client.ts`

核心类 `McpClientManager`，管理所有 MCP Server 连接的生命周期：

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

interface McpConnection {
	name: string;
	client: Client;
	transport: StdioClientTransport | StreamableHTTPClientTransport;
	status: "connecting" | "connected" | "error" | "closed";
}

class McpClientManager {
	private connections = new Map<string, McpConnection>();

	/** 根据 config 初始化所有 MCP Server 连接 */
	async startAll(servers: Record<string, McpServerConfig>): Promise<void>;

	/** 启动单个 MCP Server */
	async start(name: string, config: McpServerConfig): Promise<void>;

	/** 停止单个 */
	async stop(name: string): Promise<void>;

	/** 停止所有 */
	async stopAll(): Promise<void>;

	/** 获取某个 server 暴露的所有 tools */
	async listTools(name: string): Promise<McpToolInfo[]>;

	/** 调用某个 server 的 tool */
	async callTool(name: string, toolName: string, args: unknown): Promise<unknown>;

	/** 获取所有连接状态 */
	getStatus(): Record<string, { status: string; toolCount: number }>;
}
```

关键实现细节：
- stdio 模式：`StdioClientTransport` 启动子进程，env 变量先经过 `expandEnvVars()` 展开
- HTTP 模式：`StreamableHTTPClientTransport` 连接远程，支持 SSE fallback
- 连接失败自动重试（指数退避，最多 3 次），之后标记为 error
- Server 进程异常退出时自动重连
- 热重载：config watcher 检测到 `mcp.servers` 变更时，diff 新旧配置，只重启变更的 server

**依赖安装**：
```bash
cd packages/server && bun add @modelcontextprotocol/sdk
```

---

### Step 3: MCP → Tool 桥接

**新建文件:** `packages/server/src/mcp/bridge.ts`
**修改文件:** `packages/server/src/agents/tools/index.ts`（注册 `group:mcp` 动态组）
**修改文件:** `packages/server/src/agents/runtime.ts`（合并 MCP tools 到 agent toolset）

将 MCP Server 暴露的 tools 转换为 Vercel AI SDK 格式。

#### 3a. `createToolset` 改为 async + MCP 直接集成

不绕弯子做缓存层。`createToolset()` 的调用方只有 `runtime.ts:244` 一处，直接改 async，在内部完成 MCP tool 获取和合并：

**修改文件:** `packages/server/src/agents/tools/index.ts`

```typescript
// 函数签名改为 async
export async function createToolset(opts: {
	// ... 现有参数
	mcpClientManager?: McpClientManager;  // 新增
}) {
	// ... 现有 built-in tools 创建逻辑不变

	// MCP tools — 直接 await listTools()，无需缓存层
	if (opts.mcpClientManager) {
		for (const serverName of opts.mcpClientManager.getConnectedServers()) {
			const mcpTools = await opts.mcpClientManager.listTools(serverName);
			for (const t of mcpTools) {
				const name = `mcp.${serverName}.${t.name}`;
				allTools[name] = tool({
					description: t.description ?? "",
					parameters: jsonSchema(t.inputSchema),
					execute: async (input) => {
						return opts.mcpClientManager!.callTool(serverName, t.name, input);
					},
				});
			}
		}
	}

	// ... 现有 policy 过滤逻辑不变（已自然覆盖 MCP tools）
}
```

**修改文件:** `packages/server/src/agents/runtime.ts`

```typescript
// runtime.ts:244 — 加 await
const tools = await createToolset({
	// ... 现有参数
	mcpClientManager: this.mcpClientManager,
});
```

好处：
- 不需要 `mcp/bridge.ts` 文件 — bridge 逻辑就 10 行，直接内联
- 不需要缓存层和缓存一致性策略
- MCP tools 自动走现有的 policy 过滤、ownerOnly 检查、capability 检查
- Plugin tools 未来也可以同样方式合并进 `createToolset`

#### 3b. Tool Policy 支持通配符

现有 `isToolAllowed()` 只做精确匹配，用户无法写 `mcp.github.*` 或 `mcp.*`。这对 MCP 场景是必须的 —— 用户不可能提前知道每个 MCP server 暴露了哪些 tool name。

**修改文件:** `packages/server/src/agents/tools/index.ts`

在 `expandGroups()` 之后增加通配符匹配能力：

```typescript
/** 检查 toolName 是否匹配 patterns 列表（支持 group: 前缀和 * 通配符） */
function matchesPatterns(toolName: string, patterns: string[]): boolean {
	const expanded = expandGroups(patterns);
	return expanded.some((pattern) => {
		if (pattern.includes("*")) {
			// "mcp.*" → 匹配所有 mcp. 开头
			// "mcp.github.*" → 匹配 mcp.github. 开头
			const regex = new RegExp(
				`^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`
			);
			return regex.test(toolName);
		}
		return pattern === toolName;
	});
}
```

然后将 `isToolAllowed()` 中所有 `denied.includes(toolName)` 和 `allowed.includes(toolName)` 替换为 `matchesPatterns(toolName, list)`。

配置体验：
```json5
agents: [{
  tools: {
    allow: ["mcp.*"],                      // 允许所有 MCP tools
    deny: ["mcp.filesystem.write_file"],   // 但禁用这一个
  }
}, {
  tools: {
    allow: ["mcp.github.*", "group:web"],  // 只允许 github MCP tools + 内置 web 工具
  }
}]
```

这不只惠及 MCP —— plugin tools 也能用：`deny: ["my-plugin.*"]`。

同时保留 `group:` 前缀的语法（向后兼容），`group:mcp` 作为动态组仍然注册（给不想写通配符的用户用）。

**命名空间**：`mcp.{serverName}.{toolName}`，与插件工具 `{pluginId}.{toolName}` 风格一致。

---

### Gateway 集成

**修改文件:** `packages/server/src/gateway.ts`

在 `GatewayContext` 中添加 `mcpClientManager`：

```typescript
// initGateway() 中
const mcpClientManager = new McpClientManager();
await mcpClientManager.startAll(config.data.mcp?.servers ?? {});

// 注入 context
ctx.mcpClientManager = mcpClientManager;

// 关闭时
// stopGateway() 中
await ctx.mcpClientManager.stopAll();
```

启动顺序调整：`initGateway → startMcp → startPlugins → startChannels → ...`

MCP 在 Plugins 之前启动，因为 Plugin hooks 可能需要 MCP 工具。

---

## Phase 2：模型切换 + 飞书

### Step 4: Session 级 Model Override（Server）

**修改文件:**
- `packages/server/src/db/schema.ts` — sessions 表加 `modelOverride TEXT`
- `packages/server/src/db/sessions.ts` — CRUD 支持 modelOverride
- `packages/server/src/routes/sessions.ts` — PATCH endpoint 接受 model 参数
- `packages/server/src/agents/runtime.ts` — `streamText()` 调用前检查 session.modelOverride

Session 表变更：
```typescript
// schema.ts
export const sessions = sqliteTable("sessions", {
	// ... 现有字段
	modelOverride: text("model_override"), // 新增：如 "anthropic:claude-sonnet-4-20250514"
});
```

Runtime 逻辑：
```typescript
// runtime.ts - buildStreamOptions() 中
const modelId = session.modelOverride ?? agent.model ?? config.systemModels.default;
const model = modelManager.resolve(modelId);
```

API：
```
PATCH /api/sessions/:id  { modelOverride: "anthropic:claude-sonnet-4-20250514" }
PATCH /api/sessions/:id  { modelOverride: null }  // 恢复默认
```

---

### Step 5: ModelSelector 前端组件

**新建文件:** `packages/web/src/components/ModelSelector.tsx`
**修改文件:** `packages/web/src/pages/Chat.tsx`（或 PromptInput 组件）

组件设计：
```
┌─────────────────────────────────────┐
│ [Claude Sonnet 4 ▾]  [发送]        │
│                                     │
│  ┌─ Anthropic ─────────────────┐    │
│  │ ● Claude Sonnet 4    默认   │    │
│  │ ○ Claude Opus 4             │    │
│  │ ○ Claude Haiku 4            │    │
│  ├─ OpenAI ────────────────────┤    │
│  │ ○ GPT-4o                    │    │
│  │ ○ o3-mini          冷却中   │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
```

#### 新增 API：`GET /api/models/available`

> **注意**：现有 `POST /api/models/list` 需要前端传入 apiKey，是给 onboarding 探测用的。模型选择器需要一个新接口，读取已配置 provider 的 key 自动拉取模型列表。

**修改文件:** `packages/server/src/routes/models.ts`

```typescript
// 服务端缓存：避免每次请求都打 provider API
let modelsCache: { data: ProviderModels[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

// GET /api/models/available — 列出当前已配置 provider 的所有可用模型 + 健康状态
app.get("/available", async (c) => {
	const gw = getGateway();
	const config = gw.config.data;
	const modelManager = gw.modelManager;

	// 服务端缓存，避免重复调用 provider API
	if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL) {
		return c.json({ providers: modelsCache.data, cached: true });
	}

	const results: ProviderModels[] = [];
	for (const [name, provider] of Object.entries(config.models.providers)) {
		const apiKey = provider.profiles[0]?.apiKey;
		if (!apiKey) continue;
		try {
			const models = await fetchByType(provider.type, apiKey, provider.baseUrl);
			// 附加 ModelManager 的健康状态（可用/冷却中/失败）
			const modelsWithStatus = models.map((m) => ({
				...m,
				status: modelManager.getModelStatus(name, m.id), // "available" | "cooldown" | "failed"
			}));
			results.push({ provider: name, type: provider.type, models: modelsWithStatus });
		} catch {
			results.push({ provider: name, type: provider.type, models: [], error: "unreachable" });
		}
	}

	modelsCache = { data: results, fetchedAt: Date.now() };
	return c.json({ providers: results });
});
```

#### ModelManager 状态集成

**修改文件:** `packages/server/src/agents/model-manager.ts`

新增 `getModelStatus()` 方法，暴露每个 model 的健康状态给 API 层：

```typescript
getModelStatus(providerName: string, modelId: string): "available" | "cooldown" | "failed" {
	const profile = this.getProfile(providerName);
	if (!profile) return "failed";
	if (profile.cooldownUntil && Date.now() < profile.cooldownUntil) return "cooldown";
	return "available";
}
```

#### 前端实现要点

- 数据源：`GET /api/models/available`（含 status 字段）+ session 的 `modelOverride`
- 显示：模型名 + provider 分组 + **实时状态标签**
  - 可用：正常显示
  - 冷却中：灰色 + "冷却中" 标签，仍可选（选中后等冷却结束自动恢复）
  - 失败：红色 + "不可用"，禁止选择
- 操作：选中后调用 `PATCH /api/sessions/:id` 设置 modelOverride
- 位置：PromptInput 左侧，紧凑下拉（Popover），不占额外空间
- **流式输出时**：选择器禁用（防止中途切换模型导致状态混乱）
- **新建 session**：默认使用 agent 的 model 配置，用户可在发送第一条消息前切换

---

### Step 6: Channel 注册表重构 + 飞书适配器

#### 6a. 问题分析

当前 channel 系统存在三处硬编码，每新增一个 channel 类型都要改多个文件：

1. **Config schema**（`config/schema.ts:106-112`）— `channelsSchema` 是固定 key 对象 `{ telegram?, discord?, slack? }`
2. **启动逻辑**（`gateway.ts:132-176`）— `startChannels()` 中 if/else 链逐个判断
3. **Capabilities**（`channels/dock.ts`）— `CHANNEL_DOCK` 硬编码每个 channel 的能力声明

而 Plugin 系统已经有 `PluginChannelFactory` 接口，内置 channel 却没复用这套模式。

#### 6b. Channel 注册表

**新建文件:** `packages/server/src/channels/registry.ts`

将内置 channel 和 plugin channel 统一到注册表模式：

```typescript
import type { ChannelAdapter, ChannelCapabilities } from "./types";

/** 创建 adapter 所需的 account 配置 */
interface ChannelAccountConfig {
	id: string;
	token?: string;
	botToken?: string;
	appToken?: string;
	appId?: string;
	appSecret?: string;
	[key: string]: unknown; // 扩展字段
}

/** Channel 类型注册条目 */
interface ChannelRegistration {
	type: string;
	capabilities: ChannelCapabilities;
	/** 从 account 配置创建 adapter 实例；返回 null 表示配置不完整，跳过 */
	create: (account: ChannelAccountConfig) => ChannelAdapter | null;
	/** 该类型的必填字段，用于配置校验提示 */
	requiredFields?: string[];
}

class ChannelRegistry {
	private registrations = new Map<string, ChannelRegistration>();

	/** 注册一个 channel 类型 */
	register(reg: ChannelRegistration): void {
		this.registrations.set(reg.type, reg);
	}

	/** 获取所有已注册的类型 */
	getTypes(): string[] {
		return [...this.registrations.keys()];
	}

	/** 获取某类型的 capabilities（替代 CHANNEL_DOCK） */
	getCapabilities(type: string): ChannelCapabilities | undefined {
		return this.registrations.get(type)?.capabilities;
	}

	/** 创建 adapter 实例 */
	create(type: string, account: ChannelAccountConfig): ChannelAdapter | null {
		const reg = this.registrations.get(type);
		if (!reg) {
			console.warn(`[channel] Unknown channel type: ${type}`);
			return null;
		}
		return reg.create(account);
	}
}

export const channelRegistry = new ChannelRegistry();
```

#### 6c. 内置 Channel 自注册

**修改文件:** `packages/server/src/channels/telegram.ts`（末尾添加）
**修改文件:** `packages/server/src/channels/slack.ts`（末尾添加）
**修改文件:** `packages/server/src/channels/discord.ts`（末尾添加）

每个 adapter 文件末尾自注册：

```typescript
// telegram.ts 末尾
import { channelRegistry } from "./registry";

channelRegistry.register({
	type: "telegram",
	capabilities: {
		chatTypes: ["direct", "group", "channel"],
		supportsMedia: true,
		supportsThread: true,
		supportsMarkdown: true,
		supportsEdit: true,
		supportsReaction: true,
		blockStreaming: false,
		maxTextLength: 4000,
	},
	requiredFields: ["token"],
	create: (account) => {
		if (!account.token) return null;
		return new TelegramAdapter({ accountId: account.id, token: account.token });
	},
});
```

Slack、Discord 同理。`CHANNEL_DOCK` 文件保留但改为从 registry 读取（向后兼容）：

```typescript
// dock.ts — 改为动态代理
export function getChannelCapabilities(type: string): ChannelCapabilities {
	return channelRegistry.getCapabilities(type) ?? FALLBACK_CAPABILITIES;
}
```

#### 6d. Config Schema 改为数组

**修改文件:** `packages/server/src/config/schema.ts`

```typescript
// 旧：固定 key 对象
const channelsSchema = z.object({
	telegram: channelConfigSchema.optional(),
	discord: channelConfigSchema.optional(),
	slack: channelConfigSchema.optional(),
}).default({});

// 新：数组，每项声明 type
const channelAccountSchema = z.object({
	id: z.string(),
	// 通用字段
	token: z.string().optional(),
	botToken: z.string().optional(),
	appToken: z.string().optional(),
	// 飞书/其他扩展字段
	appId: z.string().optional(),
	appSecret: z.string().optional(),
	// DM & 权限
	allowFrom: z.array(z.string()).default([]),
	dmPolicy: z.enum(["open", "allowlist", "pairing"]).default("allowlist"),
	ownerIds: z.array(z.string()).default([]),
});

const channelEntrySchema = z.object({
	type: z.string(),  // 不再 enum — registry 决定支持哪些类型
	enabled: z.boolean().default(true),
	accounts: z.array(channelAccountSchema).default([]),
});

const channelsSchema = z.array(channelEntrySchema).default([]);
```

**向后兼容迁移**：config loader 中检测旧格式（object with telegram/discord/slack keys）并自动转换为数组格式，打印迁移提示。

```typescript
// config/store.ts — 加载后自动迁移
function migrateChannelsConfig(raw: unknown): unknown {
	if (raw && typeof raw === "object" && !Array.isArray(raw)) {
		// 旧格式：{ telegram: {...}, slack: {...} }
		const entries = [];
		for (const [type, config] of Object.entries(raw)) {
			if (config && typeof config === "object") {
				entries.push({ type, ...config });
			}
		}
		if (entries.length > 0) {
			console.log("[config] Migrated channels from object to array format");
			return entries;
		}
	}
	return raw; // 已经是数组或空
}
```

配置示例（新格式）：
```json5
channels: [
  {
    type: "telegram",
    enabled: true,
    accounts: [{
      id: "bot-prod",
      token: "${TELEGRAM_TOKEN}",
    }],
  },
  {
    type: "feishu",
    enabled: true,
    accounts: [{
      id: "feishu-main",
      appId: "${FEISHU_APP_ID}",
      appSecret: "${FEISHU_APP_SECRET}",
      dmPolicy: "open",
    }],
  },
]
```

#### 6e. `startChannels()` 统一循环

**修改文件:** `packages/server/src/gateway.ts`

```typescript
// 旧：if/else 分支链
// 新：统一循环
export async function startChannels(gw: GatewayContext): Promise<void> {
	const cfg = gw.config.get();

	for (const channel of cfg.channels) {
		if (!channel.enabled) continue;

		for (const account of channel.accounts) {
			const adapter = channelRegistry.create(channel.type, account);
			if (!adapter) {
				console.warn(
					`[channel] Skipping ${channel.type}:${account.id} (missing required config)`
				);
				continue;
			}
			gw.channelManager.register(`${channel.type}:${account.id}`, adapter);
		}
	}

	// Plugin channels 也走同一路径（已在 pluginRegistry 中注册到 channelRegistry）

	await gw.channelManager.connectAll();
	gw.channelManager.startHealthMonitor();
}
```

从 ~40 行硬编码变成 ~15 行通用逻辑。**新增 channel 只需添加一个 adapter 文件 + 末尾自注册，不改任何其他文件**。

#### 6f. 飞书适配器

有了注册表，飞书就是一个普通的 adapter 文件：

**新建文件:** `packages/server/src/channels/feishu.ts`

```typescript
import * as lark from "@larksuiteoapi/node-sdk";
import { channelRegistry } from "./registry";
import type { ChannelAdapter, InboundHandler, Peer, OutboundMessage } from "./types";

class FeishuAdapter implements ChannelAdapter {
	readonly type = "feishu";
	readonly id: string;
	readonly capabilities = channelRegistry.getCapabilities("feishu")!;
	status: "connected" | "disconnected" | "connecting" | "error" = "disconnected";

	private larkClient: lark.Client;
	private wsClient?: lark.WSClient;
	private handlers: InboundHandler[] = [];

	constructor(config: { accountId: string; appId: string; appSecret: string }) {
		this.id = config.accountId;
		this.larkClient = new lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
			appType: lark.AppType.SelfBuild,
		});
	}

	async connect(): Promise<void> {
		this.status = "connecting";
		// WebSocket 长连接模式（无需公网 URL，类似 Slack Socket Mode）
		this.wsClient = new lark.WSClient({ /* ... */ });
		// 注册消息事件处理
		// wsClient.on("im.message.receive_v1", (event) => { ... })
		await this.wsClient.start();
		this.status = "connected";
	}

	async disconnect(): Promise<void> { /* ... */ }

	async send(peer: Peer, content: OutboundMessage): Promise<string | null> {
		// Markdown → 飞书 rich_text / interactive card
	}

	onMessage(handler: InboundHandler): () => void {
		this.handlers.push(handler);
		return () => { this.handlers = this.handlers.filter((h) => h !== handler); };
	}
}

// 自注册
channelRegistry.register({
	type: "feishu",
	capabilities: {
		chatTypes: ["direct", "group"],
		supportsMedia: true,
		supportsThread: false,  // 飞书消息回复不是严格 thread
		supportsMarkdown: true,
		supportsEdit: true,
		supportsReaction: true,
		blockStreaming: false,
		maxTextLength: 4000,
	},
	requiredFields: ["appId", "appSecret"],
	create: (account) => {
		if (!account.appId || !account.appSecret) return null;
		return new FeishuAdapter({
			accountId: account.id,
			appId: account.appId,
			appSecret: account.appSecret,
		});
	},
});
```

**依赖安装**：
```bash
cd packages/server && bun add @larksuiteoapi/node-sdk
```

**支持的消息类型**：
- 入站：文本、图片、文件、@机器人 mention
- 出站：文本、Markdown（转 rich_text / interactive card）、图片附件
- 群聊：通过 @mention 触发，回复到群内
- 私聊：直接响应

#### 6g. Routing 兼容性

`routing.bindings[].channel` 使用的是 channel type 字符串（如 `"telegram"`），channel schema 从 object 改 array 后**不受影响**——routing 匹配的是 adapter 的 `type` 属性，与 config 结构无关。

同理，`dm-policy.ts` 中的 `checkDmPolicy()` 也是通过 `msg.channel`（type 字符串）查找 account 配置。改为数组后，查找逻辑从 `config.channels[type]?.accounts` 改为 `config.channels.find(c => c.type === type)?.accounts`，等价替换。

#### 6h. Channel 管理 UI

MCP 有管理页面（Step 8），channel 也应该有对应的 UI —— 用户不应该需要手动编辑 config.json5 才能添加渠道。

**修改文件:** `packages/web/src/pages/Channels.tsx`（已有页面，增强功能）

```
┌─ 已连接渠道 ────────────────────────────────────────┐
│ ┌──────────┬──────────┬──────────┬────────────────┐  │
│ │ 渠道     │ 账号     │ 状态     │ 操作           │  │
│ ├──────────┼──────────┼──────────┼────────────────┤  │
│ │ Telegram │ bot-prod │ 🟢 已连接 │ [断开][编辑]   │  │
│ │ 飞书     │ main     │ 🟢 已连接 │ [断开][编辑]   │  │
│ │ Discord  │ dev      │ 🔴 错误   │ [重连][编辑]   │  │
│ └──────────┴──────────┴──────────┴────────────────┘  │
│                                                       │
│ [+ 添加渠道]                                          │
│  ┌─────────────────────────────────────────────┐      │
│  │ 选择类型：                                   │      │
│  │ [Telegram] [Slack] [Discord] [飞书] [...]   │      │
│  │                                             │      │
│  │ 账号 ID:  [feishu-prod        ]             │      │
│  │ App ID:   [cli_xxxxxxxxxxxx   ]             │      │
│  │ App Secret: [**************   ]             │      │
│  │                                             │      │
│  │ DM 策略:  [开放 ▾]                          │      │
│  │                        [取消] [添加并连接]   │      │
│  └─────────────────────────────────────────────┘      │
└───────────────────────────────────────────────────────┘
```

"添加渠道"表单根据 `channelRegistry.getTypes()` 返回的类型列表动态生成，根据每个类型的 `requiredFields` 展示必填字段。

API 支持：
```
GET  /api/channels/types        — 列出所有已注册的 channel 类型及其 requiredFields
POST /api/channels              — 添加新 channel（写入 config + 自动连接）
DELETE /api/channels/:type/:id  — 移除 channel（断开 + 从 config 删除）
```

#### 6i. Plugin Channel 统一

现有 `PluginChannelFactory` 接口可直接桥接到 `channelRegistry`：

```typescript
// plugins/registry.ts — registerPlugin() 中
if (def.channels) {
	for (const factory of def.channels) {
		channelRegistry.register({
			type: factory.type,
			capabilities: factory.capabilities ?? FALLBACK_CAPABILITIES,
			create: (account) => factory.create(account),
		});
	}
}
```

这样 plugin channel 和内置 channel 走完全一样的 `startChannels()` 逻辑。

#### 改动影响

| 文件 | 变更 | 风险 |
|------|------|------|
| `channels/registry.ts` | 新建 | 无 |
| `channels/feishu.ts` | 新建 | 无 |
| `config/schema.ts` | channels 从 object → array | 中 — 需向后兼容迁移 |
| `config/store.ts` | 加 migrateChannelsConfig | 低 |
| `gateway.ts` | startChannels 改循环 | 低 — 逻辑等价 |
| `channels/dock.ts` | 改为读 registry | 低 |
| `channels/{telegram,slack,discord}.ts` | 末尾加自注册 | 低 |
| `plugins/registry.ts` | channel factory 桥接 | 低 |
| `routes/channels.ts` | 适配新 config 结构 | 低 |
| `channels/manager.ts` | findAdapter 中 capabilities 来源改 registry | 低 |

---

## Phase 3：Registry UI + 安全加固

### Step 7: MCP Server API

**新建文件:** `packages/server/src/routes/mcp.ts`
**修改文件:** `packages/server/src/app.ts`（注册 `/api/mcp` 路由）

```typescript
// GET /api/mcp/servers — 列出已配置的 MCP Server 及状态
// POST /api/mcp/servers/:name/start — 启动
// POST /api/mcp/servers/:name/stop — 停止
// GET /api/mcp/servers/:name/tools — 列出该 server 暴露的 tools
// POST /api/mcp/registry/search — 代理查询外部 Registry
```

Registry 搜索代理（避免前端 CORS 问题）：
```typescript
app.post("/registry/search", zValidator("json", z.object({
	registry: z.enum(["official", "smithery"]).default("official"),
	query: z.string(),
	limit: z.number().default(20),
})), async (c) => {
	const { registry, query, limit } = c.req.valid("json");
	if (registry === "official") {
		// GET https://registry.modelcontextprotocol.io/v0.1/servers?query=...&limit=...
	} else if (registry === "smithery") {
		// 调用 Smithery API
	}
});
```

---

### Step 8: MCP 管理 UI

**新建文件:** `packages/web/src/pages/McpServers.tsx`
**修改文件:** `packages/web/src/App.tsx`（路由注册）

页面分两栏：

```
┌─ 已安装 ──────────────────────────────────────────┐
│ ┌──────────────┬──────────┬───────┬─────────────┐  │
│ │ Server       │ 状态     │ Tools │ 操作        │  │
│ ├──────────────┼──────────┼───────┼─────────────┤  │
│ │ filesystem   │ 🟢 连接中 │ 4     │ [停止][删除]│  │
│ │ github       │ 🟢 连接中 │ 12    │ [停止][删除]│  │
│ │ remote-db    │ 🔴 错误   │ -     │ [重启][删除]│  │
│ └──────────────┴──────────┴───────┴─────────────┘  │
│                                                     │
│ [+ 手动添加]                                        │
├─ Registry 浏览 ────────────────────────────────────┤
│ 🔍 [搜索 MCP Server...]  [Official ▾]              │
│                                                     │
│ ┌──────────────────────────────────────────────┐    │
│ │ @anthropic/mcp-github  ★ 2.3k                │    │
│ │ GitHub integration: PRs, Issues, Repos       │    │
│ │                                  [安装]      │    │
│ ├──────────────────────────────────────────────┤    │
│ │ @anthropic/mcp-filesystem  ★ 1.8k            │    │
│ │ Local file system access                     │    │
│ │                                  [安装]      │    │
│ └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

"安装"操作实际上是：
1. 弹出配置对话框（填写 env 变量等）
2. 生成 config 片段
3. 调用 `PATCH /api/config` 写入 `mcp.servers.{name}`
4. 调用 `POST /api/mcp/servers/{name}/start` 启动

---

### Step 9: 安全加固补充

四项小改动，随 Phase 3 一起交付：

**9a. Docker 环境变量清洗**

**修改文件:** `packages/server/src/agents/tools/shell.ts`

```typescript
// Docker sandbox 执行前，移除敏感环境变量
const sanitizedEnv = Object.fromEntries(
	Object.entries(process.env).filter(([k]) =>
		!k.startsWith("YANCLAW_") &&
		!["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GITHUB_TOKEN"].includes(k)
	)
);
```

**9b. 审批 fail-closed**

**修改文件:** `packages/server/src/agents/tools/index.ts`（shell 审批包装处）

> **注意**：`ApprovalManager` 本身没有"上下文绑定"概念——它是纯粹的 request/respond 模型。实际的 fail-closed 应在调用侧：当 `approvalManager` 未注入（undefined）时，敏感工具应被禁用而非默认放行。

当前代码（`tools/index.ts:222-223`）：
```typescript
if (approvalManager && tools.shell && toolsConfig.exec.ask !== "off") {
```
`approvalManager` 为 undefined 时直接跳过审批包装，shell 工具无审批直接可用。

修改为：当 ask 模式不是 "off" 但 `approvalManager` 缺失时，移除 shell 工具：
```typescript
if (toolsConfig.exec.ask !== "off") {
	if (approvalManager && tools.shell) {
		// ... 现有审批包装逻辑
	} else if (!approvalManager && tools.shell) {
		// fail-closed: 无审批管理器时禁用需审批的工具
		console.warn("[tools] Approval manager not available, disabling shell tool (fail-closed)");
		delete tools.shell;
	}
}
```

**9c. Token 轮换作用域约束**

**修改文件:** `packages/server/src/security/token-rotation.ts`

```typescript
// 轮换时校验：新 token 的 scope 必须 ⊆ caller 的 scope
if (!isSubset(newScope, callerScope)) {
	throw new Error("Token scope escalation denied");
}
```

**9d. 上下文裁剪保留图片引用**

**修改文件:** `packages/server/src/agents/runtime.ts`

```typescript
// pruneContext() 中，裁剪 tool result 时保留 image 类型的 content part
function pruneToolResult(result: ToolResultPart): ToolResultPart {
	if (Array.isArray(result.content)) {
		const images = result.content.filter((p) => p.type === "image");
		const text = result.content.filter((p) => p.type === "text");
		// 保留图片，只裁剪文本部分
		return { ...result, content: [...images, ...truncateText(text)] };
	}
	return result;
}
```

---

## 依赖清单

| 阶段 | 新依赖 | 用途 |
|------|--------|------|
| Phase 1 | `@modelcontextprotocol/sdk` | MCP Client SDK |
| Phase 2 | `@larksuiteoapi/node-sdk` | 飞书 API SDK |
| Phase 3 | 无 | — |

---

## 数据库迁移

仅 Step 4 需要一次 schema 变更：

```sql
ALTER TABLE sessions ADD COLUMN model_override TEXT;
```

放入 `packages/server/src/db/migrations/` 目录，启动时自动执行。

---

## 风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| MCP SDK 在 Bun 上的兼容性 | Phase 1 阻塞 | 提前在 Step 1 阶段做 spike 验证；备选方案：直接实现 JSON-RPC over stdio |
| MCP listTools 延迟 | Phase 1 | 每次 agent run 都 await listTools()，若 MCP server 响应慢会拖慢首次 tool 调用；可在 McpClientManager 中做可选缓存 + `notifications/tools/list_changed` 监听刷新 |
| Channel config 迁移 | Phase 2 | object → array 格式变更可能影响用户已有配置；自动迁移 + 日志提示降低风险 |
| 飞书 SDK Bun 兼容性 | Phase 2 | `@larksuiteoapi/node-sdk` 未明确支持 Bun；需 spike 验证 WebSocket 模式 |
| 飞书 WebSocket 模式稳定性 | Phase 2 | 复用 ChannelManager 的健康监控 + 自动重连机制 |
| MCP Server 子进程泄漏 | 运行时 | McpClientManager 维护 PID 列表，graceful shutdown 时逐一 kill；异常退出注册 `process.on("exit")` 清理 |
| Registry API 变更 | Phase 3 | 仅依赖 OpenAPI v0.1 规范（已冻结），Smithery 作为 fallback |

---

## 验收标准

### Phase 1
- [ ] config.json5 中配置 MCP Server 后，agent 可调用其 tools
- [ ] stdio 和 HTTP 两种模式均可连接
- [ ] Tool policy 通配符：`mcp.*`、`mcp.github.*` 语法生效
- [ ] MCP tools 受 tool policy 控制（deny 可禁用特定 MCP tool）
- [ ] 热重载：修改 mcp.servers 配置后，自动重连变更的 server
- [ ] 启动日志打印 MCP Server 连接状态

### Phase 2
- [ ] 模型选择器显示 provider 分组 + 实时健康状态（可用/冷却中/不可用）
- [ ] 选中模型后立即生效于当前 session，流式输出时选择器禁用
- [ ] `GET /api/models/available` 有服务端缓存，不重复调用 provider API
- [ ] Channel 注册表：新增 channel 只需一个 adapter 文件 + 自注册，不改 gateway/schema
- [ ] 旧 config 格式（object）自动迁移为新格式（array），现有配置无需手动改
- [ ] 现有 telegram/slack/discord 功能不受重构影响（回归测试通过）
- [ ] Plugin channel factory 自动桥接到 channelRegistry
- [ ] Routing bindings 在新 config 结构下正常工作
- [ ] Channel 管理 UI：可通过界面添加/移除/编辑渠道
- [ ] 飞书机器人可接收私聊/群聊消息并回复
- [ ] 飞书消息支持文本和图片附件

### Phase 3
- [ ] MCP 管理页面可查看所有 Server 状态和 tools 列表
- [ ] 可从 Registry 搜索并一键安装 MCP Server
- [ ] Docker sandbox 不泄漏宿主环境变量
- [ ] 无审批管理器时需审批的工具被禁用（fail-closed）
