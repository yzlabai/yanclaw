import { randomBytes } from "node:crypto";

interface TicketEntry {
	expiresAt: number;
}

const TICKET_TTL_MS = 30_000; // 30 seconds

/**
 * One-time-use ticket store for WebSocket authentication.
 * Tickets are generated via an authenticated HTTP endpoint,
 * then consumed during WebSocket upgrade.
 *
 * Note: Bun runs in a single-threaded event loop, so get + delete
 * between async ticks has no TOCTOU race. If migrating to multi-worker,
 * replace with an atomic store (e.g., Redis GETDEL).
 */
class WsTicketStore {
	private tickets = new Map<string, TicketEntry>();

	/** Generate a new one-time ticket. */
	issue(): string {
		const ticket = randomBytes(16).toString("hex");
		this.tickets.set(ticket, {
			expiresAt: Date.now() + TICKET_TTL_MS,
		});
		return ticket;
	}

	/** Validate and consume a ticket. Returns true if valid. */
	consume(ticket: string | null): boolean {
		if (!ticket) return false;
		const entry = this.tickets.get(ticket);
		if (!entry) return false;

		// Check expiry BEFORE deleting
		if (Date.now() > entry.expiresAt) {
			this.tickets.delete(ticket);
			return false;
		}

		// Valid — consume (one-time use)
		this.tickets.delete(ticket);
		return true;
	}

	/** Cleanup expired tickets (called periodically). */
	cleanup(): void {
		const now = Date.now();
		for (const [ticket, entry] of this.tickets) {
			if (now > entry.expiresAt) {
				this.tickets.delete(ticket);
			}
		}
	}
}

export const wsTicketStore = new WsTicketStore();

// Periodic cleanup every 60 seconds
setInterval(() => wsTicketStore.cleanup(), 60_000).unref();
