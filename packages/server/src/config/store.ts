import { type FSWatcher, watch } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import JSON5 from "json5";
import { log } from "../logger";
import { CREDENTIAL_FIELDS, CredentialVault, expandVaultRefs } from "../security/vault";
import { type Config, configSchema } from "./schema";

export function resolveDataDir(): string {
	return process.env.YANCLAW_DATA_DIR ?? join(homedir(), ".yanclaw");
}

export function resolveConfigPath(): string {
	return process.env.YANCLAW_CONFIG_PATH ?? join(resolveDataDir(), "config.json5");
}

/** Migrate old channels config from object format to array format. */
function migrateChannelsConfig(raw: unknown): unknown {
	if (!raw || typeof raw !== "object") return raw;
	const obj = raw as Record<string, unknown>;
	const channels = obj.channels;
	if (!channels || Array.isArray(channels)) return raw;

	if (typeof channels === "object") {
		const entries = [];
		for (const [type, config] of Object.entries(channels as Record<string, unknown>)) {
			if (config && typeof config === "object") {
				entries.push({ type, ...(config as Record<string, unknown>) });
			}
		}
		if (entries.length > 0) {
			log.config().info("migrated channels from object to array format");
			obj.channels = entries;
		} else {
			obj.channels = [];
		}
	}

	return raw;
}

/** Migrate old config format (models.anthropic/openai/google/ollama) to new providers format. */
export function migrateConfig(raw: unknown): unknown {
	if (!raw || typeof raw !== "object") return raw;
	const obj = raw as Record<string, unknown>;

	// Migrate channels object → array
	migrateChannelsConfig(obj);

	const models = obj.models as Record<string, unknown> | undefined;
	if (!models) return raw;

	// Already new format
	if (models.providers) return raw;

	// Detect old format: top-level keys are provider names
	const knownProviders = ["anthropic", "openai", "google", "ollama"];
	const hasOldFormat = knownProviders.some((k) => k in models);
	if (!hasOldFormat) return raw;

	log
		.config()
		.warn(
			"detected old models format, migrating to providers format — please update your config file",
		);

	const providers: Record<string, unknown> = {};
	for (const [name, value] of Object.entries(models)) {
		if (!knownProviders.includes(name)) continue;
		if (name === "ollama") {
			providers[name] = { type: "ollama", ...(value as Record<string, unknown>) };
		} else {
			providers[name] = { type: name, ...(value as Record<string, unknown>) };
		}
	}
	obj.models = { providers };
	return raw;
}

/** Count plaintext credentials in config and warn if found. */
function detectPlaintextCredentials(obj: unknown): void {
	const count = countPlaintext(obj);
	if (count > 0) {
		log
			.config()
			.warn(
				{ count },
				"detected plaintext credentials — run: bun run packages/server/src/security/vault-migrate.ts",
			);
	}
}

function countPlaintext(obj: unknown): number {
	if (obj === null || obj === undefined) return 0;
	if (Array.isArray(obj)) return obj.reduce((n, item) => n + countPlaintext(item), 0);
	if (typeof obj !== "object") return 0;
	let count = 0;
	for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
		if (
			CREDENTIAL_FIELDS.has(key) &&
			typeof value === "string" &&
			value.length > 0 &&
			!value.startsWith("$vault:") &&
			!value.startsWith("${")
		) {
			count++;
		}
		count += countPlaintext(value);
	}
	return count;
}

function expandEnvVars(obj: unknown): unknown {
	if (typeof obj === "string") {
		return obj.replace(/\$\{(\w+)\}/g, (_, key) => process.env[key] ?? "");
	}
	if (Array.isArray(obj)) {
		return obj.map(expandEnvVars);
	}
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = expandEnvVars(value);
		}
		return result;
	}
	return obj;
}

function deepMerge(target: unknown, source: unknown): unknown {
	if (
		source !== null &&
		typeof source === "object" &&
		!Array.isArray(source) &&
		target !== null &&
		typeof target === "object" &&
		!Array.isArray(target)
	) {
		const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
		for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
			result[key] = deepMerge(result[key], value);
		}
		return result;
	}
	return source;
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
	const tmpPath = `${filePath}.tmp.${Date.now()}`;
	await writeFile(tmpPath, content, "utf-8");
	await rename(tmpPath, filePath);
}

