import type { z } from "zod";
import type { ChannelAdapter, ChannelCapabilities } from "../channels/types";
import type { GatewayContext } from "../gateway";

/** Plugin tool definition — mirrors the Agent tool shape. */
export interface PluginToolDef {
	name: string;
	description: string;
	parameters: z.ZodType;
	execute: (input: unknown) => Promise<unknown>;
}

/** Plugin lifecycle hooks. */
export interface PluginHooks {
	/** Called after gateway fully initializes. */
	onGatewayStart?: (ctx: GatewayContext) => void | Promise<void>;
	/** Called before gateway shuts down. */
	onGatewayStop?: () => void | Promise<void>;
	/** Called on each inbound message. Return null to drop it. */
	onMessageInbound?: (msg: unknown) => unknown | null | Promise<unknown | null>;
	/** Called before a tool call. Return null to block it. */
	beforeToolCall?: (call: {
		name: string;
		input: unknown;
	}) => unknown | null | Promise<unknown | null>;
	/** Called after a tool call completes. */
	afterToolCall?: (call: { name: string; input: unknown }, result: unknown) => void | Promise<void>;
}

/** Channel factory for plugin-provided channels. */
export interface PluginChannelFactory {
	type: string;
	capabilities?: ChannelCapabilities;
	create: (config: Record<string, unknown>) => ChannelAdapter;
}

/** A fully resolved plugin definition. */
export interface PluginDefinition {
	id: string;
	name: string;
	version: string;
	/** Run plugin tools in an isolated Worker thread. */
	isolated?: boolean;
	/** Capability requirements for this plugin's tools (e.g. ["net:http", "fs:read"]). */
	capabilities?: string[];
	/** Whether tools are restricted to owner only. */
	ownerOnly?: boolean;
	tools?: PluginToolDef[];
	channels?: PluginChannelFactory[];
	hooks?: PluginHooks;
}

/** Helper to define a plugin with type safety. */
export function definePlugin(def: PluginDefinition): PluginDefinition {
	return def;
}
