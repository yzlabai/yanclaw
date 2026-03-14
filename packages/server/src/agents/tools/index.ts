import { jsonSchema, tool } from "ai";
import type { ApprovalManager } from "../../approvals";
import type { Config, ToolsConfig } from "../../config/schema";
import type { MemoryStore } from "../../db/memories";
import type { SessionStore } from "../../db/sessions";
import type { McpClientManager } from "../../mcp/client";
import type { PluginRegistry } from "../../plugins/registry";
import {
	createBrowserActionTool,
	createBrowserNavigateTool,
	createBrowserScreenshotTool,
} from "./browser";
import { createCodeExecTool } from "./code-exec";
import { createDockerShellTool } from "./docker-shell";
import { createFileEditTool, createFileReadTool, createFileWriteTool } from "./file";
import { createMemoryDeleteTool, createMemorySearchTool, createMemoryStoreTool } from "./memory";
import { checkSafeBin } from "./safe-bins";
import { createDesktopScreenshotTool } from "./screenshot";
import {
	createSessionHistoryTool,
	createSessionListTool,
	createSessionSendTool,
} from "./session-comm";
import { createShellTool } from "./shell";
import { createWebFetchTool, createWebSearchTool } from "./web";

export type { ToolAuthorizationError, ToolInputError } from "./common";

const TOOL_GROUPS: Record<string, string[]> = {
	"group:exec": ["shell", "code_exec"],
	"group:file": ["file_read", "file_write", "file_edit"],
	"group:web": ["web_search", "web_fetch"],
	"group:browser": ["browser_navigate", "browser_screenshot", "browser_action"],
	"group:memory": ["memory_store", "memory_search", "memory_delete"],
	"group:desktop": ["screenshot_desktop"],
	"group:session": ["session_list", "session_send", "session_history"],
};

const OWNER_ONLY_TOOLS = new Set([
	"shell",
	"file_write",
	"file_edit",
	"browser_navigate",
	"browser_screenshot",
	"browser_action",
	"screenshot_desktop",
	"session_send",
]);

function expandGroups(names: string[]): string[] {
	const result: string[] = [];
	for (const name of names) {
		if (TOOL_GROUPS[name]) {
			result.push(...TOOL_GROUPS[name]);
		} else {
			result.push(name);
		}
	}
	return result;
}

/** Check if toolName matches any pattern in the list (supports group: prefix and * wildcard). */
function matchesPatterns(toolName: string, patterns: string[]): boolean {
	const expanded = expandGroups(patterns);
	return expanded.some((pattern) => {
		if (pattern.includes("*")) {
			const regex = new RegExp(`^${pattern.replace(/\./g, "\\.").replace(/\*/g, ".*")}$`);
			return regex.test(toolName);
		}
		return pattern === toolName;
	});
}

/** Capabilities required by each tool. */
const TOOL_CAPABILITIES: Record<string, string[]> = {
	shell: ["exec:shell"],
	file_read: ["fs:read"],
	file_write: ["fs:write"],
	file_edit: ["fs:write"],
	web_search: ["net:http"],
	web_fetch: ["net:http"],
	browser_navigate: ["browser:navigate"],
	browser_screenshot: ["browser:capture"],
	browser_action: ["browser:interact"],
	memory_store: ["memory:write"],
	memory_search: ["memory:read"],
	memory_delete: ["memory:write"],
	screenshot_desktop: ["desktop:capture"],
	code_exec: ["exec:sandbox"],
	session_list: ["session:read"],
	session_send: ["session:write"],
	session_history: ["session:read"],
};

/** Predefined capability presets. */
const CAPABILITY_PRESETS: Record<string, string[]> = {
	"safe-reader": ["fs:read", "memory:read"],
	researcher: ["fs:read", "net:http", "memory:read", "memory:write"],
	developer: [
		"fs:read",
		"fs:write",
		"exec:shell",
		"exec:sandbox",
		"net:http",
		"memory:read",
		"memory:write",
	],
	"full-access": ["*"],
};

function resolveCapabilities(caps: string | string[] | undefined): Set<string> | null {
	if (caps === undefined) return null; // No capability restriction
	if (typeof caps === "string") {
		const preset = CAPABILITY_PRESETS[caps];
		if (!preset) {
			console.warn(`[tools] Unknown capability preset: ${caps}, treating as full-access`);
			return null;
		}
		return new Set(preset);
	}
	return new Set(caps);
}

