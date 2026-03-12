import * as lark from "@larksuiteoapi/node-sdk";
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

export interface FeishuAdapterConfig {
	accountId: string;
	appId: string;
	appSecret: string;
}

const FEISHU_CAPABILITIES: ChannelCapabilities = {
	chatTypes: ["direct", "group"],
	supportsMedia: true,
	supportsThread: false,
	supportsMarkdown: true,
	supportsEdit: true,
	supportsReaction: true,
	blockStreaming: false,
	maxTextLength: 4000,
};

export class FeishuAdapter implements ChannelAdapter {
	readonly id: string;
	readonly type = "feishu";
	readonly capabilities: ChannelCapabilities = FEISHU_CAPABILITIES;
	status: ChannelStatus = "disconnected";

	private larkClient: lark.Client;
	private wsClient?: lark.WSClient;
	private handlers: Set<InboundHandler> = new Set();
	private config: FeishuAdapterConfig;

	constructor(config: FeishuAdapterConfig) {
		this.id = config.accountId;
		this.config = config;
		this.larkClient = new lark.Client({
			appId: config.appId,
			appSecret: config.appSecret,
			appType: lark.AppType.SelfBuild,
		});
	}

	async connect(): Promise<void> {
		this.status = "connecting";

		try {
			this.wsClient = new lark.WSClient({
				appId: this.config.appId,
				appSecret: this.config.appSecret,
				loggerLevel: lark.LoggerLevel.WARN,
			});

			this.wsClient.on(
				"im.message.receive_v1" as lark.EventType,
				async (data: {
					message: {
						message_id: string;
						chat_id: string;
						chat_type: string;
						content: string;
						message_type: string;
						mentions?: Array<{ id: { open_id: string }; name: string }>;
					};
					sender: {
						sender_id: { open_id: string };
						sender_type: string;
					};
				}) => {
					await this.handleMessage(data);
				},
			);

			await this.wsClient.start();
			this.status = "connected";
			console.log(`[feishu] Adapter ${this.id} connected via WebSocket`);
		} catch (err) {
			this.status = "error";
			console.error(`[feishu] Adapter ${this.id} connection failed:`, err);
			throw err;
		}
	}

	async disconnect(): Promise<void> {
		this.status = "disconnected";
		// WSClient doesn't have an explicit stop; cleanup handled by GC
		this.wsClient = undefined;
	}

	async send(peer: Peer, content: OutboundMessage): Promise<string | null> {
		const receiveIdType = peer.kind === "direct" ? "open_id" : "chat_id";

		// Convert markdown to Feishu rich text if needed
		let msgType: string;
		let msgContent: string;

		if (
			content.format === "markdown" ||
			content.text.includes("**") ||
			content.text.includes("```")
		) {
			// Use Feishu interactive card for markdown content
			msgType = "interactive";
			msgContent = JSON.stringify({
				elements: [
					{
						tag: "markdown",
						content: content.text,
					},
				],
			});
		} else {
			msgType = "text";
			msgContent = JSON.stringify({ text: content.text });
		}

		try {
			const resp = await this.larkClient.im.message.create({
				params: { receive_id_type: receiveIdType },
				data: {
					receive_id: peer.id,
					msg_type: msgType,
					content: msgContent,
				},
			});

			return resp?.data?.message_id ?? null;
		} catch (err) {
			console.error(`[feishu] Failed to send message:`, err);
			return null;
		}
	}

	onMessage(handler: InboundHandler): Unsubscribe {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	private async handleMessage(data: {
		message: {
			message_id: string;
			chat_id: string;
			chat_type: string;
			content: string;
			message_type: string;
			mentions?: Array<{ id: { open_id: string }; name: string }>;
		};
		sender: {
			sender_id: { open_id: string };
			sender_type: string;
		};
	}): Promise<void> {
		const { message, sender } = data;

		// Skip bot's own messages
		if (sender.sender_type === "app") return;

		// Parse message content
		let text = "";
		const attachments: Attachment[] = [];

		try {
			const parsed = JSON.parse(message.content);
			if (message.message_type === "text") {
				text = parsed.text ?? "";
			} else if (message.message_type === "image") {
				attachments.push({
					type: "image",
					filename: "image.png",
				});
				text = "(image)";
			} else if (message.message_type === "file") {
				attachments.push({
					type: "file",
					filename: parsed.file_name ?? "file",
				});
				text = `(file: ${parsed.file_name ?? "unknown"})`;
			} else {
				text = `[unsupported message type: ${message.message_type}]`;
			}
		} catch {
			text = message.content;
		}

		// Remove @mention from text for group messages
		if (message.mentions) {
			for (const mention of message.mentions) {
				text = text.replace(`@${mention.name}`, "").trim();
			}
		}

		if (!text && attachments.length === 0) return;

		const peer: Peer = {
			kind: message.chat_type === "p2p" ? "direct" : "group",
			id: message.chat_type === "p2p" ? sender.sender_id.open_id : message.chat_id,
		};

		const inbound: InboundMessage = {
			channel: "feishu",
			accountId: this.id,
			senderId: sender.sender_id.open_id,
			senderName: sender.sender_id.open_id,
			peer,
			text,
			attachments,
			replyTo: undefined,
			raw: data,
		};

		for (const handler of this.handlers) {
			try {
				await handler(inbound);
			} catch (err) {
				console.error("[feishu] Message handler error:", err);
			}
		}
	}
}

// Register Feishu capabilities in dock
CHANNEL_DOCK.feishu = FEISHU_CAPABILITIES;

// Self-registration
channelRegistry.register({
	type: "feishu",
	capabilities: FEISHU_CAPABILITIES,
	requiredFields: ["appId", "appSecret"],
	create: (account) => {
		if (!account.appId || !account.appSecret) return null;
		return new FeishuAdapter({
			accountId: account.id,
			appId: account.appId,
			appSecret: account.appSecret,
		});
	},
});
