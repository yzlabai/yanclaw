import { Bot } from "grammy";
import { log } from "../logger";
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

export interface TelegramAdapterConfig {
	accountId: string;
	token: string;
}

export class TelegramAdapter implements ChannelAdapter {
	readonly id: string;
	readonly type = "telegram";
	readonly capabilities: ChannelCapabilities = CHANNEL_DOCK.telegram;
	status: ChannelStatus = "disconnected";

	private bot: Bot;
	private handlers: Set<InboundHandler> = new Set();

	constructor(private config: TelegramAdapterConfig) {
		this.id = config.accountId;
		this.bot = new Bot(config.token);
		this.setupHandlers();
	}

	private setupHandlers(): void {
		// Handle text messages, photos, documents, audio, video, voice
		this.bot.on("message", async (ctx) => {
			const msg = ctx.message;
			const chat = msg.chat;

			// Skip non-content messages (service messages, etc.)
			if (
				!msg.text &&
				!msg.caption &&
				!msg.photo &&
				!msg.document &&
				!msg.audio &&
				!msg.video &&
				!msg.voice
			) {
				return;
			}

			// Determine peer kind
			let peer: Peer;
			if (chat.type === "private") {
				peer = {
					kind: "direct",
					id: String(chat.id),
					name: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
				};
			} else {
				peer = {
					kind: "group",
					id: String(chat.id),
					name: chat.title ?? `Group ${chat.id}`,
					threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
				};

				// In groups, only respond to @mentions or replies to the bot
				const botInfo = this.bot.botInfo;
				const textContent = msg.text ?? msg.caption ?? "";
				const mentionsBot =
					textContent.includes(`@${botInfo.username}`) ||
					msg.reply_to_message?.from?.id === botInfo.id;

				if (!mentionsBot) return;
			}

			// Extract text (from text or caption)
			let text = msg.text ?? msg.caption ?? "";
			const botUsername = this.bot.botInfo.username;
			if (botUsername) {
				text = text.replace(new RegExp(`@${botUsername}\\b`, "g"), "").trim();
			}

			// Extract attachments
			const attachments = await this.extractAttachments(msg);

			const inbound: InboundMessage = {
				channel: "telegram",
				accountId: this.id,
				senderId: String(msg.from.id),
				senderName:
					msg.from.username ?? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" "),
				peer,
				text,
				attachments,
				replyTo: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
				threadId: msg.message_thread_id ? String(msg.message_thread_id) : undefined,
				raw: ctx,
			};

			for (const handler of this.handlers) {
				try {
					await handler(inbound);
				} catch (err) {
					log.channel().error({ err, accountId: this.id }, "handler error");
				}
			}
		});

		this.bot.catch((err) => {
			log.channel().error({ err, accountId: this.id }, "bot error");
			this.status = "error";
		});
	}

	private async extractAttachments(msg: {
		photo?: Array<{ file_id: string; file_size?: number; width: number; height: number }>;
		document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
		audio?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
		video?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
		voice?: { file_id: string; mime_type?: string; file_size?: number };
	}): Promise<Attachment[]> {
		const attachments: Attachment[] = [];

		try {
			// Photo: pick the largest size
			if (msg.photo && msg.photo.length > 0) {
				const largest = msg.photo[msg.photo.length - 1];
				const file = await this.bot.api.getFile(largest.file_id);
				const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
				attachments.push({
					type: "image",
					url,
					filename: `photo_${largest.file_id}.jpg`,
					mimeType: "image/jpeg",
					size: largest.file_size,
				});
			}

			// Document
			if (msg.document) {
				const file = await this.bot.api.getFile(msg.document.file_id);
				const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
				const isImage = msg.document.mime_type?.startsWith("image/");
				attachments.push({
					type: isImage ? "image" : "file",
					url,
					filename: msg.document.file_name ?? "document",
					mimeType: msg.document.mime_type ?? "application/octet-stream",
					size: msg.document.file_size,
				});
			}

			// Audio
			if (msg.audio) {
				const file = await this.bot.api.getFile(msg.audio.file_id);
				const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
				attachments.push({
					type: "audio",
					url,
					filename: msg.audio.file_name ?? "audio.mp3",
					mimeType: msg.audio.mime_type ?? "audio/mpeg",
					size: msg.audio.file_size,
				});
			}

			// Video
			if (msg.video) {
				const file = await this.bot.api.getFile(msg.video.file_id);
				const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
				attachments.push({
					type: "video",
					url,
					filename: msg.video.file_name ?? "video.mp4",
					mimeType: msg.video.mime_type ?? "video/mp4",
					size: msg.video.file_size,
				});
			}

			// Voice
			if (msg.voice) {
				const file = await this.bot.api.getFile(msg.voice.file_id);
				const url = `https://api.telegram.org/file/bot${this.config.token}/${file.file_path}`;
				attachments.push({
					type: "audio",
					url,
					filename: "voice.ogg",
					mimeType: msg.voice.mime_type ?? "audio/ogg",
					size: msg.voice.file_size,
				});
			}
		} catch (err) {
			log.channel().error({ err, accountId: this.id }, "failed to extract attachments");
		}

		return attachments;
	}

	async connect(): Promise<void> {
		this.status = "connecting";
		try {
			await this.bot.init();
			log
				.channel()
				.info({ accountId: this.id, username: this.bot.botInfo.username }, "bot connected");
			this.status = "connected";

			// Start polling in background (non-blocking)
			this.bot.start({
				onStart: () => {
					this.status = "connected";
				},
			});
		} catch (err) {
			this.status = "error";
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		try {
			await this.bot.stop();
		} catch {
			// Ignore stop errors
		}
		this.status = "disconnected";
	}

	async send(peer: Peer, content: OutboundMessage): Promise<string | null> {
		const chatId = Number(peer.id);

		try {
			const opts: Record<string, unknown> = {};

			if (content.format === "markdown") {
				opts.parse_mode = "Markdown";
			}

			if (content.threadId) {
				opts.message_thread_id = Number(content.threadId);
			}

			if (content.replyTo) {
				opts.reply_to_message_id = Number(content.replyTo);
			}

			const result = await this.bot.api.sendMessage(chatId, content.text, opts);
			return String(result.message_id);
		} catch (err) {
			log.channel().error({ err, accountId: this.id, peer: peer.id }, "send error");
			return null;
		}
	}

	async editMessage(messageId: string, peer: Peer, content: OutboundMessage): Promise<boolean> {
		try {
			const opts: Record<string, unknown> = {};
			if (content.format === "markdown") {
				opts.parse_mode = "Markdown";
			}
			await this.bot.api.editMessageText(Number(peer.id), Number(messageId), content.text, opts);
			return true;
		} catch (err) {
			log.channel().error({ err, accountId: this.id, messageId, peer: peer.id }, "edit error");
			return false;
		}
	}

	async sendTyping(peer: Peer): Promise<void> {
		await this.bot.api.sendChatAction(Number(peer.id), "typing");
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
	type: "telegram",
	capabilities: CHANNEL_DOCK.telegram,
	requiredFields: ["token"],
	create: (account) => {
		if (!account.token) return null;
		return new TelegramAdapter({ accountId: account.id, token: account.token });
	},
});
