import { ModelManager } from "./agents/model-manager";
import { AgentRuntime } from "./agents/runtime";
import { ApprovalManager } from "./approvals";
import { DiscordAdapter } from "./channels/discord";
import { ChannelManager } from "./channels/manager";
import { SlackAdapter } from "./channels/slack";
import { TelegramAdapter } from "./channels/telegram";
import type { ConfigStore } from "./config";
import { CronService } from "./cron";
import { MemoryStore } from "./db/memories";
import { SessionStore } from "./db/sessions";
import { MediaStore } from "./media";
import { MemoryAutoIndexer } from "./memory";
import { PluginLoader, PluginRegistry } from "./plugins";

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
}

let ctx: GatewayContext | null = null;

export function initGateway(config: ConfigStore): GatewayContext {
	const modelManager = new ModelManager();
	const approvalManager = new ApprovalManager();
	const agentRuntime = new AgentRuntime(modelManager, approvalManager);
	const channelManager = new ChannelManager();
	const cronService = new CronService();
	const pluginRegistry = new PluginRegistry();

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
		media: new MediaStore(),
		agentRuntime,
		modelManager,
		channelManager,
		cronService,
		pluginRegistry,
		approvalManager,
	};

	return ctx;
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

/** Initialize and connect channels from config. */
export async function startChannels(gw: GatewayContext): Promise<void> {
	const cfg = gw.config.get();

	// Telegram
	if (cfg.channels.telegram?.enabled) {
		for (const account of cfg.channels.telegram.accounts) {
			if (!account.token) continue;
			const adapter = new TelegramAdapter({
				accountId: account.id,
				token: account.token,
			});
			gw.channelManager.register(`telegram:${account.id}`, adapter);
		}
	}

	// Slack
	if (cfg.channels.slack?.enabled) {
		for (const account of cfg.channels.slack.accounts) {
			if (!account.botToken || !account.appToken) continue;
			const adapter = new SlackAdapter({
				accountId: account.id,
				botToken: account.botToken,
				appToken: account.appToken,
			});
			gw.channelManager.register(`slack:${account.id}`, adapter);
		}
	}

	// Discord
	if (cfg.channels.discord?.enabled) {
		for (const account of cfg.channels.discord.accounts) {
			if (!account.token) continue;
			const adapter = new DiscordAdapter({
				accountId: account.id,
				token: account.token,
			});
			gw.channelManager.register(`discord:${account.id}`, adapter);
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
