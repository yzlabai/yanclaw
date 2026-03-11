import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM_PROMPT, configSchema } from "../config/schema";

describe("agent config — claude-code runtime", () => {
	it("defaults runtime to 'default'", () => {
		const config = configSchema.parse({
			agents: [{ id: "main", name: "Test" }],
		});
		expect(config.agents[0].runtime).toBe("default");
	});

	it("accepts runtime: 'claude-code' with claudeCode config", () => {
		const config = configSchema.parse({
			agents: [
				{
					id: "coder",
					name: "Coder",
					runtime: "claude-code",
					workspaceDir: "/tmp/test",
					claudeCode: {
						allowedTools: ["Read", "Bash"],
						permissionMode: "acceptEdits",
						maxTurns: 30,
					},
				},
			],
		});
		const agent = config.agents[0];
		expect(agent.runtime).toBe("claude-code");
		expect(agent.workspaceDir).toBe("/tmp/test");
		expect(agent.claudeCode?.allowedTools).toEqual(["Read", "Bash"]);
		expect(agent.claudeCode?.permissionMode).toBe("acceptEdits");
		expect(agent.claudeCode?.maxTurns).toBe(30);
	});

	it("applies claudeCode defaults", () => {
		const config = configSchema.parse({
			agents: [
				{
					id: "coder",
					name: "Coder",
					runtime: "claude-code",
					claudeCode: {},
				},
			],
		});
		const cc = config.agents[0].claudeCode!;
		expect(cc.allowedTools).toEqual(["Read", "Edit", "Write", "Bash", "Glob", "Grep"]);
		expect(cc.permissionMode).toBe("acceptEdits");
		expect(cc.maxTurns).toBe(50);
		expect(cc.mcpServers).toEqual({});
		expect(cc.agents).toEqual({});
	});

	it("accepts claudeCode.agents subagent definitions", () => {
		const config = configSchema.parse({
			agents: [
				{
					id: "coder",
					name: "Coder",
					runtime: "claude-code",
					claudeCode: {
						agents: {
							"code-reviewer": {
								description: "Reviews code quality",
								tools: ["Read", "Grep"],
							},
						},
					},
				},
			],
		});
		const agents = config.agents[0].claudeCode?.agents;
		expect(agents).toBeDefined();
		expect(agents?.["code-reviewer"]?.description).toBe("Reviews code quality");
	});

	it("rejects invalid runtime value", () => {
		expect(() =>
			configSchema.parse({
				agents: [{ id: "test", name: "Test", runtime: "invalid" }],
			}),
		).toThrow();
	});

	it("rejects invalid permissionMode", () => {
		expect(() =>
			configSchema.parse({
				agents: [
					{
						id: "test",
						name: "Test",
						runtime: "claude-code",
						claudeCode: { permissionMode: "invalid" },
					},
				],
			}),
		).toThrow();
	});
});

describe("DEFAULT_SYSTEM_PROMPT", () => {
	it("matches the schema default", () => {
		const config = configSchema.parse({ agents: [{ id: "main", name: "Test" }] });
		expect(config.agents[0].systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
	});
});
