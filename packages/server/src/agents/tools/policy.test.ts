import { describe, expect, it } from "vitest";
import type { ToolsConfig } from "../../config/schema";
import { isOwnerOnlyTool, isToolAllowed } from "./index";

function makeToolsConfig(overrides: Partial<ToolsConfig> = {}): ToolsConfig {
	return {
		policy: { default: "allow" as const, ...overrides.policy },
		exec: {
			ask: "on-miss" as const,
			safeBins: [],
			timeout: 30000,
			maxOutput: 10240,
			sandbox: {
				enabled: false,
				image: "ubuntu:22.04",
				memoryLimit: "256m",
				cpuLimit: "0.5",
				network: "none",
				readOnlyWorkspace: false,
			},
			...overrides.exec,
		},
		byChannel: overrides.byChannel ?? {},
	};
}

describe("isOwnerOnlyTool", () => {
	it("marks shell as owner-only", () => {
		expect(isOwnerOnlyTool("shell")).toBe(true);
	});

	it("marks file_write as owner-only", () => {
		expect(isOwnerOnlyTool("file_write")).toBe(true);
	});

	it("does not mark file_read as owner-only", () => {
		expect(isOwnerOnlyTool("file_read")).toBe(false);
	});

	it("does not mark web_search as owner-only", () => {
		expect(isOwnerOnlyTool("web_search")).toBe(false);
	});
});

describe("isToolAllowed", () => {
	it("allows all tools when default is allow", () => {
		const config = makeToolsConfig();
		expect(isToolAllowed("shell", config)).toBe(true);
		expect(isToolAllowed("file_read", config)).toBe(true);
	});

	it("denies all tools when default is deny", () => {
		const config = makeToolsConfig({ policy: { default: "deny" } });
		expect(isToolAllowed("shell", config)).toBe(false);
	});

	it("global deny overrides default allow", () => {
		const config = makeToolsConfig({
			policy: { default: "allow", deny: ["shell"] },
		});
		expect(isToolAllowed("shell", config)).toBe(false);
		expect(isToolAllowed("file_read", config)).toBe(true);
	});

	it("global allow list restricts to listed tools", () => {
		const config = makeToolsConfig({
			policy: { default: "deny", allow: ["file_read", "web_search"] },
		});
		expect(isToolAllowed("file_read", config)).toBe(true);
		expect(isToolAllowed("shell", config)).toBe(false);
	});

	it("agent deny overrides global allow", () => {
		const config = makeToolsConfig();
		const agentTools = { deny: ["shell"] };
		expect(isToolAllowed("shell", config, agentTools)).toBe(false);
		expect(isToolAllowed("file_read", config, agentTools)).toBe(true);
	});

	it("agent allow restricts to listed tools", () => {
		const config = makeToolsConfig();
		const agentTools = { allow: ["file_read"] };
		expect(isToolAllowed("file_read", config, agentTools)).toBe(true);
		expect(isToolAllowed("shell", config, agentTools)).toBe(false);
	});

	it("channel deny takes highest priority", () => {
		const config = makeToolsConfig({
			byChannel: { telegram: { deny: ["web_search"] } },
		});
		expect(isToolAllowed("web_search", config, undefined, "telegram")).toBe(false);
		expect(isToolAllowed("web_search", config, undefined, "discord")).toBe(true);
	});

	it("channel allow restricts to listed tools", () => {
		const config = makeToolsConfig({
			byChannel: { telegram: { allow: ["file_read"] } },
		});
		expect(isToolAllowed("file_read", config, undefined, "telegram")).toBe(true);
		expect(isToolAllowed("shell", config, undefined, "telegram")).toBe(false);
	});

	it("expands group:exec to shell", () => {
		const config = makeToolsConfig({
			policy: { default: "allow", deny: ["group:exec"] },
		});
		expect(isToolAllowed("shell", config)).toBe(false);
		expect(isToolAllowed("file_read", config)).toBe(true);
	});

	it("expands group:file to file_read/write/edit", () => {
		const config = makeToolsConfig({
			policy: { default: "deny", allow: ["group:file"] },
		});
		expect(isToolAllowed("file_read", config)).toBe(true);
		expect(isToolAllowed("file_write", config)).toBe(true);
		expect(isToolAllowed("file_edit", config)).toBe(true);
		expect(isToolAllowed("shell", config)).toBe(false);
	});
});
