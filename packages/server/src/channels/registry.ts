import { log } from "../logger";
import type { ChannelAdapter, ChannelCapabilities } from "./types";

/** Account configuration for creating an adapter. */
export interface ChannelAccountConfig {
	id: string;
	token?: string;
	botToken?: string;
	appToken?: string;
	appId?: string;
	appSecret?: string;
	[key: string]: unknown;
}

/** Channel type registration entry. */
export interface ChannelRegistration {
	type: string;
	capabilities: ChannelCapabilities;
	/** Create an adapter from account config; return null if config is incomplete. */
	create: (account: ChannelAccountConfig) => ChannelAdapter | null;
	/** Required fields for this type (used for UI validation). */
	requiredFields?: string[];
}

const FALLBACK_CAPABILITIES: ChannelCapabilities = {
	chatTypes: ["direct"],
	supportsMedia: false,
	supportsThread: false,
	supportsMarkdown: false,
	supportsEdit: false,
	supportsReaction: false,
	blockStreaming: false,
	maxTextLength: 4000,
};

class ChannelRegistry {
	private registrations = new Map<string, ChannelRegistration>();

	/** Register a channel type. */
	register(reg: ChannelRegistration): void {
		this.registrations.set(reg.type, reg);
	}

	/** Get all registered type names. */
	getTypes(): string[] {
		return [...this.registrations.keys()];
	}

	/** Get registration info for a type. */
	getRegistration(type: string): ChannelRegistration | undefined {
		return this.registrations.get(type);
	}

	/** Get capabilities for a channel type (replaces CHANNEL_DOCK). */
	getCapabilities(type: string): ChannelCapabilities {
		return this.registrations.get(type)?.capabilities ?? FALLBACK_CAPABILITIES;
	}

	/** Create an adapter instance. */
	create(type: string, account: ChannelAccountConfig): ChannelAdapter | null {
		const reg = this.registrations.get(type);
		if (!reg) {
			log.channel().warn({ channelType: type }, "unknown channel type");
			return null;
		}
		return reg.create(account);
	}
}

export const channelRegistry = new ChannelRegistry();
