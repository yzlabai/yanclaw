import { channelRegistry } from "../channels/registry";
import { log } from "../logger";
import type { SkillDefinition } from "./skill-loader";
import type { PluginChannelFactory, PluginDefinition, PluginHooks, PluginToolDef } from "./types";

/** Central registry for all loaded plugins. */
export class PluginRegistry {
	private plugins = new Map<string, PluginDefinition>();
	private toolMap = new Map<string, PluginToolDef>();
	private channelFactories = new Map<string, PluginChannelFactory>();
	private hooksList: { pluginId: string; hooks: PluginHooks }[] = [];

	register(plugin: PluginDefinition): void {
		if (this.plugins.has(plugin.id)) {
			log.plugin().warn({ pluginId: plugin.id }, "plugin already registered, skipping");
			return;
		}

		this.plugins.set(plugin.id, plugin);

		// Register tools (namespaced: plugin.toolName)
		if (plugin.tools) {
			for (const tool of plugin.tools) {
				const key = `${plugin.id}.${tool.name}`;
				if (this.toolMap.has(key)) {
					log.plugin().warn({ tool: key }, "tool already registered, skipping");
					continue;
				}
				this.toolMap.set(key, tool);
			}
		}

		// Register channel factories (bridge to channelRegistry for unified startup)
		if (plugin.channels) {
			for (const factory of plugin.channels) {
				if (this.channelFactories.has(factory.type)) {
					log
						.plugin()
						.warn({ channelType: factory.type }, "channel type already registered, skipping");
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

		log.plugin().info({ name: plugin.name, version: plugin.version }, "plugin registered");
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

	/** Get capability requirements for each plugin tool (keyed by qualified name). */
	getToolCapabilities(): Map<string, string[]> {
		const caps = new Map<string, string[]>();
		for (const plugin of this.plugins.values()) {
			if (!plugin.tools || !plugin.capabilities) continue;
			for (const t of plugin.tools) {
				caps.set(`${plugin.id}.${t.name}`, plugin.capabilities);
			}
		}
		return caps;
	}

	/** Check if a plugin tool is owner-only. */
	isOwnerOnlyTool(qualifiedName: string): boolean {
		const dotIdx = qualifiedName.indexOf(".");
		if (dotIdx < 0) return false;
		const pluginId = qualifiedName.slice(0, dotIdx);
		const plugin = this.plugins.get(pluginId);
		return plugin?.ownerOnly ?? false;
	}

	/** Get sanitized prompts from all loaded skills (for system prompt injection). */
	getSkillPrompts(): string[] {
		const prompts: string[] = [];
		for (const plugin of this.plugins.values()) {
			const skill = plugin as SkillDefinition;
			if (!skill.sanitizedPrompt) continue;
			prompts.push(skill.sanitizedPrompt);
		}
		return prompts;
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
				log.plugin().error({ err, pluginId }, "onGatewayStart hook error");
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
				log.plugin().error({ err, pluginId }, "onGatewayStop hook error");
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
				log.plugin().error({ err, pluginId }, "onMessageInbound hook error");
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
				log.plugin().error({ err, pluginId }, "beforeToolCall hook error");
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
				log.plugin().error({ err, pluginId }, "afterToolCall hook error");
			}
		}
	}
}
