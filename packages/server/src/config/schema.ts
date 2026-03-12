import { z } from "zod";

// --- Sub-schemas ---

const authProfileSchema = z.object({
	id: z.string(),
	apiKey: z.string(),
	baseUrl: z.string().optional(),
});

export const providerTypeValues = [
	"anthropic",
	"openai",
	"google",
	"ollama",
	"openai-compatible",
] as const;
export type ProviderType = (typeof providerTypeValues)[number];

const providerSchema = z.object({
	type: z.enum(providerTypeValues),
	profiles: z.array(authProfileSchema).default([]),
	baseUrl: z.string().optional(),
	models: z.record(z.string(), z.string()).optional(), // alias → actual model ID
});

const modelsSchema = z
	.object({
		providers: z.record(z.string(), providerSchema).default({}),
	})
	.default({});

// --- Preference & SystemModels ---

export const preferenceValues = ["default", "fast", "quality", "cheap"] as const;
export type Preference = (typeof preferenceValues)[number];

const sceneModelSchema = z.union([
	z.string(), // shorthand: equivalent to { default: "model-id" }
	z.object({
		default: z.string(),
		fast: z.string().optional(),
		quality: z.string().optional(),
		cheap: z.string().optional(),
	}),
]);

const systemModelsSchema = z.record(z.string(), sceneModelSchema).default({});

const agentSchema = z.object({
	id: z.string(),
	name: z.string(),
	model: z.string().default("claude-sonnet-4-20250514"),
	systemPrompt: z.string().default("You are a helpful assistant."),
	workspaceDir: z.string().optional(),
	preference: z.enum(preferenceValues).optional(),
	tools: z
		.object({
			allow: z.array(z.string()).optional(),
			deny: z.array(z.string()).optional(),
		})
		.optional(),
	capabilities: z
		.union([
			z.array(z.string()), // ["fs:read", "net:http"]
			z.string(), // "researcher" (preset name)
		])
		.optional(),
	bootstrap: z
		.object({
			/** Prompt assembly mode. "full" injects all layers, "minimal" for cron/heartbeat, "none" for raw. */
			mode: z.enum(["full", "minimal", "none"]).default("full"),
			/** Bootstrap file names to load from workspace/data dir. */
			files: z.array(z.string()).default(["SOUL.md", "TOOLS.md", "MEMORY.md", "CONTEXT.md"]),
			/** Max characters per bootstrap file. */
			maxFileChars: z.number().default(20_000),
		})
		.optional(),
	heartbeat: z
		.object({
			enabled: z.boolean().default(false),
			/** Interval between heartbeats (e.g. "5m", "1h"). */
			interval: z.string().default("30m"),
			/** Path to HEARTBEAT.md file with task prompt. */
			promptFile: z.string().optional(),
			/** Inline prompt (used when promptFile is not set). */
			prompt: z.string().optional(),
			/** Active hours constraint. */
			activeHours: z
				.object({
					start: z.number().min(0).max(23).default(9),
					end: z.number().min(0).max(23).default(22),
					timezone: z.string().default("Asia/Shanghai"),
				})
				.optional(),
			/** Where to deliver heartbeat output. "none" suppresses, "last" sends to last active channel. */
			target: z.enum(["none", "last"]).or(z.string()).default("none"),
			/** Suppress no-op responses like "HEARTBEAT_OK". */
			suppressOk: z.boolean().default(true),
		})
		.default({}),
	runtime: z.enum(["default", "claude-code"]).default("default"),
	claudeCode: z
		.object({
			allowedTools: z.array(z.string()).default(["Read", "Edit", "Write", "Bash", "Glob", "Grep"]),
			permissionMode: z
				.enum(["default", "acceptEdits", "bypassPermissions"])
				.default("acceptEdits"),
			maxTurns: z.number().default(50),
			mcpServers: z.record(z.unknown()).default({}),
			agents: z
				.record(
					z.object({
						description: z.string(),
						prompt: z.string().optional(),
						tools: z.array(z.string()).optional(),
					}),
				)
				.default({}),
		})
		.optional(),
});

const channelAccountSchema = z.object({
	id: z.string(),
	token: z.string().optional(),
	botToken: z.string().optional(),
	appToken: z.string().optional(),
	// Feishu / extensible fields
	appId: z.string().optional(),
	appSecret: z.string().optional(),
	// DM & permissions
	allowFrom: z.array(z.string()).default([]),
	dmPolicy: z.enum(["open", "allowlist", "pairing"]).default("allowlist"),
	ownerIds: z.array(z.string()).default([]),
});

const channelEntrySchema = z.object({
	type: z.string(),
	enabled: z.boolean().default(true),
	accounts: z.array(channelAccountSchema).default([]),
});

