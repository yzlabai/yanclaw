import type { ApprovalManager } from "../../approvals";
import type { Config, ToolsConfig } from "../../config/schema";
import type { MemoryStore } from "../../db/memories";
import {
	createBrowserActionTool,
	createBrowserNavigateTool,
	createBrowserScreenshotTool,
} from "./browser";
import { createDockerShellTool } from "./docker-shell";
import { createFileEditTool, createFileReadTool, createFileWriteTool } from "./file";
import { createMemoryDeleteTool, createMemorySearchTool, createMemoryStoreTool } from "./memory";
import { createDesktopScreenshotTool } from "./screenshot";
import { createShellTool } from "./shell";
import { createWebFetchTool, createWebSearchTool } from "./web";

export type { ToolAuthorizationError, ToolInputError } from "./common";

const TOOL_GROUPS: Record<string, string[]> = {
	"group:exec": ["shell"],
	"group:file": ["file_read", "file_write", "file_edit"],
	"group:web": ["web_search", "web_fetch"],
	"group:browser": ["browser_navigate", "browser_screenshot", "browser_action"],
	"group:memory": ["memory_store", "memory_search", "memory_delete"],
	"group:desktop": ["screenshot_desktop"],
};

const OWNER_ONLY_TOOLS = new Set([
	"shell",
	"file_write",
	"file_edit",
	"browser_navigate",
	"browser_screenshot",
	"browser_action",
	"screenshot_desktop",
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
};

/** Predefined capability presets. */
const CAPABILITY_PRESETS: Record<string, string[]> = {
	"safe-reader": ["fs:read", "memory:read"],
	researcher: ["fs:read", "net:http", "memory:read", "memory:write"],
	developer: ["fs:read", "fs:write", "exec:shell", "net:http", "memory:read", "memory:write"],
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

function hasCapabilities(toolName: string, granted: Set<string>): boolean {
	if (granted.has("*")) return true;
	const required = TOOL_CAPABILITIES[toolName] ?? [];
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
			const denied = expandGroups(channelPolicy.deny);
			if (denied.includes(toolName)) return false;
		}
		if (channelPolicy.allow) {
			const allowed = expandGroups(channelPolicy.allow);
			if (!allowed.includes(toolName)) return false;
		}
	}

	// Agent-level deny
	if (agentTools?.deny) {
		const denied = expandGroups(agentTools.deny);
		if (denied.includes(toolName)) return false;
	}

	// Global deny
	if (toolsConfig.policy.deny) {
		const denied = expandGroups(toolsConfig.policy.deny);
		if (denied.includes(toolName)) return false;
	}

	// Check allow lists (agent → global)
	if (agentTools?.allow) {
		const allowed = expandGroups(agentTools.allow);
		return allowed.includes(toolName);
	}

	if (toolsConfig.policy.allow) {
		const allowed = expandGroups(toolsConfig.policy.allow);
		return allowed.includes(toolName);
	}

	// Fall back to default policy
	return toolsConfig.policy.default === "allow";
}

/** Extract the first binary/command name from a shell command string. */
function extractBinary(command: string): string {
	const trimmed = command.trimStart();
	// Skip env vars like VAR=val, sudo, etc.
	const match = trimmed.match(/^(?:sudo\s+)?(?:\w+=\S+\s+)*(\S+)/);
	return match?.[1]?.split("/").pop() ?? trimmed.split(/\s/)[0] ?? "";
}

export function createToolset(opts: {
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
		web_fetch: createWebFetchTool({ maxOutput, network: opts.config?.security?.network }),
		web_search: createWebSearchTool({ maxOutput }),
		browser_navigate: createBrowserNavigateTool({ maxOutput }),
		browser_screenshot: createBrowserScreenshotTool(),
		browser_action: createBrowserActionTool(),
		screenshot_desktop: createDesktopScreenshotTool(),
	};

	// Add memory tools if memory store is available
	if (opts.memoryStore && opts.agentId && opts.config) {
		allTools.memory_store = createMemoryStoreTool({
			memoryStore: opts.memoryStore,
			agentId: opts.agentId,
			config: opts.config,
			sessionKey: opts.sessionKey,
		});
		allTools.memory_search = createMemorySearchTool({
			memoryStore: opts.memoryStore,
			agentId: opts.agentId,
			config: opts.config,
		});
		allTools.memory_delete = createMemoryDeleteTool({
			memoryStore: opts.memoryStore,
		});
	}

	// Resolve capability constraints
	const grantedCaps = resolveCapabilities(opts.agentCapabilities);

	// Filter by policy + ownerOnly + capabilities
	const tools: Record<string, ReturnType<typeof createShellTool>> = {};
	for (const [name, t] of Object.entries(allTools)) {
		// Non-owners cannot use ownerOnly tools
		if (!isOwner && isOwnerOnlyTool(name)) continue;
		if (!isToolAllowed(name, toolsConfig, agentTools, channelId)) continue;
		// Capability-based filtering
		if (grantedCaps && !hasCapabilities(name, grantedCaps)) continue;
		tools[name] = t;
	}

	// Wrap shell tool with approval if configured
	const { approvalManager } = opts;
	if (approvalManager && tools.shell && toolsConfig.exec.ask !== "off") {
		const originalShell = tools.shell;
		const askMode = toolsConfig.exec.ask;
		const safeBins = toolsConfig.exec.safeBins;
		const sessionKey = opts.sessionKey ?? "";

		tools.shell = {
			...originalShell,
			execute: async (args: { command: string }, execOpts: unknown) => {
				const binary = extractBinary(args.command);
				if (approvalManager.needsApproval(binary, askMode, safeBins)) {
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
