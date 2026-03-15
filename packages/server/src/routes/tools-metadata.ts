import { Hono } from "hono";
import {
	CAPABILITY_PRESETS,
	OWNER_ONLY_TOOLS,
	TOOL_CAPABILITIES,
	TOOL_GROUPS,
} from "../agents/tools";

export const toolsMetadataRoute = new Hono().get("/metadata", (c) => {
	return c.json({
		groups: TOOL_GROUPS,
		presets: CAPABILITY_PRESETS,
		capabilities: TOOL_CAPABILITIES,
		ownerOnly: [...OWNER_ONLY_TOOLS],
		allTools: Object.keys(TOOL_CAPABILITIES),
	});
});
