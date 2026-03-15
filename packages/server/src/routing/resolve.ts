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
	threadId?: string; // discord thread / slack thread — auto-binds to per-thread session
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
	// Thread binding: if message is from a thread, auto-bind to per-thread session
	if (ctx.threadId) {
		return `agent:${agentId}:thread:${ctx.threadId}`;
	}

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

/** Debug info for a single binding candidate. */
export interface BindingCandidate {
	rank: number;
	score: number;
	isWinner: boolean;
	binding: Binding;
	breakdown: {
		channel: number;
		account: number;
		peer: number;
		guild: number;
		group: number;
		roles: number;
	};
}

/** Detailed debug result for route resolution. */
export interface RouteDebugResult extends ResolvedRoute {
	candidates: BindingCandidate[];
	defaultAgent: string;
	totalBindings: number;
	matchedBindings: number;
}

/**
 * Resolve route with full debug information (score breakdown for all candidates).
 */
export function resolveRouteDebug(config: Config, ctx: RouteContext): RouteDebugResult {
	const { routing } = config;
	const scored: { binding: Binding; score: number; breakdown: BindingCandidate["breakdown"] }[] =
		[];

	for (const binding of routing.bindings) {
		const breakdown = {
			channel: 0,
			account: 0,
			peer: 0,
			guild: 0,
			group: 0,
			roles: 0,
		};

		// Check match conditions (mirrors bindingScore logic)
		if (binding.channel && binding.channel !== ctx.channel) continue;
		if (binding.account && binding.account !== ctx.accountId) continue;
		if (binding.peer && binding.peer !== ctx.peerId) continue;
		if (binding.guild && binding.guild !== ctx.guildId) continue;
		if (binding.group && binding.group !== ctx.groupId) continue;
		if (
			binding.roles &&
			binding.roles.length > 0 &&
			(!ctx.roles || !binding.roles.some((r) => ctx.roles?.includes(r)))
		)
			continue;

		// Score components
		if (binding.channel) breakdown.channel = 2;
		if (binding.account) breakdown.account = 2;
		if (binding.peer) breakdown.peer = 4;
		if (binding.guild) breakdown.guild = 1;
		if (binding.group) breakdown.group = 1;
		if (binding.roles?.length) breakdown.roles = 1;

		let score = Object.values(breakdown).reduce((a, b) => a + b, 0);
		if (binding.priority !== undefined) score = binding.priority;

		scored.push({ binding, score, breakdown });
	}

	// Sort by score descending
	scored.sort((a, b) => b.score - a.score);

	const winner = scored[0];
	const agentId = winner?.binding.agent ?? routing.default;
	const dmScope = winner?.binding.dmScope ?? routing.dmScope;
	const sessionKey = buildSessionKey(agentId, ctx, dmScope);

	const candidates: BindingCandidate[] = scored.map((s, i) => ({
		rank: i + 1,
		score: s.score,
		isWinner: i === 0,
		binding: s.binding,
		breakdown: s.breakdown,
	}));

	return {
		agentId,
		sessionKey,
		dmScope,
		binding: winner?.binding,
		candidates,
		defaultAgent: routing.default,
		totalBindings: routing.bindings.length,
		matchedBindings: scored.length,
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
