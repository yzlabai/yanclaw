import { describe, expect, it } from "vitest";
import type { Config } from "../config/schema";
import { ModelManager } from "./model-manager";

function makeConfig(profiles: Array<{ id: string; apiKey: string }>): Config {
	return {
		models: {
			anthropic: { profiles },
			openai: { profiles },
			google: { profiles },
		},
	} as unknown as Config;
}

describe("ModelManager", () => {
	describe("resolveWithMeta", () => {
		it("selects anthropic for claude model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			const result = mgr.resolveWithMeta("claude-sonnet-4-20250514", config);
			expect(result.provider).toBe("anthropic");
			expect(result.profileId).toBe("default");
		});

		it("selects openai for gpt model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			const result = mgr.resolveWithMeta("gpt-4o", config);
			expect(result.provider).toBe("openai");
		});

		it("selects openai for o1/o3 model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			expect(mgr.resolveWithMeta("o1-mini", config).provider).toBe("openai");
			expect(mgr.resolveWithMeta("o3-mini", config).provider).toBe("openai");
		});

		it("selects google for gemini model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			const result = mgr.resolveWithMeta("gemini-2.0-flash", config);
			expect(result.provider).toBe("google");
		});

		it("throws when no profiles configured", () => {
			const mgr = new ModelManager();
			const config = {
				models: { anthropic: { profiles: [] } },
			} as unknown as Config;
			expect(() => mgr.resolveWithMeta("claude-sonnet-4-20250514", config)).toThrow(
				"Anthropic API key not configured",
			);
		});
	});

	describe("failover and cooldown", () => {
		it("reportSuccess resets failure count", () => {
			const mgr = new ModelManager({ maxFails: 2, cooldownMs: 60000 });
			mgr.reportFailure("anthropic", "p1");
			mgr.reportSuccess("anthropic", "p1");
			// Should not be in cooldown after success
			mgr.reportFailure("anthropic", "p1");
			// Only 1 failure again, not 2 — success reset it
		});

		it("skips profile in cooldown and uses next available", () => {
			const mgr = new ModelManager({ maxFails: 1, cooldownMs: 60000 });
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
			]);

			// Put p1 in cooldown
			mgr.reportFailure("anthropic", "p1");

			const result = mgr.resolveWithMeta("claude-sonnet-4-20250514", config);
			expect(result.profileId).toBe("p2");
		});

		it("falls back to first profile when all in cooldown", () => {
			const mgr = new ModelManager({ maxFails: 1, cooldownMs: 60000 });
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
			]);

			mgr.reportFailure("anthropic", "p1");
			mgr.reportFailure("anthropic", "p2");

			const result = mgr.resolveWithMeta("claude-sonnet-4-20250514", config);
			expect(result.profileId).toBe("p1");
		});

		it("recovers after cooldown expires", () => {
			const mgr = new ModelManager({ maxFails: 1, cooldownMs: 1 }); // 1ms cooldown
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
			]);

			mgr.reportFailure("anthropic", "p1");

			// Wait for cooldown to expire
			return new Promise<void>((resolve) => {
				setTimeout(() => {
					const result = mgr.resolveWithMeta("claude-sonnet-4-20250514", config);
					expect(result.profileId).toBe("p1"); // p1 recovered
					resolve();
				}, 10);
			});
		});

		it("does not enter cooldown until maxFails reached", () => {
			const mgr = new ModelManager({ maxFails: 3, cooldownMs: 60000 });
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
			]);

			// Report 3 consecutive failures (no resolve in between, which would reset state)
			mgr.reportFailure("anthropic", "p1");
			mgr.reportFailure("anthropic", "p1");
			mgr.reportFailure("anthropic", "p1");
			// 3 failures → now in cooldown → should skip to p2
			const result = mgr.resolveWithMeta("claude-sonnet-4-20250514", config);
			expect(result.profileId).toBe("p2");
		});
	});
});
