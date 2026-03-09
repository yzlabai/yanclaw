export interface Channel {
	id: string;
	type: "telegram" | "discord" | "slack" | "whatsapp" | "webchat";
	name: string;
	status: "connected" | "disconnected" | "error";
}

export interface Agent {
	id: string;
	name: string;
	model: string;
	systemPrompt?: string;
}

export interface Message {
	id: string;
	channelId: string;
	agentId: string;
	role: "user" | "assistant" | "system";
	content: string;
	createdAt: number;
}

export interface Session {
	id: string;
	agentId: string;
	channelId: string;
	peerId: string;
	messages: Message[];
	createdAt: number;
	updatedAt: number;
}
