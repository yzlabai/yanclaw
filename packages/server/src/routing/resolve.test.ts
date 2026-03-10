import { describe, expect, it } from "vitest";
import type { Config } from "../config/schema";
import { resolveIdentity, resolveRoute } from "./resolve";
import type { RouteContext } from "./resolve";

function makeConfig(overrides: Partial<Config["routing"]> = {}): Config {
	return {
		routing: {
			default: "main",
			dmScope: "per-peer",
			bindings: [],
			identityLinks: {},
			...overrides,
		},
	} as unknown as Config;
}

const baseCtx: RouteContext = {
	channel: "telegram",
	accountId: "bot_prod",
	peerId: "user_123",
};

describe("resolveRoute", () => {
	it("returns default agent when no bindings match", () => {
		const result = resolveRoute(makeConfig(), baseCtx);
		expect(result.agentId).toBe("main");
		expect(result.dmScope).toBe("per-peer");
		expect(result.sessionKey).toBe("agent:main:user_123");
	});

	it("matches channel binding", () => {
		const config = makeConfig({
			bindings: [{ channel: "telegram", agent: "tg-agent" }],
		});
		const result = resolveRoute(config, baseCtx);
		expect(result.agentId).toBe("tg-agent");
	});

	it("does not match wrong channel", () => {
		const config = makeConfig({
			bindings: [{ channel: "discord", agent: "dc-agent" }],
		});
		const result = resolveRoute(config, baseCtx);
		expect(result.agentId).toBe("main");
	});

	it("peer binding takes priority over channel binding", () => {
		const config = makeConfig({
			bindings: [
				{ channel: "telegram", agent: "tg-agent" },
				{ channel: "telegram", peer: "user_123", agent: "vip-agent" },
			],
		});
		const result = resolveRoute(config, baseCtx);
		expect(result.agentId).toBe("vip-agent");
	});

	it("guild binding requires guild match", () => {
		const config = makeConfig({
			bindings: [{ guild: "guild_456", agent: "guild-agent" }],
		});
		// No guild in context
		expect(resolveRoute(config, baseCtx).agentId).toBe("main");

		// With matching guild
		const ctxWithGuild = { ...baseCtx, guildId: "guild_456" };
		expect(resolveRoute(config, ctxWithGuild).agentId).toBe("guild-agent");
	});

	it("roles binding requires at least one matching role", () => {
		const config = makeConfig({
			bindings: [{ guild: "g1", roles: ["admin"], agent: "admin-agent" }],
		});
		const ctxNoRoles = { ...baseCtx, guildId: "g1" };
		expect(resolveRoute(config, ctxNoRoles).agentId).toBe("main");

		const ctxWithRole = { ...baseCtx, guildId: "g1", roles: ["admin", "user"] };
		expect(resolveRoute(config, ctxWithRole).agentId).toBe("admin-agent");
	});

	it("respects dmScope override on binding", () => {
		const config = makeConfig({
			bindings: [{ channel: "telegram", agent: "tg-agent", dmScope: "main" }],
		});
		const result = resolveRoute(config, baseCtx);
		expect(result.dmScope).toBe("main");
		expect(result.sessionKey).toBe("agent:tg-agent:main");
	});

	it("builds per-channel-peer session key", () => {
		const config = makeConfig({ dmScope: "per-channel-peer" });
		const result = resolveRoute(config, baseCtx);
		expect(result.sessionKey).toBe("agent:main:telegram:user_123");
	});

	it("builds per-account-peer session key", () => {
		const config = makeConfig({ dmScope: "per-account-peer" });
		const result = resolveRoute(config, baseCtx);
		expect(result.sessionKey).toBe("agent:main:bot_prod:user_123");
	});

	it("priority override overrides computed score", () => {
		const config = makeConfig({
			bindings: [
				{ channel: "telegram", peer: "user_123", agent: "specific" },
				{ channel: "telegram", agent: "general", priority: 100 },
			],
		});
		const result = resolveRoute(config, baseCtx);
		expect(result.agentId).toBe("general");
	});
});

describe("resolveIdentity", () => {
	it("returns qualified id when no links configured", () => {
		const config = makeConfig();
		expect(resolveIdentity(config, "telegram", "user_123")).toBe("telegram:user_123");
	});

	it("returns canonical name when linked", () => {
		const config = makeConfig({
			identityLinks: {
				jane: ["telegram:user_111", "discord:333"],
			},
		});
		expect(resolveIdentity(config, "telegram", "user_111")).toBe("jane");
		expect(resolveIdentity(config, "discord", "333")).toBe("jane");
	});

	it("returns qualified id when not in any link group", () => {
		const config = makeConfig({
			identityLinks: {
				jane: ["telegram:user_111"],
			},
		});
		expect(resolveIdentity(config, "telegram", "user_999")).toBe("telegram:user_999");
	});
});
