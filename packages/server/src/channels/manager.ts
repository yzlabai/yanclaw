import type { Config, Preference } from "../config/schema";
import type { SttService } from "../media/stt";
import type { PluginRegistry } from "../plugins/registry";
import { resolveIdentity, resolveRoute } from "../routing/resolve";
import { checkDmPolicy, isOwnerSender } from "./dm-policy";
import { CHANNEL_DOCK } from "./dock";
import type { ChannelAdapter, ChannelStatus, InboundMessage } from "./types";

export interface ChannelInfo {
	type: string;
	accountId: string;
	status: ChannelStatus;
	error?: string;
}

/** Manages channel adapter lifecycle and message routing. */
export class ChannelManager {
	private adapters = new Map<string, ChannelAdapter>();
	private healthTimer: ReturnType<typeof setInterval> | null = null;
	private reconnectAttempts = new Map<string, number>();
	sttService?: SttService;
	pluginRegistry?: PluginRegistry;
	onAgentActivity?: (agentId: string, channelId: string) => void;
	/** Approval responder callback (set from gateway). */
	onApprovalCommand?: (approvalId: string, decision: "approved" | "denied") => boolean;
	private agentRunner?: (params: {
		agentId: string;
		sessionKey: string;
		message: string;
		config: Config;
		isOwner: boolean;
		channelId: string;
		imageUrls?: string[];
		preference?: Preference;
	}) => AsyncGenerator<{
		type: string;
		text?: string;
		sessionKey?: string;
		message?: string;
	}>;

	/** Register the agent runner callback (set by gateway init). */
	setAgentRunner(
		runner: (params: {
			agentId: string;
			sessionKey: string;
			message: string;
			config: Config;
			isOwner: boolean;
			channelId: string;
			imageUrls?: string[];
			preference?: Preference;
		}) => AsyncGenerator<{
			type: string;
			text?: string;
			sessionKey?: string;
			message?: string;
		}>,
	): void {
		this.agentRunner = runner;
	}

	/** Register a channel adapter. */
	register(key: string, adapter: ChannelAdapter): void {
		this.adapters.set(key, adapter);
		adapter.onMessage((msg) => this.handleInbound(msg));
	}

	/** Connect all registered adapters. */
	async connectAll(): Promise<void> {
		const promises = [];
		for (const [key, adapter] of this.adapters) {
			promises.push(
				adapter.connect().catch((err) => {
					console.error(`[channel] Failed to connect ${key}:`, err.message);
				}),
			);
		}
		await Promise.allSettled(promises);
	}

	/** Start periodic health monitoring with auto-reconnect. */
	startHealthMonitor(intervalMs = 30_000): void {
		if (this.healthTimer) return;
		this.healthTimer = setInterval(() => this.checkHealth(), intervalMs);
	}

	/** Stop health monitoring. */
	stopHealthMonitor(): void {
		if (this.healthTimer) {
			clearInterval(this.healthTimer);
			this.healthTimer = null;
		}
	}

	private async checkHealth(): Promise<void> {
		for (const [key, adapter] of this.adapters) {
			if (adapter.status === "error" || adapter.status === "disconnected") {
				const attempts = this.reconnectAttempts.get(key) ?? 0;

				// Exponential backoff: skip if not enough ticks have passed
				// attempts 0 → immediate, 1 → skip 1, 2 → skip 3, 3 → skip 7, max skip 15
				const backoffTicks = Math.min(2 ** attempts - 1, 15);
				const tickCount = (this.reconnectAttempts.get(`${key}:tick`) ?? 0) + 1;
				this.reconnectAttempts.set(`${key}:tick`, tickCount);

				if (tickCount <= backoffTicks) continue;

				// Reset tick counter for next cycle
				this.reconnectAttempts.set(`${key}:tick`, 0);

				console.log(`[channel] Reconnecting ${key} (attempt ${attempts + 1})...`);
				try {
					await adapter.disconnect().catch(() => {});
					await adapter.connect();
					this.reconnectAttempts.set(key, 0);
					console.log(`[channel] Reconnected ${key} successfully`);
				} catch (err) {
					this.reconnectAttempts.set(key, attempts + 1);
					console.error(
						`[channel] Reconnect ${key} failed:`,
						err instanceof Error ? err.message : err,
					);
				}
			} else if (adapter.status === "connected") {
				// Reset attempts on healthy connection
				this.reconnectAttempts.delete(key);
				this.reconnectAttempts.delete(`${key}:tick`);
			}
		}
	}

	/** Disconnect all registered adapters. */
	async disconnectAll(): Promise<void> {
		this.stopHealthMonitor();
		const promises = [];
		for (const adapter of this.adapters.values()) {
			promises.push(adapter.disconnect().catch(() => {}));
		}
		await Promise.allSettled(promises);
	}

	/** Get status of all channels. */
	getChannelInfos(): ChannelInfo[] {
		const infos: ChannelInfo[] = [];
		for (const [_key, adapter] of this.adapters) {
			infos.push({
				type: adapter.type,
				accountId: adapter.id,
				status: adapter.status,
			});
		}
		return infos;
	}

	/** Get a specific adapter. */
	getAdapter(key: string): ChannelAdapter | undefined {
		return this.adapters.get(key);
	}

	/** Remove a registered adapter. */
	unregister(key: string): void {
		this.adapters.delete(key);
	}