function hasCapabilities(
	toolName: string,
	granted: Set<string>,
	extraCaps?: Map<string, string[]>,
): boolean {
	if (granted.has("*")) return true;
	const required = TOOL_CAPABILITIES[toolName] ?? extraCaps?.get(toolName) ?? [];
	return required.every((cap) => granted.has(cap));
}

export function isOwnerOnlyTool(toolName: string): boolean {
	return OWNER_ONLY_TOOLS.has(toolName);
}

export function isToolAllowed(
	toolName: string,
	toolsConfig: ToolsConfig,
	agentTools?: { allow?: string[]; deny?: string[] },
	channelId?: string,
): boolean {
	// Channel-level deny takes highest priority
	if (channelId && toolsConfig.byChannel[channelId]) {
		const channelPolicy = toolsConfig.byChannel[channelId];
		if (channelPolicy.deny) {
			if (matchesPatterns(toolName, channelPolicy.deny)) return false;
		}
		if (channelPolicy.allow) {
			if (!matchesPatterns(toolName, channelPolicy.allow)) return false;
		}
	}

	// Agent-level deny
	if (agentTools?.deny) {
		if (matchesPatterns(toolName, agentTools.deny)) return false;
	}

	// Global deny
	if (toolsConfig.policy.deny) {
		if (matchesPatterns(toolName, toolsConfig.policy.deny)) return false;
	}

	// Check allow lists (agent → global)
	if (agentTools?.allow) {
		return matchesPatterns(toolName, agentTools.allow);
	}

	if (toolsConfig.policy.allow) {
		return matchesPatterns(toolName, toolsConfig.policy.allow);
	}

	// Fall back to default policy
	return toolsConfig.policy.default === "allow";
}

