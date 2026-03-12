import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "../config/store";
import type { PluginRegistry } from "./registry";
import { SkillLoader } from "./skill-loader";
import type { PluginDefinition } from "./types";
import { isolatePlugin, type PluginWorkerHost } from "./worker-host";

export interface SkillConfig {
	enabled: boolean;
	config: Record<string, unknown>;
	agents: string[];
}

export interface PluginConfig {
	/** Plugin ID → enabled status. Defaults to true if not listed. */
	enabled: Record<string, boolean>;
	/** Additional directories to scan for plugins. */
	dirs: string[];
	/** Skill-specific configuration. */
	skills?: Record<string, SkillConfig>;
}

/** Discover and load plugins into the registry. */
export class PluginLoader {
	private registry: PluginRegistry;
	private workerHosts: PluginWorkerHost[] = [];
	private skillLoader = new SkillLoader();

	constructor(registry: PluginRegistry) {
		this.registry = registry;
	}

	/** Stop all worker hosts. */
	async stopWorkers(): Promise<void> {
		for (const host of this.workerHosts) {
			await host.stop();
		}
		this.workerHosts = [];
	}

	/** Scan directories and load discovered plugins. */
	async loadAll(config: PluginConfig): Promise<void> {
		const dataDir = resolveDataDir();
		const defaultPluginsDir = join(dataDir, "plugins");
		const skillsDir = join(dataDir, "skills");
		const dirs = [defaultPluginsDir, skillsDir, ...config.dirs];

		for (const dir of dirs) {
			await this.scanDirectory(dir, config.enabled, config.skills);
		}
	}

	/** Scan a single directory for plugin subdirectories. */
	private async scanDirectory(
		dir: string,
		enabled: Record<string, boolean>,
		skills?: Record<string, SkillConfig>,
	): Promise<void> {
		let entries: string[];
		try {
			entries = await readdir(dir);
		} catch {
			// Directory doesn't exist — normal on first run
			return;
		}

		for (const entry of entries) {
			const pluginPath = join(dir, entry);
			try {
				const info = await stat(pluginPath);
				if (!info.isDirectory()) continue;

				await this.loadPlugin(pluginPath, enabled, skills);
			} catch (err) {
				console.error(`[plugins] Failed to inspect "${entry}":`, err);
			}
		}
	}

	/** Load a single plugin from its directory. */
	private async loadPlugin(
		pluginPath: string,
		enabled: Record<string, boolean>,
		skills?: Record<string, SkillConfig>,
	): Promise<void> {
		try {
			// Try skill.json first (enhanced format with metadata + prompt)
			const skillDef = await this.skillLoader.loadSkill(pluginPath);
			if (skillDef) {
				// Check if skill is disabled (check both plugins.enabled and plugins.skills)
				const skillCfg = skills?.[skillDef.id];
				if (enabled[skillDef.id] === false || skillCfg?.enabled === false) {
					console.log(`[skill] "${skillDef.name}" is disabled, skipping`);
					return;
				}

				if (skillDef.isolated && skillDef.tools && skillDef.tools.length > 0) {
					const entryPath = join(pluginPath, skillDef.manifest.main);
					const { definition, host } = isolatePlugin(skillDef, entryPath);
					this.workerHosts.push(host);
					this.registry.register(definition);
				} else {
					this.registry.register(skillDef);
				}
				return;
			}

			// Fallback: legacy plugin loading (no skill.json)
			const entryPath = await this.resolveEntry(pluginPath);
			if (!entryPath) {
				console.warn(`[plugins] No entry point found in ${pluginPath}`);
				return;
			}

			const mod = await import(entryPath);
			const plugin: PluginDefinition = mod.default ?? mod;

			if (!plugin.id || !plugin.name || !plugin.version) {
				console.warn(`[plugins] Invalid plugin at ${pluginPath}: missing id/name/version`);
				return;
			}

			// Check if plugin is disabled in config
			if (enabled[plugin.id] === false) {
				console.log(`[plugins] "${plugin.name}" is disabled, skipping`);
				return;
			}

			// If plugin requests isolation, wrap tools in a worker
			if (plugin.isolated && plugin.tools && plugin.tools.length > 0) {
				const { definition, host } = isolatePlugin(plugin, entryPath);
				this.workerHosts.push(host);
				this.registry.register(definition);
				console.log(`[plugins] "${plugin.name}" loaded with Worker isolation`);
			} else {
				this.registry.register(plugin);
			}
		} catch (err) {
			console.error(`[plugins] Failed to load plugin at "${pluginPath}":`, err);
		}
	}

	/** Resolve the entry point file for a plugin directory. */
	private async resolveEntry(pluginPath: string): Promise<string | null> {
		// Try common entry point patterns
		const candidates = ["index.ts", "index.js", "index.mjs", "mod.ts", "mod.js"];

		for (const candidate of candidates) {
			const filePath = join(pluginPath, candidate);
			try {
				const info = await stat(filePath);
				if (info.isFile()) return filePath;
			} catch {
				// File doesn't exist, try next
			}
		}

		// Try package.json main field
		try {
			const pkgPath = join(pluginPath, "package.json");
			const pkgContent = await Bun.file(pkgPath).text();
			const pkg = JSON.parse(pkgContent);
			if (pkg.main) {
				const mainPath = join(pluginPath, pkg.main);
				const info = await stat(mainPath);
				if (info.isFile()) return mainPath;
			}
		} catch {
			// No package.json
		}

		return null;
	}
}
