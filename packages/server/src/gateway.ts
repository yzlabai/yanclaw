import { ModelManager } from "./agents/model-manager";
import { AgentRuntime } from "./agents/runtime";
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
import { MemoryStore } from "./db/memories";
import { SessionStore } from "./db/sessions";
import { getRawDatabase } from "./db/sqlite";
import { McpClientManager } from "./mcp/client";
import { MediaStore } from "./media";
import { SttService } from "./media/stt";
import { MemoryAutoIndexer } from "./memory";
import { setEmbeddingModelManager } from "./memory/embeddings";
import { PluginLoader, PluginRegistry } from "./plugins";
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
}

let ctx: GatewayContext | null = null;

export function initGateway(config: ConfigStore): GatewayContext {
	const modelManager = new ModelManager();
	const approvalManager = new ApprovalManager();
	const mcpClientManager = new McpClientManager();
	const mediaStore = new MediaStore();
	const leakDetector = new LeakDetector();
	const anomalyDetector = new AnomalyDetector();

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
	const agentRuntime = new AgentRuntime(
		modelManager,
		approvalManager,
		mediaStore,
		leakDetector,
		mcpClientManager,
	);
	const channelManager = new ChannelManager();
	channelManager.sttService = sttService;
	const cronService = new CronService();
	const pluginRegistry = new PluginRegistry();

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

	ctx = {
		config,
		sessions: new SessionStore(),
		memories: new MemoryStore(),
		media: mediaStore,
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

	// Run onGatewayStart hooks
	await gw.pluginRegistry.runGatewayStart(gw);

	const count = gw.pluginRegistry.getAllPlugins().length;
	if (count > 0) {
		console.log(`[gateway] ${count} plugin(s) loaded`);
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

/** Run session cleanup on startup. */
export function runSessionCleanup(gw: GatewayContext): void {
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
