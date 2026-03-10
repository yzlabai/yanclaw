import type { ChannelCapabilities } from "./types";

/** Static capability declarations for each channel type. */
export const CHANNEL_DOCK: Record<string, ChannelCapabilities> = {
	telegram: {
		chatTypes: ["direct", "group", "channel"],
		supportsMedia: true,
		supportsThread: true,
		supportsMarkdown: true,
		supportsEdit: true,
		supportsReaction: true,
		blockStreaming: false,
		maxTextLength: 4000,
	},
	discord: {
		chatTypes: ["direct", "group", "thread"],
		supportsMedia: true,
		supportsThread: true,
		supportsMarkdown: true,
		supportsEdit: true,
		supportsReaction: true,
		blockStreaming: false,
		maxTextLength: 2000,
	},
	slack: {
		chatTypes: ["direct", "group", "thread"],
		supportsMedia: true,
		supportsThread: true,
		supportsMarkdown: true,
		supportsEdit: true,
		supportsReaction: true,
		blockStreaming: false,
		maxTextLength: 4000,
	},
	webchat: {
		chatTypes: ["direct"],
		supportsMedia: true,
		supportsThread: false,
		supportsMarkdown: true,
		supportsEdit: false,
		supportsReaction: false,
		blockStreaming: false,
		maxTextLength: Number.MAX_SAFE_INTEGER,
	},
};
