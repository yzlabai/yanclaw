import { channelRegistry } from "../channels/registry";
import type { PluginChannelFactory, PluginDefinition, PluginHooks, PluginToolDef } from "./types";

/** Central registry for all loaded plugins. */
export class PluginRegistry {
	private plugins = new Map<string, PluginDefinition>();
	private toolMap = new Map<string, PluginToolDef>();
	private channelFactories = new Map<string, PluginChannelFactory>();
	private hooksList: { pluginId: string; hooks: PluginHooks }[] = [];

	register(plugin: PluginDefinition): void {
		if (this.plugins.has(plugin.id)) {
			console.warn(`[plugins] Plugin "${plugin.id}" already registered, skipping`);
			return;
		}

		this.plugins.set(plugin.id, plugin);

		// Register tools (namespaced: plugin.toolName)
		if (plugin.tools) {
			for (const tool of plugin.tools) {
				const key = `${plugin.id}.${tool.name}`;
				if (this.toolMap.has(key)) {
					console.warn(`[plugins] Tool "${key}" already registered, skipping`);
					continue;
				}
				this.toolMap.set(key, tool);
			}
		}

		// Register channel factories (bridge to channelRegistry for unified startup)
		if (plugin.channels) {
			for (const factory of plugin.channels) {
				if (this.channelFactories.has(factory.type)) {
					console.warn(`[plugins] Channel type "${factory.type}" already registered, skipping`);
					continue;
				}
				this.channelFactories.set(factory.type, factory);
				channelRegistry.register({
					type: factory.type,
					capabilities: factory.capabilities ?? {
						chatTypes: ["direct"],
						supportsMedia: false,
						supportsThread: false,
						supportsMarkdown: false,
						supportsEdit: false,
						supportsReaction: false,
						blockStreaming: false,
						maxTextLength: 4000,
					},
					create: (account) => factory.create(account),
				});
			}
		}

		// Register hooks
		if (plugin.hooks) {
			this.hooksList.push({ pluginId: plugin.id, hooks: plugin.hooks });
		}

		console.log(`[plugins] Registered "${plugin.name}" v${plugin.version}`);
	}

	unregister(pluginId: string): void {
		const plugin = this.plugins.get(pluginId);
		if (!plugin) return;

		// Remove tools
		if (plugin.tools) {
			for (const tool of plugin.tools) {
				this.toolMap.delete(`${pluginId}.${tool.name}`);
			}
		}

		// Remove channel factories
		if (plugin.channels) {
			for (const factory of plugin.channels) {
				this.channelFactories.delete(factory.type);
			}
		}

		// Remove hooks
		this.hooksList = this.hooksList.filter((h) => h.pluginId !== pluginId);

		this.plugins.delete(pluginId);
	}

	getPlugin(id: string): PluginDefinition | undefined {
		return this.plugins.get(id);
	}

	getAllPlugins(): PluginDefinition[] {
		return Array.from(this.plugins.values());
	}

	/** Get all plugin-provided tools as a flat map. */
	getTools(): Map<string, PluginToolDef> {
		return this.toolMap;
	}

	/** Get channel factory by type name. */
	getChannelFactory(type: string): PluginChannelFactory | undefined {
		return this.channelFactories.get(type);
	}

	/** Run all onGatewayStart hooks. */
	async runGatewayStart(
		ctx: Parameters<NonNullable<PluginHooks["onGatewayStart"]>>[0],
	): Promise<void> {
		for (const { pluginId, hooks } of this.hooksList) {
			if (!hooks.onGatewayStart) continue;
			try {
				await hooks.onGatewayStart(ctx);
			} catch (err) {
				console.error(`[plugins] "${pluginId}" onGatewayStart error:`, err);
			}
		}
	}

	/** Run all onGatewayStop hooks. */
	async runGatewayStop(): Promise<void> {
		for (const { pluginId, hooks } of this.hooksList) {
			if (!hooks.onGatewayStop) continue;
			try {
				await hooks.onGatewayStop();
			} catch (err) {
				console.error(`[plugins] "${pluginId}" onGatewayStop error:`, err);
			}
		}
	}

	/** Run all onMessageInbound hooks in order. Returns null if any hook drops the message. */
	async runMessageInbound(msg: unknown): Promise<unknown | null> {
		let current = msg;
		for (const { pluginId, hooks } of this.hooksList) {
			if (!hooks.onMessageInbound) continue;
			try {
				const result = await hooks.onMessageInbound(current);
				if (result === null) return null;
				current = result;
			} catch (err) {
				console.error(`[plugins] "${pluginId}" onMessageInbound error:`, err);
			}
		}
		return current;
	}

	/** Run all beforeToolCall hooks. Returns null if any hook blocks the call. */
	async runBeforeToolCall(call: { name: string; input: unknown }): Promise<unknown | null> {
		let current: unknown = call;
		for (const { pluginId, hooks } of this.hooksList) {
			if (!hooks.beforeToolCall) continue;
			try {
				const result = await hooks.beforeToolCall(current as { name: string; input: unknown });
				if (result === null) return null;
				current = result;
			} catch (err) {
				console.error(`[plugins] "${pluginId}" beforeToolCall error:`, err);
			}
		}
		return current;
	}

	/** Run all afterToolCall hooks. */
	async runAfterToolCall(call: { name: string; input: unknown }, result: unknown): Promise<void> {
		for (const { pluginId, hooks } of this.hooksList) {
			if (!hooks.afterToolCall) continue;
			try {
				await hooks.afterToolCall(call, result);
			} catch (err) {
				console.error(`[plugins] "${pluginId}" afterToolCall error:`, err);
			}
		}
	}
}
