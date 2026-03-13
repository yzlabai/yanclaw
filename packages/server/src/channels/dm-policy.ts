import type { Config } from "../config/schema";
import type { InboundMessage } from "./types";

export type DmPolicyResult = "allowed" | "denied" | "pairing-required";

/** Check DM policy for an inbound message. */
export function checkDmPolicy(msg: InboundMessage, config: Config): DmPolicyResult {
	const channelEntry = config.channels.find((c) => c.type === msg.channel);
	if (!channelEntry || !channelEntry.enabled) return "denied";

	const account = channelEntry.accounts.find((a) => a.id === msg.accountId);
	if (!account) return "denied";

	// Group messages bypass DM policy
	if (msg.peer.kind !== "direct") return "allowed";

	const policy = account.dmPolicy;

	switch (policy) {
		case "open":
			return "allowed";

		case "allowlist": {
			const allowed = account.allowFrom;
			if (allowed.length === 0) return "allowed"; // Empty list = allow all
			// Check by sender ID or name
			if (allowed.includes(msg.senderId) || allowed.includes(msg.senderName)) {
				return "allowed";
			}
			return "denied";
		}

		case "pairing":
			// Pairing code flow not yet implemented — behaves as senderId allowlist.
			// See: docs/plans/2026-03-13-code-cleanup-plan.md §3
			if (account.allowFrom.includes(msg.senderId)) return "allowed";
			return "pairing-required";

		default:
			return "denied";
	}
}

/** Check if a sender is an owner (can use ownerOnly tools). */
export function isOwnerSender(msg: InboundMessage, config: Config): boolean {
	// WebChat is always owner
	if (msg.channel === "webchat") return true;

	const channelEntry = config.channels.find((c) => c.type === msg.channel);
	if (!channelEntry) return false;

	const account = channelEntry.accounts.find((a) => a.id === msg.accountId);
	if (!account) return false;

	return account.ownerIds.includes(msg.senderId);
}
