import { AgentRuntime } from "./agents/runtime";
import type { ConfigStore } from "./config";
import { SessionStore } from "./db/sessions";

/** Shared gateway state, initialized once at startup. */
export interface GatewayContext {
	config: ConfigStore;
	sessions: SessionStore;
	agentRuntime: AgentRuntime;
}

let ctx: GatewayContext | null = null;

export function initGateway(config: ConfigStore): GatewayContext {
	ctx = {
		config,
		sessions: new SessionStore(),
		agentRuntime: new AgentRuntime(),
	};
	return ctx;
}

export function getGateway(): GatewayContext {
	if (!ctx) throw new Error("Gateway not initialized");
	return ctx;
}
