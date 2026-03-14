import type { ChannelManager } from "../../channels/manager";
import type { AgentSupervisor } from "./index";
import type { SupervisorEvent } from "./types";

interface NotifierConfig {
	notifyChannel?: string;
	notifyEvents: string[];
}

/**
 * Bridges AgentSupervisor events to chat channels (Telegram/Slack/Discord/etc).
 * Subscribes to supervisor events and sends formatted notifications.
 */
export class AgentHubNotifier {
	private channelManager: ChannelManager;
	private config: NotifierConfig;

	constructor(channelManager: ChannelManager, config: NotifierConfig) {
		this.channelManager = channelManager;
		this.config = config;
	}

	/** Attach to a supervisor and start forwarding events. */
	attach(supervisor: AgentSupervisor): () => void {
		return supervisor.subscribe((event) => {
			if (!this.config.notifyChannel) return;
			if (!this.shouldNotify(event)) return;

			const text = this.format(event);
			if (!text) return;

			this.send(text).catch((err) => {
				console.warn("[agent-hub-notifier] Failed to send notification:", err);
			});
		});
	}

	/** Update config at runtime (e.g. hot-reload). */
	updateConfig(config: NotifierConfig): void {
		this.config = config;
	}

	private shouldNotify(event: SupervisorEvent): boolean {
		const map: Record<string, string> = {
			"process-started": "status-change",
			"process-stopped": "status-change",
			"status-change": "status-change",
			"permission-request": "permission-request",
			"permission-resolved": "permission-request",
		};

		// For agent-event, map subtype
		if (event.type === "agent-event") {
			const subtype = event.event.type;
			if (subtype === "done") return this.config.notifyEvents.includes("done");
			if (subtype === "error") return this.config.notifyEvents.includes("error");
			return false;
		}

		const mapped = map[event.type];
		return mapped ? this.config.notifyEvents.includes(mapped) : false;
	}

	private format(event: SupervisorEvent): string | null {
		switch (event.type) {
			case "process-started":
				return `[▶ ${event.process.agentId}] 已启动${event.process.task ? `: "${event.process.task}"` : ""}`;

			case "process-stopped":
				return `[⏹ ${event.processId.slice(0, 8)}] 已停止 (${event.reason})`;

			case "status-change":
				return `[🔄 ${event.processId.slice(0, 8)}] 状态变更: ${event.status}`;

			case "permission-request":
				return (
					`[⏳ ${event.request.processId.slice(0, 8)}] 等待审批: ${event.request.tool}` +
					`\n\`${event.request.description.slice(0, 200)}\`` +
					`\n风险: ${event.request.risk}`
				);

			case "permission-resolved":
				return `[${event.allowed ? "✅" : "❌"} ${event.requestId.slice(0, 8)}] 审批${event.allowed ? "通过" : "拒绝"}`;

			case "agent-event": {
				const e = event.event;
				if (e.type === "done") {
					const usage = e.usage;
					const tokens = usage ? `${usage.promptTokens + usage.completionTokens}` : "?";
					return `[✅ ${event.processId.slice(0, 8)}] 完成, token: ${tokens}`;
				}
				if (e.type === "error") {
					return `[❌ ${event.processId.slice(0, 8)}] 错误: ${e.message ?? "unknown"}`;
				}
				return null;
			}

			default:
				return null;
		}
	}

	private async send(text: string): Promise<void> {
		const channelKey = this.config.notifyChannel;
		if (!channelKey) return;

		// channelKey format: "telegram:bot_id" or adapter key
		const adapter = this.channelManager.getAdapter(channelKey);
		if (!adapter) {
			console.warn(`[agent-hub-notifier] Channel adapter not found: ${channelKey}`);
			return;
		}

		// Parse peerId from config — format: "channelKey#peerId"
		// e.g., "telegram:bot_prod#-1001234567890"
		const hashIdx = channelKey.indexOf("#");
		if (hashIdx === -1) {
			console.warn("[agent-hub-notifier] notifyChannel must include peer ID: 'adapterKey#peerId'");
			return;
		}

		const adapterKey = channelKey.slice(0, hashIdx);
		const peerId = channelKey.slice(hashIdx + 1);

		const realAdapter = this.channelManager.getAdapter(adapterKey);
		if (!realAdapter) {
			console.warn(`[agent-hub-notifier] Channel adapter not found: ${adapterKey}`);
			return;
		}

		await realAdapter.send({ kind: "group", id: peerId }, { text, format: "plain" });
	}
}