const DEFAULT_CONFIG = `{
  // YanClaw 配置文件
  // 文档: https://gitee.com/yzlab/yanclaw/blob/master/docs/FEATURES.md

  gateway: {
    port: 18789,
    bind: "loopback",
  },

  agents: [
    {
      id: "main",
      name: "默认助手",
      model: "claude-sonnet-4-20250514",
      systemPrompt: "You are a helpful assistant.",
    },
  ],

  models: {
    providers: {
      // anthropic: { type: "anthropic", profiles: [{ id: "default", apiKey: "\${ANTHROPIC_API_KEY}" }] },
      // openai: { type: "openai", profiles: [{ id: "default", apiKey: "\${OPENAI_API_KEY}" }] },
    },
  },

  channels: {},
  routing: { default: "main", dmScope: "per-peer" },
  tools: { policy: { default: "allow" }, exec: { ask: "on-miss" } },
}
`;

export class ConfigStore {
	private config: Config;
	private configPath: string;
	private watcher: FSWatcher | null = null;
	private listeners = new Set<(config: Config) => void>();
	private vault: CredentialVault | null = null;

	private constructor(config: Config, configPath: string) {
		this.config = config;
		this.configPath = configPath;
	}

	static async load(configPath?: string): Promise<ConfigStore> {
		const path = configPath ?? resolveConfigPath();
		const dir = dirname(path);

		// Ensure data directory exists
		await mkdir(dir, { recursive: true });

		let raw: unknown;
		try {
			const content = await readFile(path, "utf-8");
			raw = JSON5.parse(content);
		} catch {
			// First run: create default config
			await writeFile(path, DEFAULT_CONFIG, "utf-8");
			raw = JSON5.parse(DEFAULT_CONFIG);
		}

		// Migrate old config format before validation
		raw = migrateConfig(raw);

		// Warn if plaintext credentials are detected
		detectPlaintextCredentials(raw);

		// Expand env vars first, then vault refs
		let expanded = expandEnvVars(raw);

		// Initialize vault for $vault:xxx credential resolution
		let vault: CredentialVault | null = null;
		try {
			vault = await CredentialVault.create(dir);
			if (vault.keys().length > 0) {
				expanded = expandVaultRefs(expanded, vault);
			}
		} catch (err) {
			log.config().warn({ err }, "vault initialization failed, credentials will not be decrypted");
		}

		const config = configSchema.parse(expanded);

		// Generate auth token if not set
		if (!config.gateway.auth.token) {
			const { randomBytes } = await import("node:crypto");
			config.gateway.auth.token = randomBytes(32).toString("hex");
		}

		// Write token to file for Tauri IPC and external tools to read
		const tokenPath = join(dir, "auth.token");
		await writeFile(tokenPath, config.gateway.auth.token, "utf-8");

		const store = new ConfigStore(config, path);
		store.vault = vault;
		store.startWatcher();
		return store;
	}

	/** Get the credential vault instance. */
	getVault(): CredentialVault | null {
		return this.vault;
	}

	get(): Config {
		return this.config;
	}

	getAgent(agentId: string) {
		return this.config.agents.find((a) => a.id === agentId);
	}

	onChange(handler: (config: Config) => void): () => void {
		this.listeners.add(handler);
		return () => this.listeners.delete(handler);
	}

	async patch(partial: Record<string, unknown>): Promise<void> {
		const merged = deepMerge(this.config, partial);
		const validated = configSchema.parse(merged);
		this.config = validated;

		await atomicWrite(this.configPath, JSON5.stringify(validated, null, 2));
		this.notifyListeners();
	}

	private startWatcher(): void {
		try {
			this.watcher = watch(this.configPath, async () => {
				try {
					const content = await readFile(this.configPath, "utf-8");
					let raw: unknown = JSON5.parse(content);
					raw = migrateConfig(raw);
					let expanded = expandEnvVars(raw);
					if (this.vault && this.vault.keys().length > 0) {
						expanded = expandVaultRefs(expanded, this.vault);
					}
					const newConfig = configSchema.parse(expanded);

					// Preserve runtime-only token
					if (!newConfig.gateway.auth.token) {
						newConfig.gateway.auth.token = this.config.gateway.auth.token;
					}

					this.config = newConfig;
					this.notifyListeners();
					log.config().info("hot-reloaded config");
				} catch (err) {
					log.config().error({ err }, "reload failed, keeping old config");
				}
			});
		} catch {
			// Watch not supported (e.g., some CI environments)
		}
	}

	private notifyListeners(): void {
		for (const listener of this.listeners) {
			try {
				listener(this.config);
			} catch (err) {
				log.config().error({ err }, "listener error");
			}
		}
	}

	close(): void {
		this.watcher?.close();
		this.watcher = null;
		this.listeners.clear();
	}
}
