import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import pino from "pino";

const LOG_DIR = resolve(homedir(), ".yanclaw", "logs");

export type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

export interface LoggingConfig {
	level: LogLevel;
	file: { enabled: boolean; maxSize: number; maxFiles: number };
	pretty: boolean;
}

const DEFAULTS: LoggingConfig = {
	level: "info",
	file: { enabled: true, maxSize: 10 * 1024 * 1024, maxFiles: 7 },
	pretty: true,
};

function buildLogger(cfg: LoggingConfig): pino.Logger {
	const targets: pino.TransportTargetOptions[] = [];

	if (cfg.pretty) {
		targets.push({
			target: "pino-pretty",
			level: cfg.level,
			options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" },
		});
	} else {
		// JSON to stdout in production
		targets.push({ target: "pino/file", level: cfg.level, options: { destination: 1 } });
	}

	if (cfg.file.enabled) {
		try {
			mkdirSync(LOG_DIR, { recursive: true });
		} catch {
			// ignore — will fail at write time if truly broken
		}
		targets.push({
			target: "pino-roll",
			level: cfg.level,
			options: {
				file: resolve(LOG_DIR, "gateway"),
				size: `${Math.round(cfg.file.maxSize / 1024)}k`,
				limit: { count: cfg.file.maxFiles },
			},
		});
	}

	return pino({ level: cfg.level, transport: { targets } });
}

// ── Singleton ──────────────────────────────────────────────

let _logger: pino.Logger | null = null;

/** Get the global logger instance. Creates with defaults on first call. */
export function getLogger(): pino.Logger {
	if (!_logger) _logger = buildLogger(DEFAULTS);
	return _logger;
}

/** Initialize the global logger with config. Call once at startup. */
export function initLogger(config?: Partial<LoggingConfig>): pino.Logger {
	const cfg: LoggingConfig = {
		level: config?.level ?? DEFAULTS.level,
		file: { ...DEFAULTS.file, ...config?.file },
		pretty: config?.pretty ?? DEFAULTS.pretty,
	};
	_logger = buildLogger(cfg);
	return _logger;
}

// ── Module loggers (lazy children) ─────────────────────────

type Module =
	| "gateway"
	| "agent"
	| "channel"
	| "routing"
	| "security"
	| "plugin"
	| "mcp"
	| "cron"
	| "config"
	| "db";

const children = new Map<string, pino.Logger>();

/** Get a child logger tagged with a module name. */
export function moduleLogger(mod: Module): pino.Logger {
	const existing = children.get(mod);
	if (existing) return existing;
	const child = getLogger().child({ module: mod });
	children.set(mod, child);
	return child;
}

// Convenience shorthand
export const log = {
	gateway: () => moduleLogger("gateway"),
	agent: () => moduleLogger("agent"),
	channel: () => moduleLogger("channel"),
	routing: () => moduleLogger("routing"),
	security: () => moduleLogger("security"),
	plugin: () => moduleLogger("plugin"),
	mcp: () => moduleLogger("mcp"),
	cron: () => moduleLogger("cron"),
	config: () => moduleLogger("config"),
	db: () => moduleLogger("db"),
};