export async function createToolset(opts: {
	workspaceDir: string;
	toolsConfig: ToolsConfig;
	agentTools?: { allow?: string[]; deny?: string[] };
	channelId?: string;
	isOwner?: boolean;
	agentId?: string;
	config?: Config;
	memoryStore?: MemoryStore;
	mediaStore?: import("../../media").MediaStore;
	sessionKey?: string;
	approvalManager?: ApprovalManager;
	agentCapabilities?: string | string[];
	mcpClientManager?: McpClientManager;
	sessionStore?: SessionStore;
	pluginRegistry?: PluginRegistry;
}) {
	const { workspaceDir, toolsConfig, agentTools, channelId, isOwner = true } = opts;
	const timeout = toolsConfig.exec.timeout;
	const maxOutput = toolsConfig.exec.maxOutput;

	const sandbox = toolsConfig.exec.sandbox;
	const allTools: Record<string, ReturnType<typeof createShellTool>> = {
		shell: sandbox?.enabled
			? createDockerShellTool({ workspaceDir, timeout, maxOutput, sandbox })
			: createShellTool({ workspaceDir, timeout, maxOutput }),
		file_read: createFileReadTool({ workspaceDir, maxOutput }),
		file_write: createFileWriteTool({
			workspaceDir,
			mediaStore: opts.mediaStore,
			sessionKey: opts.sessionKey,
		}),
		file_edit: createFileEditTool({ workspaceDir }),
		web_fetch: createWebFetchTool({
			maxOutput,
			network: opts.config?.security?.network,
			readability: toolsConfig.web?.fetch?.readability,
			cacheTtlMinutes: toolsConfig.web?.fetch?.cacheTtlMinutes,
		}),
		web_search: createWebSearchTool({
			maxOutput,
			search: toolsConfig.web?.search,
		}),
		browser_navigate: createBrowserNavigateTool({
			maxOutput,
			cdpUrl: toolsConfig.browser?.cdpUrl,
		}),
		browser_screenshot: createBrowserScreenshotTool({ cdpUrl: toolsConfig.browser?.cdpUrl }),
		browser_action: createBrowserActionTool({ cdpUrl: toolsConfig.browser?.cdpUrl }),
		screenshot_desktop: createDesktopScreenshotTool(),
	};

	// Add code_exec tool if enabled
	if (toolsConfig.codeExec?.enabled) {
		allTools.code_exec = createCodeExecTool({
			workspaceDir,
			config: toolsConfig.codeExec as import("./code-exec-runner").CodeExecConfig,
		});
	}

	// Add memory tools if memory store is available
	if (opts.memoryStore && opts.agentId && opts.config) {
		allTools.memory_store = createMemoryStoreTool({
			memoryStore: opts.memoryStore,
			agentId: opts.agentId,
			config: opts.config,
			sessionKey: opts.sessionKey,
		});
		const agentConfig = opts.config.agents.find((a) => a.id === opts.agentId);
		allTools.memory_search = createMemorySearchTool({
			memoryStore: opts.memoryStore,
			agentId: opts.agentId,
			config: opts.config,
			includeShared: agentConfig?.memory?.sharedAccess ?? false,
		});
		allTools.memory_delete = createMemoryDeleteTool({
			memoryStore: opts.memoryStore,
		});
	}

	// Add cross-session communication tools if session store is available
	if (opts.sessionStore && opts.sessionKey) {
		allTools.session_list = createSessionListTool({
			sessionStore: opts.sessionStore,
		});
		allTools.session_send = createSessionSendTool({
			sessionStore: opts.sessionStore,
			currentSessionKey: opts.sessionKey,
			currentAgentId: opts.agentId,
		});
		allTools.session_history = createSessionHistoryTool({
			sessionStore: opts.sessionStore,
		});
	}

	// MCP tools — bridge from MCP servers into the toolset
	if (opts.mcpClientManager) {
		for (const serverName of opts.mcpClientManager.getConnectedServers()) {
			const mcpTools = await opts.mcpClientManager.listTools(serverName);
			for (const t of mcpTools) {
				const name = `mcp.${serverName}.${t.name}`;
				allTools[name] = tool({
					description: t.description ?? "",
					parameters: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
					execute: async (input) => {
						return opts.mcpClientManager?.callTool(serverName, t.name, input);
					},
				}) as ReturnType<typeof createShellTool>;
			}
		}
	}

	// Plugin tools — bridge from PluginRegistry into the toolset
	let pluginToolCaps: Map<string, string[]> | undefined;
	if (opts.pluginRegistry) {
		pluginToolCaps = opts.pluginRegistry.getToolCapabilities();
		for (const [qualifiedName, pluginTool] of opts.pluginRegistry.getTools()) {
			allTools[qualifiedName] = tool({
				description: pluginTool.description,
				parameters: pluginTool.parameters,
				execute: async (input) => pluginTool.execute(input),
			}) as ReturnType<typeof createShellTool>;
		}
	}

	// Resolve capability constraints
	const grantedCaps = resolveCapabilities(opts.agentCapabilities);

	// Filter by policy + ownerOnly + capabilities
	const tools: Record<string, ReturnType<typeof createShellTool>> = {};
	for (const [name, t] of Object.entries(allTools)) {
		// Non-owners cannot use ownerOnly tools (built-in or plugin)
		if (!isOwner && isOwnerOnlyTool(name)) continue;
		if (!isOwner && opts.pluginRegistry?.isOwnerOnlyTool(name)) continue;
		if (!isToolAllowed(name, toolsConfig, agentTools, channelId)) continue;
		// Capability-based filtering (check both built-in and plugin caps)
		if (grantedCaps && !hasCapabilities(name, grantedCaps, pluginToolCaps)) continue;
		tools[name] = t;
	}

	// Fail-closed: remove shell when approval is required but manager unavailable
	const { approvalManager } = opts;
	if (!approvalManager && tools.shell && toolsConfig.exec.ask !== "off") {
		console.warn(
			"[tools] Shell tool disabled: approval required but approvalManager not available",
		);
		delete tools.shell;
	}

	// Wrap shell tool with approval if configured
	if (approvalManager && tools.shell && toolsConfig.exec.ask !== "off") {
		const originalShell = tools.shell;
		const askMode = toolsConfig.exec.ask;
		const safeBins = toolsConfig.exec.safeBins;
		const sessionKey = opts.sessionKey ?? "";

		tools.shell = {
			...originalShell,
			execute: async (args: { command: string }, execOpts: unknown) => {
				// SafeBins: check command + arguments against security profiles
				const safeBinResult = checkSafeBin(args.command, safeBins);
				const needsApproval =
					askMode === "always" || (askMode === "on-miss" && !safeBinResult.safe);

				if (needsApproval) {
					const decision = await approvalManager.requestApproval({
						sessionKey,
						toolName: "shell",
						args,
					});
					if (decision === "denied") {
						return { exitCode: 1, output: "Tool execution denied by user." };
					}
				}
				return (originalShell as { execute: (a: unknown, o: unknown) => unknown }).execute(
					args,
					execOpts,
				);
			},
		} as typeof originalShell;
	}

	return tools;
}