const channelsSchema = z.array(channelEntrySchema).default([]);

const bindingSchema = z.object({
	channel: z.string().optional(),
	account: z.string().optional(),
	peer: z.string().optional(),
	guild: z.string().optional(),
	roles: z.array(z.string()).optional(),
	team: z.string().optional(),
	group: z.string().optional(),
	agent: z.string(),
	dmScope: z.enum(["main", "per-peer", "per-channel-peer", "per-account-peer"]).optional(),
	priority: z.number().optional(),
	preference: z.enum(preferenceValues).optional(),
});

const routingSchema = z
	.object({
		default: z.string().default("main"),
		dmScope: z
			.enum(["main", "per-peer", "per-channel-peer", "per-account-peer"])
			.default("per-peer"),
		bindings: z.array(bindingSchema).default([]),
		identityLinks: z.record(z.array(z.string())).default({}),
	})
	.default({});

const toolsSchema = z
	.object({
		policy: z
			.object({
				default: z.enum(["allow", "deny"]).default("allow"),
				allow: z.array(z.string()).optional(),
				deny: z.array(z.string()).optional(),
			})
			.default({}),
		exec: z
			.object({
				ask: z.enum(["off", "on-miss", "always"]).default("on-miss"),
				safeBins: z
					.array(z.string())
					.default(["ls", "cat", "grep", "find", "echo", "date", "pwd", "wc"]),
				timeout: z.number().default(30_000),
				maxOutput: z.number().default(10_240),
				sandbox: z
					.object({
						enabled: z.boolean().default(false),
						image: z.string().default("ubuntu:22.04"),
						memoryLimit: z.string().default("256m"),
						cpuLimit: z.string().default("0.5"),
						network: z.string().default("none"),
						readOnlyWorkspace: z.boolean().default(false),
					})
					.default({}),
			})
			.default({}),
		codeExec: z
			.object({
				enabled: z.boolean().default(false),
				runtime: z.enum(["bun-secure", "docker", "bun-limited"]).default("bun-secure"),
				fallback: z.enum(["docker", "bun-limited", "off"]).default("bun-limited"),
				permissions: z
					.object({
						net: z.union([z.boolean(), z.array(z.string())]).default(false),
						read: z.union([z.boolean(), z.array(z.string())]).default(["./workspace"]),
						write: z.union([z.boolean(), z.array(z.string())]).default(false),
						env: z.union([z.boolean(), z.array(z.string())]).default(["NODE_ENV"]),
						run: z.boolean().default(false),
						sys: z.boolean().default(false),
						ffi: z.literal(false).default(false),
					})
					.default({}),
				timeoutMs: z.number().default(30_000),
				maxOutputChars: z.number().default(50_000),
			})
			.default({}),
		byChannel: z
			.record(
				z.object({
					allow: z.array(z.string()).optional(),
					deny: z.array(z.string()).optional(),
				}),
			)
			.default({}),
	})
	.default({});

export const DEFAULT_SYSTEM_PROMPT = "You are a helpful assistant.";

