import { ModelManager } from "./agents/model-manager";
import { AgentRuntime } from "./agents/runtime";
import { UsageTracker } from "./agents/usage-tracker";
import { ApprovalManager } from "./approvals";
import { ChannelManager } from "./channels/manager";
import { channelRegistry } from "./channels/registry";
// Import adapters to trigger self-registration side effects
import "./channels/discord";
import "./channels/feishu";
import "./channels/slack";
import "./channels/telegram";
import type { ConfigStore } from "./config";
import { CronService } from "./cron";
import { HeartbeatRunner } from "./cron/heartbeat";
import { MemoryStore } from "./db/memories";
import { SessionStore } from "./db/sessions";
import { getRawDatabase } from "./db/sqlite";
import { McpClientManager } from "./mcp/client";
import { MediaStore } from "./media";
import { SttService } from "./media/stt";
import { MemoryAutoIndexer } from "./memory";
import { setEmbeddingModelManager } from "./memory/embeddings";
import { PluginLoader, PluginRegistry } from "./plugins";
import { webKnowledgePlugin } from "./plugins/builtin/web-knowledge";
import { AnomalyDetector } from "./security/anomaly";
import { AuditLogger } from "./security/audit";
import { LeakDetector } from "./security/leak-detector";
import { TokenRotation } from "./security/token-rotation";

/** Shared gateway state, initialized once at startup. */
export interface GatewayContext {
	config: ConfigStore;
	sessions: SessionStore;
	memories: MemoryStore;
	media: MediaStore;
	sttService: SttService;
	agentRuntime: AgentRuntime;
	modelManager: ModelManager;
	channelManager: ChannelManager;
	cronService: CronService;
	pluginRegistry: PluginRegistry;
	approvalManager: ApprovalManager;
	mcpClientManager: McpClientManager;
	leakDetector: LeakDetector;
	auditLogger: AuditLogger | null;
	anomalyDetector: AnomalyDetector;
	tokenRotation: TokenRotation | null;
	usageTracker: UsageTracker;
	heartbeatRunner: HeartbeatRunner;
}

let ctx: GatewayContext | null = null;

export function initGateway(config: ConfigStore): GatewayContext {
	const modelManager = new ModelManager();
	const approvalManager = new ApprovalManager();
	const mcpClientManager = new McpClientManager();
	const mediaStore = new MediaStore();
	const leakDetector = new LeakDetector();
	const anomalyDetector = new AnomalyDetector();
	const usageTracker = new UsageTracker();

	// Initialize audit logger with raw SQLite database
	let auditLogger: AuditLogger | null = null;
	try {
		const rawDb = getRawDatabase();
		auditLogger = new AuditLogger(rawDb);
	} catch {
		console.warn("[gateway] Audit logger not available (database not initialized)");
	}

	setEmbeddingModelManager(modelManager);
	const sttService = new SttService(modelManager);
	const pluginRegistry = new PluginRegistry();
	const agentRuntime = new AgentRuntime(
		modelManager,
		approvalManager,
		mediaStore,
		leakDetector,
		mcpClientManager,
		usageTracker,
		pluginRegistry,
	);
	const channelManager = new ChannelManager();
	channelManager.sttService = sttService;
	channelManager.pluginRegistry = pluginRegistry;
	const cronService = new CronService();

	// Initialize token rotation if configured
	const securityCfg = config.get().security;
	let tokenRotation: TokenRotation | null = null;
	if (securityCfg.tokenRotation.intervalHours > 0) {
		tokenRotation = new TokenRotation({
			initialToken: config.get().gateway.auth.token ?? "",
			intervalHours: securityCfg.tokenRotation.intervalHours,
			gracePeriodMinutes: securityCfg.tokenRotation.gracePeriodMinutes,
			onRotate: (newToken) => {
				// Update the config's in-memory token so other components see it
				config.get().gateway.auth.token = newToken;
			},
		});
	}

	// Register API keys for leak detection
	leakDetector.registerFromConfig(config.get());
	config.onChange((cfg) => {
		leakDetector.registerFromConfig(cfg);
	});

	// Wire up channel manager → agent runtime
	channelManager.getConfig = () => config.get();
	channelManager.setAgentRunner((params) => agentRuntime.run(params));

	// Wire up cron → agent runtime
	cronService.setConfigGetter(() => config.get());
	cronService.setAgentRunner((params) => agentRuntime.run(params));

	// Wire up heartbeat runner
	const heartbeatRunner = new HeartbeatRunner(() => config.get());
	heartbeatRunner.setAgentRunner((params) => agentRuntime.run(params));
	channelManager.onAgentActivity = (agentId, channelId) => {
		heartbeatRunner.recordActivity(agentId, channelId);
	};
	channelManager.onApprovalCommand = (approvalId, decision) => {
		return approvalManager.respond(approvalId, decision);
	};

	ctx = {
		config,
		sessions: new SessionStore(),
		memories: new MemoryStore(),
		media: mediaStore,
		sttService,
		agentRuntime,
		modelManager,
		channelManager,
		cronService,
		pluginRegistry,
		approvalManager,
		mcpClientManager,
		leakDetector,
		auditLogger,
		anomalyDetector,
		tokenRotation,
		usageTracker,
		heartbeatRunner,
	};

	return ctx;
}

