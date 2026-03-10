/** Chat context types. */
export type ChatType = "direct" | "group" | "channel" | "thread";

/** Channel connection status. */
export type ChannelStatus = "connected" | "disconnected" | "connecting" | "error";

/** Declares what a channel supports. */
export interface ChannelCapabilities {
	chatTypes: ChatType[];
	supportsMedia: boolean;
	supportsThread: boolean;
	supportsMarkdown: boolean;
	supportsEdit: boolean;
	supportsReaction: boolean;
	blockStreaming: boolean;
	maxTextLength: number;
}

/** Identifies a conversation peer (user, group, thread). */
export interface Peer {
	kind: ChatType;
	id: string;
	name?: string;
	threadId?: string;
	guildId?: string;
	teamId?: string;
}

/** Normalized inbound message from any channel. */
export interface InboundMessage {
	channel: string;
	accountId: string;
	senderId: string;
	senderName: string;
	peer: Peer;
	text: string;
	attachments: Attachment[];
	replyTo?: string;
	threadId?: string;
	memberRoleIds?: string[];
	raw: unknown;
}

/** Outbound message to send via a channel. */
export interface OutboundMessage {
	text: string;
	attachments?: Attachment[];
	replyTo?: string;
	threadId?: string;
	format?: "markdown" | "plain";
}

/** Media attachment. */
export interface Attachment {
	type: "image" | "audio" | "video" | "file";
	url?: string;
	path?: string;
	filename?: string;
	mimeType?: string;
	size?: number;
}

/** Handler for inbound messages. */
export type InboundHandler = (msg: InboundMessage) => void | Promise<void>;

/** Unsubscribe function. */
export type Unsubscribe = () => void;

/** Channel adapter interface — each platform implements this. */
export interface ChannelAdapter {
	readonly id: string;
	readonly type: string;
	readonly capabilities: ChannelCapabilities;
	status: ChannelStatus;

	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(peer: Peer, content: OutboundMessage): Promise<string | null>;
	onMessage(handler: InboundHandler): Unsubscribe;
}
