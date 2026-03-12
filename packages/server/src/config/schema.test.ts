import { describe, expect, it } from "vitest";
import { configSchema } from "./schema";

describe("configSchema", () => {
	it("parses empty config with all defaults", () => {
		const result = configSchema.parse({});
		expect(result.gateway.port).toBe(18789);
		expect(result.gateway.bind).toBe("loopback");
		expect(result.agents).toHaveLength(1);
		expect(result.agents[0].id).toBe("main");
		expect(result.tools.policy.default).toBe("allow");
		expect(result.tools.exec.timeout).toBe(30000);
		expect(result.tools.exec.sandbox.enabled).toBe(false);
		expect(result.session.contextBudget).toBe(100000);
		expect(result.session.pruneAfterDays).toBe(90);
		expect(result.memory.enabled).toBe(false);
	});

	it("validates agent schema", () => {
		const result = configSchema.parse({
			agents: [
				{
					id: "test",
					name: "Test Agent",
					model: "claude-sonnet-4-20250514",
					systemPrompt: "You are a test assistant.",
				},
			],
		});
		expect(result.agents[0].id).toBe("test");
		expect(result.agents[0].name).toBe("Test Agent");
	});

	it("validates sandbox config", () => {
		const result = configSchema.parse({
			tools: {
				exec: {
					sandbox: {
						enabled: true,
						image: "node:20",
						memoryLimit: "512m",
					},
				},
			},
		});
		expect(result.tools.exec.sandbox.enabled).toBe(true);
		expect(result.tools.exec.sandbox.image).toBe("node:20");
		expect(result.tools.exec.sandbox.cpuLimit).toBe("0.5"); // default
	});

	it("validates cron task with mode", () => {
		const result = configSchema.parse({
			cron: {
				tasks: [
					{
						id: "test-interval",
						schedule: "5m",
						mode: "interval",
						prompt: "check status",
					},
				],
			},
		});
		expect(result.cron.tasks[0].mode).toBe("interval");
	});

	it("validates memory config with indexDirs", () => {
		const result = configSchema.parse({
			memory: {
				enabled: true,
				indexDirs: ["/data/docs", "/data/notes"],
			},
		});
		expect(result.memory.enabled).toBe(true);
		expect(result.memory.indexDirs).toEqual(["/data/docs", "/data/notes"]);
	});

	it("rejects invalid bind value", () => {
		expect(() =>
			configSchema.parse({
				gateway: { bind: "invalid" },
			}),
		).toThrow();
	});

	it("validates routing bindings", () => {
		const result = configSchema.parse({
			routing: {
				bindings: [
					{
						channel: "telegram",
						peer: "user_123",
						agent: "vip-agent",
						dmScope: "per-peer",
					},
				],
			},
		});
		expect(result.routing.bindings[0].agent).toBe("vip-agent");
		expect(result.routing.bindings[0].dmScope).toBe("per-peer");
	});

	it("validates channel config (array format)", () => {
		const result = configSchema.parse({
			channels: [
				{
					type: "telegram",
					enabled: true,
					accounts: [
						{
							id: "bot1",
							token: "abc",
							dmPolicy: "allowlist",
							allowFrom: ["user_1"],
						},
					],
				},
			],
		});
		expect(result.channels[0].type).toBe("telegram");
		expect(result.channels[0].enabled).toBe(true);
		expect(result.channels[0].accounts[0].dmPolicy).toBe("allowlist");
	});
});
