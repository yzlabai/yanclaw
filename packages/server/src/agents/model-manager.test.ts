import { describe, expect, it } from "vitest";
import type { Config } from "../config/schema";
import { ModelManager } from "./model-manager";

/** Helper: build a Config with new providers format. */
function makeConfig(
	profiles: Array<{ id: string; apiKey: string }>,
	overrides?: Partial<Config>,
): Config {
	return {
		models: {
			providers: {
				anthropic: { type: "anthropic", profiles },
				openai: { type: "openai", profiles },
				google: { type: "google", profiles },
			},
		},
		systemModels: {},
		...overrides,
	} as unknown as Config;
}

/** Helper: build a Config with systemModels 2D matrix. */
function makeSystemConfig(
	systemModels: Record<string, unknown>,
	profiles: Array<{ id: string; apiKey: string }> = [{ id: "default", apiKey: "sk-test" }],
): Config {
	return {
		models: {
			providers: {
				anthropic: { type: "anthropic", profiles },
				openai: { type: "openai", profiles },
			},
		},
		systemModels,
	} as unknown as Config;
}

describe("ModelManager", () => {
	describe("resolveByIdWithMeta (legacy API)", () => {
		it("selects anthropic for claude model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			const result = mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config);
			expect(result.provider).toBe("anthropic");
			expect(result.profileId).toBe("default");
		});

		it("selects openai for gpt model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			const result = mgr.resolveByIdWithMeta("gpt-4o", config);
			expect(result.provider).toBe("openai");
		});

		it("selects openai for o1/o3/o4 model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			expect(mgr.resolveByIdWithMeta("o1-mini", config).provider).toBe("openai");
			expect(mgr.resolveByIdWithMeta("o3-mini", config).provider).toBe("openai");
			expect(mgr.resolveByIdWithMeta("o4-mini", config).provider).toBe("openai");
		});

		it("selects google for gemini model IDs", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			const result = mgr.resolveByIdWithMeta("gemini-2.0-flash", config);
			expect(result.provider).toBe("google");
		});

		it("ollama works without profiles", () => {
			const mgr = new ModelManager();
			const config = {
				models: {
					providers: {
						ollama: { type: "ollama", profiles: [], baseUrl: "http://localhost:11434/v1" },
					},
				},
				systemModels: {},
			} as unknown as Config;
			const result = mgr.resolveByIdWithMeta("llama3.3", config);
			expect(result.provider).toBe("ollama");
			expect(result.profileId).toBe("default");
		});

		it("throws when no profiles configured", () => {
			const mgr = new ModelManager();
			const config = {
				models: {
					providers: {
						anthropic: { type: "anthropic", profiles: [] },
					},
				},
				systemModels: {},
			} as unknown as Config;
			expect(() => mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config)).toThrow(
				'No auth profiles configured for provider "anthropic"',
			);
		});
	});

	describe("generic provider registration", () => {
		it("openai-compatible type uses custom baseUrl", () => {
			const mgr = new ModelManager();
			const config = {
				models: {
					providers: {
						deepseek: {
							type: "openai-compatible",
							baseUrl: "https://api.deepseek.com/v1",
							profiles: [{ id: "default", apiKey: "sk-ds-test" }],
						},
					},
				},
				systemModels: { chat: "deepseek-chat" },
			} as unknown as Config;
			// Single provider fallback: should resolve to deepseek
			const result = mgr.resolveByIdWithMeta("deepseek-chat", config);
			expect(result.provider).toBe("deepseek");
			expect(result.profileId).toBe("default");
		});

		it("model alias mapping resolves correctly", () => {
			const mgr = new ModelManager();
			const config = {
				models: {
					providers: {
						volcengine: {
							type: "openai-compatible",
							baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
							profiles: [{ id: "default", apiKey: "sk-vol-test" }],
							models: { "doubao-pro": "ep-20240101" },
						},
					},
				},
				systemModels: {},
			} as unknown as Config;
			const result = mgr.resolveByIdWithMeta("doubao-pro", config);
			expect(result.provider).toBe("volcengine");
		});

		it("unknown model ID with single provider uses that provider", () => {
			const mgr = new ModelManager();
			const config = {
				models: {
					providers: {
						custom: {
							type: "openai-compatible",
							profiles: [{ id: "default", apiKey: "sk-test" }],
						},
					},
				},
				systemModels: {},
			} as unknown as Config;
			const result = mgr.resolveByIdWithMeta("some-random-model", config);
			expect(result.provider).toBe("custom");
		});

		it("throws for unknown model ID with multiple providers", () => {
			const mgr = new ModelManager();
			const config = makeConfig([{ id: "default", apiKey: "sk-test" }]);
			expect(() => mgr.resolveByIdWithMeta("some-unknown-model", config)).toThrow(
				"Cannot determine provider",
			);
		});
	});

	describe("2D resolve (scene × preference)", () => {
		it("resolve(scene, preference) returns correct model", () => {
			const mgr = new ModelManager();
			const config = makeSystemConfig({
				chat: {
					default: "claude-sonnet-4-20250514",
					fast: "claude-haiku-4-5-20251001",
					quality: "claude-opus-4-20250514",
				},
			});
			const fast = mgr.resolveWithMeta("chat", "fast", config);
			expect(fast.provider).toBe("anthropic");

			const quality = mgr.resolveWithMeta("chat", "quality", config);
			expect(quality.provider).toBe("anthropic");
		});

		it("preference missing falls back to default", () => {
			const mgr = new ModelManager();
			const config = makeSystemConfig({
				chat: {
					default: "claude-sonnet-4-20250514",
					quality: "claude-opus-4-20250514",
				},
			});
			// "fast" not configured, should fall back to "default"
			const result = mgr.resolveWithMeta("chat", "fast", config);
			expect(result.provider).toBe("anthropic");
		});

		it("scene missing: vision falls back to chat", () => {
			const mgr = new ModelManager();
			const config = makeSystemConfig({
				chat: "claude-sonnet-4-20250514",
			});
			// No vision configured, should fall back to chat
			const result = mgr.resolveWithMeta("vision", "default", config);
			expect(result.provider).toBe("anthropic");
		});

		it("string shorthand works same as object with default", () => {
			const mgr = new ModelManager();
			const config = makeSystemConfig({ chat: "gpt-4o" });
			const result = mgr.resolveWithMeta("chat", "default", config);
			expect(result.provider).toBe("openai");
		});

		it("throws when scene not configured and no fallback", () => {
			const mgr = new ModelManager();
			const config = makeSystemConfig({});
			expect(() => mgr.resolveWithMeta("chat", "default", config)).toThrow(
				'No model configured for scene="chat"',
			);
		});
	});

	describe("round-robin", () => {
		it("distributes requests across multiple profiles", () => {
			const mgr = new ModelManager();
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
				{ id: "p3", apiKey: "key3" },
			]);

			const seen = new Set<string>();
			for (let i = 0; i < 6; i++) {
				const result = mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config);
				seen.add(result.profileId);
			}
			// All 3 profiles should have been used
			expect(seen.size).toBe(3);
		});

		it("skips cooled-down profiles in round-robin", () => {
			const mgr = new ModelManager({ maxFails: 1, cooldownMs: 60000 });
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
				{ id: "p3", apiKey: "key3" },
			]);

			mgr.reportFailure("anthropic", "p2");

			const seen = new Set<string>();
			for (let i = 0; i < 4; i++) {
				const result = mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config);
				seen.add(result.profileId);
			}
			expect(seen.has("p1")).toBe(true);
			expect(seen.has("p3")).toBe(true);
			expect(seen.has("p2")).toBe(false);
		});
	});

	describe("failover and cooldown", () => {
		it("reportSuccess resets failure count", () => {
			const mgr = new ModelManager({ maxFails: 2, cooldownMs: 60000 });
			mgr.reportFailure("anthropic", "p1");
			mgr.reportSuccess("anthropic", "p1");
			mgr.reportFailure("anthropic", "p1");
			// Only 1 failure again, not 2 — success reset it
		});

		it("skips profile in cooldown and uses next available", () => {
			const mgr = new ModelManager({ maxFails: 1, cooldownMs: 60000 });
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
			]);

			mgr.reportFailure("anthropic", "p1");

			const result = mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config);
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

			const result = mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config);
			expect(result.profileId).toBe("p1");
		});

		it("recovers after cooldown expires", () => {
			const mgr = new ModelManager({ maxFails: 1, cooldownMs: 1 });
			const config = makeConfig([
				{ id: "p1", apiKey: "key1" },
				{ id: "p2", apiKey: "key2" },
			]);

			mgr.reportFailure("anthropic", "p1");

			return new Promise<void>((resolve) => {
				setTimeout(() => {
					const result = mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config);
					expect(result.profileId).toBe("p1");
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

			mgr.reportFailure("anthropic", "p1");
			mgr.reportFailure("anthropic", "p1");
			mgr.reportFailure("anthropic", "p1");

			const result = mgr.resolveByIdWithMeta("claude-sonnet-4-20250514", config);
			expect(result.profileId).toBe("p2");
		});
	});
});
