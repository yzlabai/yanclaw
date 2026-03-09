import { z } from "zod";

// --- Sub-schemas ---

const authProfileSchema = z.object({
	id: z.string(),
	apiKey: z.string(),
	baseUrl: z.string().optional(),
});

const providerSchema = z.object({
	profiles: z.array(authProfileSchema).default([]),
	baseUrl: z.string().optional(),
});

const modelsSchema = z
	.object({
		anthropic: providerSchema.optional(),
		openai: providerSchema.optional(),
		google: providerSchema.optional(),
		ollama: z
			.object({
				baseUrl: z.string().default("http://localhost:11434"),
			})
			.optional(),
	})
	.default({});

const agentSchema = z.object({
	id: z.string(),
	name: z.string(),
	model: z.string().default("claude-sonnet-4-20250514"),
	systemPrompt: z.string().default("You are a helpful assistant."),
	workspaceDir: z.string().optional(),
	tools: z
		.object({
			allow: z.array(z.string()).optional(),
			deny: z.array(z.string()).optional(),
		})
		.optional(),
});

const channelAccountSchema = z.object({
	id: z.string(),
	token: z.string().optional(),
	botToken: z.string().optional(),
	appToken: z.string().optional(),
	allowFrom: z.array(z.string()).default([]),
	dmPolicy: z.enum(["open", "allowlist", "pairing"]).default("allowlist"),
	ownerIds: z.array(z.string()).default([]),
});

const channelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	accounts: z.array(channelAccountSchema).default([]),
});

const channelsSchema = z
	.object({
		telegram: channelConfigSchema.optional(),
		discord: channelConfigSchema.optional(),
		slack: channelConfigSchema.optional(),
	})
	.default({});

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

const defaultAgent = {
	id: "main",
	name: "默认助手",
	model: "claude-sonnet-4-20250514",
	systemPrompt: "You are a helpful assistant.",
};

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
		})
		.default({}),

	memory: z
		.object({
			enabled: z.boolean().default(false),
			embeddingModel: z.string().default("text-embedding-3-small"),
			autoIndex: z.boolean().default(true),
		})
		.default({}),
});

export type Config = z.infer<typeof configSchema>;
export type AgentConfig = z.infer<typeof agentSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type ToolsConfig = z.infer<typeof toolsSchema>;

export { agentSchema, bindingSchema };