const defaultAgent = {
	id: "main",
	name: "默认助手",
	model: "claude-sonnet-4-20250514",
	systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

// --- MCP Schema ---

const mcpServerSchema = z
	.object({
		// stdio mode
		command: z.string().optional(),
		args: z.array(z.string()).default([]),
		env: z.record(z.string()).default({}),
		// HTTP mode (Streamable HTTP / SSE)
		url: z.string().url().optional(),
		headers: z.record(z.string()).default({}),
		// Common
		enabled: z.boolean().default(true),
		timeout: z.number().default(30000),
	})
	.refine((d) => d.command || d.url, {
		message: "Must specify either command (stdio) or url (HTTP)",
	});

const mcpSchema = z
	.object({
		servers: z.record(mcpServerSchema).default({}),
	})
	.default({});

// --- Main Config Schema ---

export const configSchema = z.object({
	gateway: z
		.object({
			port: z.number().default(18789),
			bind: z.enum(["loopback", "lan"]).default("loopback"),
			auth: z.object({ token: z.string().optional() }).default({}),
		})
		.default({}),

	agents: z.array(agentSchema).default([defaultAgent]),

	models: modelsSchema,

	systemModels: systemModelsSchema,

	mcp: mcpSchema,

	channels: channelsSchema,

	routing: routingSchema,

	tools: toolsSchema,

	cron: z
		.object({
			tasks: z
				.array(
					z.object({
						id: z.string(),
						agent: z.string().default("main"),
						mode: z.enum(["cron", "interval", "once"]).default("cron"),
						schedule: z.string(),
						prompt: z.string(),
						deliveryTargets: z
							.array(
								z.object({
									channel: z.string(),
									peer: z.string().optional(),
								}),
							)
							.default([]),
						enabled: z.boolean().default(true),
					}),
				)
				.default([]),
		})
		.default({}),

	session: z
		.object({
			contextBudget: z.number().default(100_000),
			pruneAfterDays: z.number().default(90),
			compaction: z
				.object({
					enabled: z.boolean().default(true),
					/** Model for summarization. null = use current agent's model. */
					model: z.string().nullable().default(null),
					/** Context window usage ratio to trigger compaction. */
					triggerRatio: z.number().min(0.5).max(0.99).default(0.85),
					/** Keep this many recent messages intact (not summarized). */
					keepRecentMessages: z.number().min(2).default(10),
					/** Preserve identifiers (UUIDs, hashes, etc.) in summaries. */
					identifierPolicy: z.enum(["strict", "off"]).default("strict"),
					/** Flush important facts to memory before compaction. */
					memoryFlush: z.boolean().default(true),
				})
				.default({}),
			autoReset: z
				.object({
					enabled: z.boolean().default(false),
					/** Reset sessions idle for this long (e.g. "8h", "1d"). */
					idleTimeout: z.string().default("8h"),
					/** Daily reset time in HH:MM format (null = disabled). */
					dailyResetTime: z.string().nullable().default(null),
					/** Timezone for daily reset. */
					timezone: z.string().default("Asia/Shanghai"),
				})
				.default({}),
		})
		.default({}),

	memory: z
		.object({
			enabled: z.boolean().default(false),
			embeddingModel: z.string().default("text-embedding-3-small"),
			autoIndex: z.boolean().default(true),
			indexDirs: z.array(z.string()).default([]),
		})
		.default({}),

	plugins: z
		.object({
			enabled: z.record(z.boolean()).default({}),
			dirs: z.array(z.string()).default([]),
			/** Skill-specific configuration. */
			skills: z
				.record(
					z.object({
						enabled: z.boolean().default(true),
						config: z.record(z.unknown()).default({}),
						agents: z.array(z.string()).default([]),
					}),
				)
				.default({}),
		})
		.default({}),

	security: z
		.object({
			vault: z.object({ enabled: z.boolean().default(true) }).default({}),
			rateLimit: z
				.object({
					chat: z
						.object({ windowMs: z.number().default(60_000), max: z.number().default(10) })
						.default({}),
					api: z
						.object({ windowMs: z.number().default(60_000), max: z.number().default(60) })
						.default({}),
					approval: z
						.object({ windowMs: z.number().default(60_000), max: z.number().default(30) })
						.default({}),
				})
				.default({}),
			tokenRotation: z
				.object({
					intervalHours: z.number().default(0),
					gracePeriodMinutes: z.number().default(5),
				})
				.default({}),
			audit: z
				.object({
					enabled: z.boolean().default(true),
					retentionDays: z.number().default(90),
				})
				.default({}),
			anomaly: z
				.object({
					enabled: z.boolean().default(true),
					thresholds: z
						.record(
							z.object({
								warn: z.number(),
								critical: z.number(),
							}),
						)
						.default({
							shell: { warn: 10, critical: 20 },
							file_write: { warn: 30, critical: 50 },
							"*": { warn: 80, critical: 100 },
						}),
					action: z.enum(["log", "pause", "abort"]).default("pause"),
				})
				.default({}),
			promptInjection: z
				.object({
					wrapToolResults: z.boolean().default(true),
					detectPatterns: z.boolean().default(true),
					blockOnDetection: z.boolean().default(false),
				})
				.default({}),
			network: z
				.object({
					allowedHosts: z.array(z.string()).default([]),
					blockPrivate: z.boolean().default(true),
					exemptPorts: z.array(z.number()).default([]),
				})
				.default({}),
			dataFlow: z
				.object({
					enabled: z.boolean().default(true),
					block: z.boolean().default(false),
				})
				.default({}),
		})
		.default({}),
});

export type Config = z.infer<typeof configSchema>;
export type AgentConfig = z.infer<typeof agentSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type ToolsConfig = z.infer<typeof toolsSchema>;
export type SecurityConfig = z.infer<typeof configSchema>["security"];
export type ProviderConfig = z.infer<typeof providerSchema>;
export type AuthProfile = z.infer<typeof authProfileSchema>;
export type SystemModels = z.infer<typeof systemModelsSchema>;

export type McpServerConfig = z.input<typeof mcpServerSchema>;
export type ChannelEntry = z.infer<typeof channelEntrySchema>;
export type ChannelAccount = z.infer<typeof channelAccountSchema>;

export { agentSchema, bindingSchema };