/** Initialize and connect MCP servers from config. */
export async function startMcp(gw: GatewayContext): Promise<void> {
	const cfg = gw.config.get();
	const servers = cfg.mcp?.servers ?? {};
	const count = Object.keys(servers).length;
	if (count === 0) return;

	await gw.mcpClientManager.startAll(servers);

	const status = gw.mcpClientManager.getStatus();
	const connected = Object.values(status).filter((s) => s.status === "connected").length;
	console.log(`[gateway] MCP: ${connected}/${count} server(s) connected`);

	// Hot-reload: watch for mcp config changes
	gw.config.onChange((newCfg) => {
		gw.mcpClientManager.reload(newCfg.mcp?.servers ?? {}).catch((err) => {
			console.error("[mcp] Hot-reload failed:", err);
		});
	});
}

/** Discover and load plugins. */
export async function startPlugins(gw: GatewayContext): Promise<void> {
	const cfg = gw.config.get();
	const loader = new PluginLoader(gw.pluginRegistry);
	await loader.loadAll(cfg.plugins);

	// Register built-in plugins
	registerBuiltinPlugins(gw);

	// Run onGatewayStart hooks
	await gw.pluginRegistry.runGatewayStart(gw);

	const count = gw.pluginRegistry.getAllPlugins().length;
	if (count > 0) {
		console.log(`[gateway] ${count} plugin(s) loaded`);
	}
}

/** Register built-in plugins that ship with the server. */
function registerBuiltinPlugins(gw: GatewayContext): void {
	const cfg = gw.config.get();

	// web-knowledge: auto-store web_fetch results into knowledge base
	if (cfg.memory.enabled) {
		gw.pluginRegistry.register(webKnowledgePlugin);
	}
}

/** Initialize and connect channels from config using the channel registry. */
export async function startChannels(gw: GatewayContext): Promise<void> {
	const cfg = gw.config.get();

	for (const channel of cfg.channels) {
		if (!channel.enabled) continue;

		for (const account of channel.accounts) {
			const adapter = channelRegistry.create(channel.type, account);
			if (!adapter) {
				console.warn(`[channel] Skipping ${channel.type}:${account.id} (missing required config)`);
				continue;
			}
			gw.channelManager.register(`${channel.type}:${account.id}`, adapter);
		}
	}

	await gw.channelManager.connectAll();

	// Start health monitor for auto-reconnect
	gw.channelManager.startHealthMonitor();
}

/** Start the cron scheduler. */
export function startCron(gw: GatewayContext): void {
	const cfg = gw.config.get();
	if (cfg.cron.tasks.length > 0) {
		gw.cronService.start();
		console.log(`[gateway] Cron scheduler started with ${cfg.cron.tasks.length} task(s)`);
	}

	// Refresh schedules on config reload
	gw.config.onChange(() => {
		gw.cronService.refreshSchedules();
	});
}

/** Start heartbeat runners for agents that have heartbeat enabled. */
export function startHeartbeats(gw: GatewayContext): void {
	const cfg = gw.config.get();
	const heartbeatAgents = cfg.agents.filter((a) => a.heartbeat?.enabled);
	if (heartbeatAgents.length === 0) return;

	gw.heartbeatRunner.start();
	console.log(`[gateway] Heartbeat started for ${heartbeatAgents.length} agent(s)`);

	// Refresh on config reload
	gw.config.onChange(() => {
		gw.heartbeatRunner.refresh();
	});
}

/** Track auto-reset timers for cleanup on config reload. */
const autoResetTimers: ReturnType<typeof setInterval | typeof setTimeout>[] = [];

/** Clear all auto-reset timers (called before re-scheduling). */
function clearAutoResetTimers(): void {
	for (const timer of autoResetTimers) {
		clearInterval(timer);
		clearTimeout(timer);
	}
	autoResetTimers.length = 0;
}

