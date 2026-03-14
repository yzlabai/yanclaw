/**
 * Tracks agent execution state for resumable sessions.
 * When the server restarts mid-execution, interrupted runs can be detected and resumed.
 */
import { and, eq, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { agentExecutions } from "./schema";
import { getDb } from "./sqlite";

export type ExecutionRow = typeof agentExecutions.$inferSelect;
export type ExecutionStatus = "running" | "interrupted" | "completed";

export class ExecutionStore {
	/** Create a new execution record when an agent run starts. */
	create(params: { sessionKey: string; agentId: string; userMessage: string }): string {
		const db = getDb();
		const id = nanoid();
		const now = Date.now();
		db.insert(agentExecutions)
			.values({
				id,
				sessionKey: params.sessionKey,
				agentId: params.agentId,
				status: "running",
				userMessage: params.userMessage,
				completedSteps: null,
				partialResponse: null,
				startedAt: now,
				updatedAt: now,
			})
			.run();
		return id;
	}

	/** Update the completed steps for an in-progress execution. */
	updateProgress(id: string, completedSteps: string[], partialResponse?: string): void {
		const db = getDb();
		db.update(agentExecutions)
			.set({
				completedSteps: JSON.stringify(completedSteps),
				partialResponse: partialResponse ?? null,
				updatedAt: Date.now(),
			})
			.where(eq(agentExecutions.id, id))
			.run();
	}

	/** Mark an execution as completed. */
	complete(id: string): void {
		const db = getDb();
		db.update(agentExecutions)
			.set({ status: "completed", updatedAt: Date.now() })
			.where(eq(agentExecutions.id, id))
			.run();
	}

	/** Mark all running executions as interrupted (called on startup). */
	markRunningAsInterrupted(): number {
		const db = getDb();
		const result = db
			.update(agentExecutions)
			.set({ status: "interrupted", updatedAt: Date.now() })
			.where(eq(agentExecutions.status, "running"))
			.run();
		return result.changes;
	}

	/** Find interrupted executions (for recovery on startup). */
	findInterrupted(): ExecutionRow[] {
		const db = getDb();
		return db.select().from(agentExecutions).where(eq(agentExecutions.status, "interrupted")).all();
	}

	/** Find interrupted execution for a specific session. */
	findInterruptedBySession(sessionKey: string): ExecutionRow | undefined {
		const db = getDb();
		return db
			.select()
			.from(agentExecutions)
			.where(
				and(eq(agentExecutions.sessionKey, sessionKey), eq(agentExecutions.status, "interrupted")),
			)
			.get();
	}

	/** Discard (delete) interrupted executions for a session. */
	discardInterrupted(sessionKey: string): number {
		const db = getDb();
		const result = db
			.delete(agentExecutions)
			.where(
				and(eq(agentExecutions.sessionKey, sessionKey), eq(agentExecutions.status, "interrupted")),
			)
			.run();
		return result.changes;
	}

	/** Clean up old completed executions (keep last N days). */
	pruneCompleted(days: number): number {
		if (days <= 0) return 0;
		const db = getDb();
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		const result = db
			.delete(agentExecutions)
			.where(and(eq(agentExecutions.status, "completed"), lt(agentExecutions.updatedAt, cutoff)))
			.run();
		return result.changes;
	}
}
