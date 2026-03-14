import { Client, Events, GatewayIntentBits, type Message } from "discord.js";
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

export interface DiscordAdapterConfig {
	accountId: string;
	token: string;
}

export class DiscordAdapter implements ChannelAdapter {
	readonly id: string;
	readonly type = "discord";
	readonly capabilities: ChannelCapabilities = CHANNEL_DOCK.discord;
	status: ChannelStatus = "disconnected";

	private client: Client;
	private handlers: Set<InboundHandler> = new Set();

	constructor(private config: DiscordAdapterConfig) {
		this.id = config.accountId;
		this.client = new Client({
			intents: [
				GatewayIntentBits.Guilds,
				GatewayIntentBits.GuildMessages,
				GatewayIntentBits.DirectMessages,
				GatewayIntentBits.MessageContent,
			],
		});
		this.setupHandlers();
	}

	private setupHandlers(): void {
		this.client.on(Events.MessageCreate, async (message: Message) => {
			// Ignore bot messages
			if (message.author.bot) return;

			const isDm = !message.guild;
			const botUser = this.client.user;

			// In guilds, only respond to @mentions
			if (!isDm && botUser) {
				if (!message.mentions.has(botUser)) return;
			}

			// Strip bot mention from text
			let text = message.content;
			if (botUser) {
				text = text.replace(new RegExp(`<@!?${botUser.id}>`, "g"), "").trim();
			}

			// Determine peer
			let peer: Peer;
			if (isDm) {
				peer = {
					kind: "direct",
					id: message.channel.id,
					name: message.author.displayName ?? message.author.username,
				};
			} else {
				const channel = message.channel;
				const isThread = channel.isThread();
				peer = {
					kind: isThread ? "thread" : "group",
					id: message.channel.id,
					name: "name" in channel ? (channel.name ?? message.channel.id) : message.channel.id,
					threadId: isThread ? message.channel.id : undefined,
					guildId: message.guild?.id,
				};
			}

			// Extract attachments
			const attachments: Attachment[] = message.attachments.map((att) => {
				const isImage = att.contentType?.startsWith("image/") ?? false;
				return {
					type: isImage ? "image" : "file",
					url: att.url,
					filename: att.name ?? "file",
					mimeType: att.contentType ?? "application/octet-stream",
					size: att.size,
				};
			});

			// Get member role IDs (guild only)
			const memberRoleIds = message.member?.roles.cache.map((r) => r.id);

			const inbound: InboundMessage = {
				channel: "discord",
				accountId: this.id,
				senderId: message.author.id,
				senderName:
					message.member?.displayName ?? message.author.displayName ?? message.author.username,
				peer,
				text,
				attachments,
				threadId: message.channel.isThread() ? message.channel.id : undefined,
				memberRoleIds,
				raw: message,
			};

			for (const handler of this.handlers) {
				try {
					await handler(inbound);
				} catch (err) {
					console.error("[discord] Handler error:", err);
				}
			}
		});
	}

	async connect(): Promise<void> {
		this.status = "connecting";
		try {
			await this.client.login(this.config.token);
			await new Promise<void>((resolve) => {
				if (this.client.isReady()) {
					resolve();
				} else {
					this.client.once(Events.ClientReady, () => resolve());
				}
			});
			console.log(`[discord] Bot connected as ${this.client.user?.tag} (${this.id})`);
			this.status = "connected";
		} catch (err) {
			this.status = "error";
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		try {
			await this.client.destroy();
		} catch {
			// Ignore destroy errors
		}
		this.status = "disconnected";
	}

	async send(peer: Peer, content: OutboundMessage): Promise<string | null> {
		try {
			const channel = await this.client.channels.fetch(peer.id);
			if (!channel || !("send" in channel)) return null;

			// Split long messages (Discord 2000 char limit)
			const maxLen = this.capabilities.maxTextLength;
			const text = content.text;

			if (text.length <= maxLen) {
				const result = await channel.send({ content: text });
				return result.id;
			}

			// Split at newlines when possible
			let lastId: string | null = null;
			let remaining = text;
			while (remaining.length > 0) {
				let chunk: string;
				if (remaining.length <= maxLen) {
					chunk = remaining;
					remaining = "";
				} else {
					const splitIdx = remaining.lastIndexOf("\n", maxLen);
					if (splitIdx > maxLen / 2) {
						chunk = remaining.slice(0, splitIdx);
						remaining = remaining.slice(splitIdx + 1);
					} else {
						chunk = remaining.slice(0, maxLen);
						remaining = remaining.slice(maxLen);
					}
				}
				const result = await channel.send({ content: chunk });
				lastId = result.id;
			}

			return lastId;
		} catch (err) {
			console.error("[discord] Send error:", err);
			return null;
		}
	}

	async sendTyping(peer: Peer): Promise<void> {
		try {
			const channel = await this.client.channels.fetch(peer.id);
			if (channel?.isTextBased() && "sendTyping" in channel) {
				await (channel as { sendTyping(): Promise<void> }).sendTyping();
			}
		} catch {
			// Ignore typing errors — non-critical
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
	type: "discord",
	capabilities: CHANNEL_DOCK.discord,
	requiredFields: ["token"],
	create: (account) => {
		if (!account.token) return null;
		return new DiscordAdapter({ accountId: account.id, token: account.token });
	},
});