/** Run session cleanup on startup. */
export function runSessionCleanup(gw: GatewayContext): void {
	// Clear previous timers if re-running (hot reload)
	clearAutoResetTimers();
	const cfg = gw.config.get();
	const days = cfg.session.pruneAfterDays;
	if (days > 0) {
		gw.sessions.pruneStale(days);
	}

	// Also clean expired media
	gw.media.cleanup().catch((err) => {
		console.error("[gateway] Media cleanup error:", err);
	});

	// Prune old audit logs (same retention as sessions)
	if (gw.auditLogger) {
		const pruned = gw.auditLogger.prune(days);
		if (pruned > 0) {
			console.log(`[gateway] Pruned ${pruned} audit log entries`);
		}
	}

	// Prune old usage records
	const usagePruned = gw.usageTracker.prune(days);
	if (usagePruned > 0) {
		console.log(`[gateway] Pruned ${usagePruned} usage records`);
	}

	// Session auto-reset
	const autoReset = cfg.session.autoReset;
	if (autoReset?.enabled) {
		// Idle timeout reset on startup
		const idleMs = parseDurationMs(autoReset.idleTimeout);
		if (idleMs) {
			const resetCount = gw.sessions.resetIdle(idleMs);
			if (resetCount > 0) {
				console.log(`[gateway] Auto-reset ${resetCount} idle session(s)`);
			}
		}

		// Schedule periodic idle check (every 30 minutes)
		const idleCheckTimer = setInterval(() => {
			const ms = parseDurationMs(autoReset.idleTimeout);
			if (ms) {
				const count = gw.sessions.resetIdle(ms);
				if (count > 0) {
					console.log(`[gateway] Auto-reset ${count} idle session(s)`);
				}
			}
		}, 30 * 60_000);
		autoResetTimers.push(idleCheckTimer);

		// Daily reset timer
		if (autoReset.dailyResetTime) {
			scheduleDailyReset(gw, autoReset.dailyResetTime, autoReset.timezone);
		}
	}
}

/** Parse duration string to milliseconds. */
function parseDurationMs(s: string): number | null {
	const match = s.match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d|day)s?$/i);
	if (!match) return null;
	const value = Number.parseFloat(match[1]);
	const unit = match[2].toLowerCase();
	const multipliers: Record<string, number> = {
		s: 1000,
		sec: 1000,
		m: 60_000,
		min: 60_000,
		h: 3_600_000,
		hr: 3_600_000,
		d: 86_400_000,
		day: 86_400_000,
	};
	return value * (multipliers[unit] ?? 0) || null;
}

/** Schedule a daily session reset at a specific time. */
function scheduleDailyReset(gw: GatewayContext, timeStr: string, timezone: string): void {
	const [hours, minutes] = timeStr.split(":").map(Number);
	if (Number.isNaN(hours) || Number.isNaN(minutes)) {
		console.warn(`[gateway] Invalid dailyResetTime: ${timeStr}`);
		return;
	}

	const scheduleNext = () => {
		const now = new Date();
		// Get current time in target timezone
		const formatter = new Intl.DateTimeFormat("en-US", {
			timeZone: timezone,
			hour: "numeric",
			minute: "numeric",
			hour12: false,
		});
		const parts = formatter.formatToParts(now);
		const currentHour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
		const currentMinute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);

		let msUntilReset = (hours - currentHour) * 3_600_000 + (minutes - currentMinute) * 60_000;
		if (msUntilReset <= 60_000) {
			// Less than 1 minute away or already past — schedule for next day
			msUntilReset += 24 * 3_600_000;
		}

		const timer = setTimeout(() => {
			const cfg = gw.config.get();
			if (cfg.session.autoReset?.enabled) {
				// Reset all sessions with messages
				const resetCount = gw.sessions.resetIdle(0); // 0ms = reset all with messages
				if (resetCount > 0) {
					console.log(`[gateway] Daily reset: cleared ${resetCount} session(s)`);
				}
			}
			scheduleNext(); // Schedule next day
		}, msUntilReset);
		autoResetTimers.push(timer);

		console.log(
			`[gateway] Daily session reset scheduled at ${timeStr} (${timezone}), next in ${Math.round(msUntilReset / 60_000)}m`,
		);
	};

	scheduleNext();
}

/** Start memory auto-indexer if configured. */
export async function startMemoryIndexer(gw: GatewayContext): Promise<void> {
	const cfg = gw.config.get();
	if (!cfg.memory.enabled || !cfg.memory.autoIndex) return;
	if (cfg.memory.indexDirs.length === 0) return;

	const indexer = new MemoryAutoIndexer(gw.memories, cfg);
	await indexer.start();
}

export function getGateway(): GatewayContext {
	if (!ctx) throw new Error("Gateway not initialized");
	return ctx;
}