	/** Handle an inbound message: DM policy → route → agent → reply. */
	private async handleInbound(msg: InboundMessage): Promise<void> {
		// We need a config to route. This is injected via gateway.
		const config = this.getConfig?.();
		if (!config) {
			console.warn("[channel] No config available, dropping message");
			return;
		}

		// 0. Handle approval commands (/approve <id>, /deny <id>)
		const approvalMatch = msg.text.match(/^\/(approve|deny)\s+(\S+)/i);
		if (approvalMatch && this.onApprovalCommand) {
			const isOwner = isOwnerSender(msg, config);
			if (isOwner) {
				const decision = approvalMatch[1].toLowerCase() === "approve" ? "approved" : "denied";
				const approvalId = approvalMatch[2];
				const handled = this.onApprovalCommand(approvalId, decision as "approved" | "denied");
				if (handled) {
					const adapter = this.findAdapter(msg.channel, msg.accountId);
					if (adapter) {
						await adapter.send(msg.peer, {
							text: `Tool execution ${decision}.`,
							format: "plain",
						});
					}
					return;
				}
			}
		}

		// 0.5. Plugin onMessageInbound hooks
		if (this.pluginRegistry) {
			const filtered = await this.pluginRegistry.runMessageInbound(msg);
			if (filtered === null) {
				console.log("[channel] Message dropped by plugin hook");
				return;
			}
		}

		// 1. DM policy check
		const dmResult = checkDmPolicy(msg, config);
		if (dmResult === "denied") return;
		if (dmResult === "pairing-required") {
			const adapter = this.findAdapter(msg.channel, msg.accountId);
			if (adapter) {
				await adapter.send(msg.peer, {
					text: "Please provide a pairing code to start chatting.",
					format: "plain",
				});
			}
			return;
		}

		// 2. Route resolution (resolve identity links first)
		const resolvedPeerId = resolveIdentity(config, msg.channel, msg.senderId);
		const route = resolveRoute(config, {
			channel: msg.channel,
			accountId: msg.accountId,
			peerId: resolvedPeerId,
			peerName: msg.senderName,
			guildId: msg.peer.guildId,
			groupId: msg.peer.kind === "group" ? msg.peer.id : undefined,
			threadId: msg.peer.threadId ?? msg.threadId,
			roles: msg.memberRoleIds,
		});

		// 2.5. Notify heartbeat runner of activity
		this.onAgentActivity?.(route.agentId, msg.channel);

		// 3. Run agent
		if (!this.agentRunner) {
			console.warn("[channel] No agent runner configured");
			return;
		}

		const isOwner = isOwnerSender(msg, config);

		// Extract image URLs from attachments
		const imageUrls = msg.attachments
			.filter((a) => a.type === "image" && a.url)
			.map((a) => a.url as string);

		// Transcribe audio attachments via STT if configured
		let messageText = msg.text;
		const stt = this.sttService;
		if (stt && config) {
			const audioAttachments = msg.attachments.filter(
				(a) => (a.type === "audio" || a.type === "voice") && a.url,
			);
			if (audioAttachments.length > 0 && stt.isAvailable(config)) {
				try {
					const transcripts = await Promise.all(
						audioAttachments.map((a) => stt.transcribe(a.url as string, config)),
					);
					const transcribedText = transcripts.filter(Boolean).join("\n");
					if (transcribedText) {
						messageText = [messageText, transcribedText].filter(Boolean).join("\n");
					}
				} catch (err) {
					console.warn("[channel] STT transcription failed:", err);
				}
			}
		}

		try {
			const events = this.agentRunner({
				agentId: route.agentId,
				sessionKey: route.sessionKey,
				message: messageText,
				config,
				isOwner,
				channelId: msg.channel,
				imageUrls: imageUrls.length > 0 ? imageUrls : undefined,
				preference: route.binding?.preference,
			});

			// 4. Collect response and send reply
			const caps = CHANNEL_DOCK[msg.channel] ?? CHANNEL_DOCK.webchat;
			let buffer = "";

			for await (const event of events) {
				if (event.type === "delta" && event.text) {
					buffer += event.text;
				} else if (event.type === "error" && event.message) {
					buffer += `\n\n[Error: ${event.message}]`;
				}
			}

			// Send reply in chunks
			if (buffer.trim()) {
				const adapter = this.findAdapter(msg.channel, msg.accountId);
				if (adapter) {
					const chunks = chunkText(buffer, caps.maxTextLength);
					for (const chunk of chunks) {
						await adapter.send(msg.peer, {
							text: chunk,
							format: caps.supportsMarkdown ? "markdown" : "plain",
							replyTo: msg.peer.kind === "group" ? undefined : msg.replyTo,
							threadId: msg.threadId,
						});
					}
				}
			}
		} catch (err) {
			console.error("[channel] Agent execution error:", err);
		}
	}

	private findAdapter(channel: string, accountId: string): ChannelAdapter | undefined {
		// Try exact key first: "telegram:bot_prod"
		const exact = this.adapters.get(`${channel}:${accountId}`);
		if (exact) return exact;

		// Fallback: find first adapter of this channel type
		for (const adapter of this.adapters.values()) {
			if (adapter.type === channel) return adapter;
		}
		return undefined;
	}

	// Config getter, set by gateway
	getConfig?: () => Config;
}

/** Split text into chunks respecting the max length. */
function chunkText(text: string, maxLength: number): string[] {
	if (text.length <= maxLength) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= maxLength) {
			chunks.push(remaining);
			break;
		}

		// Try to break at newline
		let breakIdx = remaining.lastIndexOf("\n", maxLength);
		if (breakIdx < maxLength * 0.5) {
			// No good newline break, try space
			breakIdx = remaining.lastIndexOf(" ", maxLength);
		}
		if (breakIdx < maxLength * 0.3) {
			// No good break point, hard break
			breakIdx = maxLength;
		}

		chunks.push(remaining.slice(0, breakIdx));
		remaining = remaining.slice(breakIdx).trimStart();
	}

	return chunks;
}
