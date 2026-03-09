import type { ToolsConfig } from "../../config/schema";
import { createFileEditTool, createFileReadTool, createFileWriteTool } from "./file";
import { createShellTool } from "./shell";

export type { ToolAuthorizationError, ToolInputError } from "./common";

const TOOL_GROUPS: Record<string, string[]> = {
	"group:exec": ["shell"],
	"group:file": ["file_read", "file_write", "file_edit"],
	"group:web": ["web_search", "web_fetch"],
};

const OWNER_ONLY_TOOLS = new Set(["shell", "file_write", "file_edit"]);

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

export function createToolset(opts: {
	workspaceDir: string;
	toolsConfig: ToolsConfig;
	agentTools?: { allow?: string[]; deny?: string[] };
	channelId?: string;
}) {
	const { workspaceDir, toolsConfig, agentTools, channelId } = opts;
	const timeout = toolsConfig.exec.timeout;
	const maxOutput = toolsConfig.exec.maxOutput;

	const allTools: Record<string, ReturnType<typeof createShellTool>> = {
		shell: createShellTool({ workspaceDir, timeout, maxOutput }),
		file_read: createFileReadTool({ workspaceDir, maxOutput }),
		file_write: createFileWriteTool({ workspaceDir }),
		file_edit: createFileEditTool({ workspaceDir }),
	};

	// Filter by policy
	const tools: Record<string, ReturnType<typeof createShellTool>> = {};
	for (const [name, t] of Object.entries(allTools)) {
		if (isToolAllowed(name, toolsConfig, agentTools, channelId)) {
			tools[name] = t;
		}
	}

	return tools;
}
