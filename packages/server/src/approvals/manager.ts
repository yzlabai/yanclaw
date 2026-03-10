import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { approvals } from "../db/schema";
import { broadcastEvent } from "../routes/ws";

export type ApprovalDecision = "approved" | "denied";

interface PendingApproval {
	id: string;
	resolve: (decision: ApprovalDecision) => void;
	timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export class ApprovalManager {
	private pending = new Map<string, PendingApproval>();

	/**
	 * Request approval for a tool call.
	 * Creates a DB record, broadcasts to WebSocket clients, and waits for response.
	 * Returns the user's decision or "denied" on timeout.
	 */
	async requestApproval(params: {
		sessionKey: string;
		toolName: string;
		args: unknown;
		timeoutMs?: number;
	}): Promise<ApprovalDecision> {
		const { sessionKey, toolName, args, timeoutMs = DEFAULT_TIMEOUT_MS } = params;
		const id = randomUUID();
		const now = Date.now();

		// Store in DB
		const db = getDb();
		db.insert(approvals)
			.values({
				id,
				sessionKey,
				toolName,
				args: JSON.stringify(args),
				status: "pending",
				expiresAt: now + timeoutMs,
				createdAt: now,
			})
			.run();

		// Broadcast approval request to all connected WebSocket clients
		broadcastEvent({
			jsonrpc: "2.0",
			method: "approval.request",
			params: {
				id,
				sessionKey,
				toolName,
				args,
				expiresAt: now + timeoutMs,
			},
		});

		// Wait for user response or timeout
		return new Promise<ApprovalDecision>((resolve) => {
			const timer = setTimeout(() => {
				this.finalize(id, "denied");
			}, timeoutMs);

			this.pending.set(id, { id, resolve, timer });
		});
	}

	/**
	 * Respond to a pending approval request.
	 * Called from the WebSocket `approval.respond` handler.
	 */
	respond(id: string, decision: ApprovalDecision): boolean {
		const entry = this.pending.get(id);
		if (!entry) return false;

		this.finalize(id, decision);
		return true;
	}

	/** Finalize an approval: update DB, resolve promise, cleanup. */
	private finalize(id: string, decision: ApprovalDecision): void {
		const entry = this.pending.get(id);
		if (!entry) return;

		clearTimeout(entry.timer);
		this.pending.delete(id);

		// Update DB record
		const db = getDb();
		db.update(approvals)
			.set({ status: decision, respondedAt: Date.now() })
			.where(eq(approvals.id, id))
			.run();

		// Broadcast decision to clients
		broadcastEvent({
			jsonrpc: "2.0",
			method: "approval.decision",
			params: { id, decision },
		});

		entry.resolve(decision);
	}

	/**
	 * Check if a tool call needs approval based on exec policy.
	 */
	needsApproval(toolName: string, askMode: string, safeBins: string[]): boolean {
		if (askMode === "off") return false;
		if (askMode === "always") return true;

		// "on-miss" — only tools not in safeBins need approval
		// For shell commands, check the binary; for other tools, check tool name
		return !safeBins.includes(toolName);
	}

	/** Clean up all pending approvals on shutdown. */
	dispose(): void {
		for (const entry of this.pending.values()) {
			clearTimeout(entry.timer);
			entry.resolve("denied");
		}
		this.pending.clear();
	}
}
