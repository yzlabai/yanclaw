import type { Binding, Config } from "../config/schema";

/**
 * Inbound message context used for routing resolution.
 */
export interface RouteContext {
	channel: string; // "telegram" | "discord" | "slack" | "webchat"
	accountId: string; // bot account id
	peerId: string; // sender's user id
	peerName?: string; // sender's display name
	guildId?: string; // discord guild / slack workspace
	groupId?: string; // telegram group / discord channel
	roles?: string[]; // discord roles
}

/**
 * Resolved route result.
 */
export interface ResolvedRoute {
	agentId: string;
	sessionKey: string;
	dmScope: "main" | "per-peer" | "per-channel-peer" | "per-account-peer";
	binding?: Binding;
}

/**
 * Calculate binding specificity score.
 * More specific bindings get higher priority.
 *
 * Priority levels (from design doc):
 * 8: channel + account + peer (exact user binding)
 * 7: channel + account + guild + roles
 * 6: channel + account + guild
 * 5: channel + account + group
 * 4: channel + account
 * 3: channel + peer
 * 2: channel
 * 1: default
 */
function bindingScore(b: Binding, ctx: RouteContext): number {
	// Must match channel if specified
	if (b.channel && b.channel !== ctx.channel) return -1;
	// Must match account if specified
	if (b.account && b.account !== ctx.accountId) return -1;

	let score = 0;

	if (b.channel) score += 2;
	if (b.account) score += 2;

	if (b.peer) {
		if (b.peer !== ctx.peerId) return -1;
		score += 4;
	}

	if (b.guild) {
		if (b.guild !== ctx.guildId) return -1;
		score += 1;
	}

	if (b.group) {
		if (b.group !== ctx.groupId) return -1;
		score += 1;
	}

	if (b.roles && b.roles.length > 0) {
		if (!ctx.roles || !b.roles.some((r) => ctx.roles?.includes(r))) return -1;
		score += 1;
	}

	// Manual priority override
	if (b.priority !== undefined) {
		score = b.priority;
	}

	return score;
}

/**
 * Build a session key based on the dmScope policy.
 */
function buildSessionKey(
	agentId: string,
	ctx: RouteContext,
	dmScope: "main" | "per-peer" | "per-channel-peer" | "per-account-peer",
): string {
	switch (dmScope) {
		case "main":
			return `agent:${agentId}:main`;
		case "per-peer":
			return `agent:${agentId}:${ctx.peerId}`;
		case "per-channel-peer":
			return `agent:${agentId}:${ctx.channel}:${ctx.peerId}`;
		case "per-account-peer":
			return `agent:${agentId}:${ctx.accountId}:${ctx.peerId}`;
	}
}

/**
 * Resolve which agent should handle an inbound message.
 * Evaluates all bindings and selects the most specific match.
 */
export function resolveRoute(config: Config, ctx: RouteContext): ResolvedRoute {
	const { routing } = config;

	let bestBinding: Binding | undefined;
	let bestScore = -1;

	for (const binding of routing.bindings) {
		const score = bindingScore(binding, ctx);
		if (score > bestScore) {
			bestScore = score;
			bestBinding = binding;
		}
	}

	const agentId = bestBinding?.agent ?? routing.default;
	const dmScope = bestBinding?.dmScope ?? routing.dmScope;
	const sessionKey = buildSessionKey(agentId, ctx, dmScope);

	return {
		agentId,
		sessionKey,
		dmScope,
		binding: bestBinding,
	};
}

/**
 * Resolve a peer's identity across channels using identityLinks.
 * Returns the canonical peer ID if linked, otherwise the original.
 */
export function resolveIdentity(config: Config, channel: string, peerId: string): string {
	const qualifiedId = `${channel}:${peerId}`;

	for (const [canonical, links] of Object.entries(config.routing.identityLinks)) {
		if (links.includes(qualifiedId)) {
			return canonical;
		}
	}

	return qualifiedId;
}
