import { App } from "@slack/bolt";
import { CHANNEL_DOCK } from "./dock";
import { channelRegistry } from "./registry";
import type {
	Attachment,
	ChannelAdapter,
	ChannelCapabilities,
	ChannelStatus,
	InboundHandler,
	InboundMessage,
	OutboundMessage,
	Peer,
	Unsubscribe,
} from "./types";

export interface SlackAdapterConfig {
	accountId: string;
	botToken: string;
	appToken: string;
}

export class SlackAdapter implements ChannelAdapter {
	readonly id: string;
	readonly type = "slack";
	readonly capabilities: ChannelCapabilities = CHANNEL_DOCK.slack;
	status: ChannelStatus = "disconnected";

	private app: App;
	private handlers: Set<InboundHandler> = new Set();
	private botUserId: string | null = null;

	constructor(config: SlackAdapterConfig) {
		this.id = config.accountId;
		this.app = new App({
			token: config.botToken,
			appToken: config.appToken,
			socketMode: true,
		});
		this.setupHandlers();
	}

	private setupHandlers(): void {
		// Handle direct messages and @mentions
		this.app.event("message", async ({ event, client }) => {
			// Skip bot messages, message_changed, etc.
			if ("subtype" in event && event.subtype) return;
			if (!("text" in event)) return;

			const text = event.text ?? "";
			const userId = "user" in event ? event.user : undefined;
			if (!userId) return;

			// Determine if this is a DM or channel message
			const channelId = event.channel;
			const threadTs = "thread_ts" in event ? event.thread_ts : undefined;

			// Get channel info to determine type
			let peer: Peer;
			let isDm = false;

			try {
				const info = await client.conversations.info({ channel: channelId });
				if (info.channel?.is_im) {
					isDm = true;
					const userInfo = await client.users.info({ user: userId });
					peer = {
						kind: "direct",
						id: channelId,
						name: userInfo.user?.real_name ?? userInfo.user?.name ?? userId,
					};
				} else {
					peer = {
						kind: "group",
						id: channelId,
						name: info.channel?.name ?? channelId,
						threadId: threadTs,
						teamId: info.channel?.shared_team_ids?.[0],
					};
				}
			} catch {
				peer = {
					kind: "group",
					id: channelId,
					name: channelId,
					threadId: threadTs,
				};
			}

			// In channels, only respond to @mentions
			if (!isDm && this.botUserId) {
				if (!text.includes(`<@${this.botUserId}>`)) return;
			}

			// Strip bot mention from text
			let cleanText = text;
			if (this.botUserId) {
				cleanText = text.replace(new RegExp(`<@${this.botUserId}>`, "g"), "").trim();
			}

			// Extract file attachments
			const attachments: Attachment[] = [];
			if ("files" in event && Array.isArray(event.files)) {
				for (const file of event.files) {
					if (!file.url_private) continue;
					const isImage = file.mimetype?.startsWith("image/");
					attachments.push({
						type: isImage ? "image" : "file",
						url: file.url_private,
						filename: file.name ?? "file",
						mimeType: file.mimetype ?? "application/octet-stream",
						size: file.size,
					});
				}
			}

			// Get user info for sender name
			let senderName = userId;
			try {
				const userInfo = await client.users.info({ user: userId });
				senderName = userInfo.user?.real_name ?? userInfo.user?.name ?? userId;
			} catch {
				// Use userId as fallback
			}

			const inbound: InboundMessage = {
				channel: "slack",
				accountId: this.id,
				senderId: userId,
				senderName,
				peer,
				text: cleanText,
				attachments,
				threadId: threadTs,
				raw: event,
			};

			for (const handler of this.handlers) {
				try {
					await handler(inbound);
				} catch (err) {
					console.error("[slack] Handler error:", err);
				}
			}
		});
	}

	async connect(): Promise<void> {
		this.status = "connecting";
		try {
			await this.app.start();

			// Get bot user ID for mention detection
			const authResult = await this.app.client.auth.test();
			this.botUserId = authResult.user_id ?? null;

			console.log(`[slack] Bot connected as ${authResult.user} (${this.id})`);
			this.status = "connected";
		} catch (err) {
			this.status = "error";
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		try {
			await this.app.stop();
		} catch {
			// Ignore stop errors
		}
		this.status = "disconnected";
	}

	async send(peer: Peer, content: OutboundMessage): Promise<string | null> {
		try {
			const opts: Record<string, unknown> = {
				channel: peer.id,
				text: content.text,
			};

			// Reply in thread if threadId is provided
			if (content.threadId) {
				opts.thread_ts = content.threadId;
			}

			// Use mrkdwn formatting
			if (content.format === "markdown") {
				opts.mrkdwn = true;
			}

			const result = await this.app.client.chat.postMessage(
				opts as Parameters<typeof this.app.client.chat.postMessage>[0],
			);
			return result.ts ?? null;
		} catch (err) {
			console.error("[slack] Send error:", err);
			return null;
		}
	}

	onMessage(handler: InboundHandler): Unsubscribe {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}
}

// Self-registration
channelRegistry.register({
	type: "slack",
	capabilities: CHANNEL_DOCK.slack,
	requiredFields: ["botToken", "appToken"],
	create: (account) => {
		if (!account.botToken || !account.appToken) return null;
		return new SlackAdapter({
			accountId: account.id,
			botToken: account.botToken,
			appToken: account.appToken,
		});
	},
});
