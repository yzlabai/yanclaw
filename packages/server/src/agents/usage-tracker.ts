import { desc, eq, gte, lt, sql } from "drizzle-orm";
import { usage } from "../db/schema";
import { getDb } from "../db/sqlite";

/** Model pricing in USD per 1M tokens. */
const MODEL_PRICING: Record<string, { input: number; output: number; cacheRead?: number }> = {
	// Anthropic
	"claude-opus-4-1-20250805": { input: 15.0, output: 75.0, cacheRead: 1.5 },
	"claude-sonnet-4-20250514": { input: 3.0, output: 15.0, cacheRead: 0.3 },
	"claude-sonnet-4-6-20260610": { input: 3.0, output: 15.0, cacheRead: 0.3 },
	"claude-haiku-4-5-20251001": { input: 0.8, output: 4.0, cacheRead: 0.08 },
	// OpenAI
	"gpt-4o": { input: 2.5, output: 10.0, cacheRead: 1.25 },
	"gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075 },
	"gpt-4.1": { input: 2.0, output: 8.0, cacheRead: 0.5 },
	"gpt-4.1-mini": { input: 0.4, output: 1.6, cacheRead: 0.1 },
	"gpt-4.1-nano": { input: 0.1, output: 0.4, cacheRead: 0.025 },
	o3: { input: 2.0, output: 8.0, cacheRead: 0.5 },
	"o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.275 },
	"o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.275 },
	// Google
	"gemini-2.5-pro": { input: 1.25, output: 10.0 },
	"gemini-2.5-flash": { input: 0.15, output: 0.6 },
	// DeepSeek
	"deepseek-chat": { input: 0.27, output: 1.1, cacheRead: 0.07 },
	"deepseek-reasoner": { input: 0.55, output: 2.19, cacheRead: 0.14 },
};

export interface UsageRecord {
	sessionKey: string;
	agentId: string;
	model: string;
	provider: string;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	durationMs: number;
}

export interface UsageSummary {
	totalInputTokens: number;
	totalOutputTokens: number;
	totalCacheReadTokens: number;
	totalCacheWriteTokens: number;
	totalCostUsd: number;
	totalRequests: number;
}

export class UsageTracker {
	/** Record a single API call's token usage. */
	record(rec: UsageRecord): void {
		const db = getDb();
		const cost = this.estimateCost(
			rec.model,
			rec.inputTokens,
			rec.outputTokens,
			rec.cacheReadTokens ?? 0,
		);

		db.insert(usage)
			.values({
				sessionKey: rec.sessionKey,
				agentId: rec.agentId,
				model: rec.model,
				provider: rec.provider,
				inputTokens: rec.inputTokens,
				outputTokens: rec.outputTokens,
				cacheReadTokens: rec.cacheReadTokens ?? 0,
				cacheWriteTokens: rec.cacheWriteTokens ?? 0,
				estimatedCostUsd: cost,
				durationMs: rec.durationMs,
				createdAt: Date.now(),
			})
			.run();
	}

	/** Get usage summary for the last N days. */
	summary(days = 7): UsageSummary {
		const db = getDb();
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

		const [row] = db
			.select({
				totalInputTokens: sql<number>`COALESCE(SUM(${usage.inputTokens}), 0)`,
				totalOutputTokens: sql<number>`COALESCE(SUM(${usage.outputTokens}), 0)`,
				totalCacheReadTokens: sql<number>`COALESCE(SUM(${usage.cacheReadTokens}), 0)`,
				totalCacheWriteTokens: sql<number>`COALESCE(SUM(${usage.cacheWriteTokens}), 0)`,
				totalCostUsd: sql<number>`COALESCE(SUM(${usage.estimatedCostUsd}), 0)`,
				totalRequests: sql<number>`COUNT(*)`,
			})
			.from(usage)
			.where(gte(usage.createdAt, cutoff))
			.all();

		return row;
	}

	/** Get usage breakdown by agent. */
	byAgent(days = 7): Array<{ agentId: string } & UsageSummary> {
		const db = getDb();
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

		return db
			.select({
				agentId: usage.agentId,
				totalInputTokens: sql<number>`COALESCE(SUM(${usage.inputTokens}), 0)`,
				totalOutputTokens: sql<number>`COALESCE(SUM(${usage.outputTokens}), 0)`,
				totalCacheReadTokens: sql<number>`COALESCE(SUM(${usage.cacheReadTokens}), 0)`,
				totalCacheWriteTokens: sql<number>`COALESCE(SUM(${usage.cacheWriteTokens}), 0)`,
				totalCostUsd: sql<number>`COALESCE(SUM(${usage.estimatedCostUsd}), 0)`,
				totalRequests: sql<number>`COUNT(*)`,
			})
			.from(usage)
			.where(gte(usage.createdAt, cutoff))
			.groupBy(usage.agentId)
			.orderBy(sql`SUM(${usage.estimatedCostUsd}) DESC`)
			.all();
	}

	/** Get usage breakdown by model. */
	byModel(days = 7): Array<{ model: string; provider: string } & UsageSummary> {
		const db = getDb();
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

		return db
			.select({
				model: usage.model,
				provider: usage.provider,
				totalInputTokens: sql<number>`COALESCE(SUM(${usage.inputTokens}), 0)`,
				totalOutputTokens: sql<number>`COALESCE(SUM(${usage.outputTokens}), 0)`,
				totalCacheReadTokens: sql<number>`COALESCE(SUM(${usage.cacheReadTokens}), 0)`,
				totalCacheWriteTokens: sql<number>`COALESCE(SUM(${usage.cacheWriteTokens}), 0)`,
				totalCostUsd: sql<number>`COALESCE(SUM(${usage.estimatedCostUsd}), 0)`,
				totalRequests: sql<number>`COUNT(*)`,
			})
			.from(usage)
			.where(gte(usage.createdAt, cutoff))
			.groupBy(usage.model, usage.provider)
			.orderBy(sql`SUM(${usage.estimatedCostUsd}) DESC`)
			.all();
	}

	/** Get daily usage for the last N days (for charts). */
	daily(days = 30): Array<{ date: string; totalCostUsd: number; totalRequests: number }> {
		const db = getDb();
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

		return db
			.select({
				date: sql<string>`DATE(${usage.createdAt} / 1000, 'unixepoch')`,
				totalCostUsd: sql<number>`COALESCE(SUM(${usage.estimatedCostUsd}), 0)`,
				totalRequests: sql<number>`COUNT(*)`,
			})
			.from(usage)
			.where(gte(usage.createdAt, cutoff))
			.groupBy(sql`DATE(${usage.createdAt} / 1000, 'unixepoch')`)
			.orderBy(sql`DATE(${usage.createdAt} / 1000, 'unixepoch')`)
			.all();
	}

	/** Get recent usage records. */
	recent(limit = 50, agentId?: string): Array<typeof usage.$inferSelect> {
		const db = getDb();
		const conditions = agentId ? eq(usage.agentId, agentId) : undefined;

		return db
			.select()
			.from(usage)
			.where(conditions)
			.orderBy(desc(usage.createdAt))
			.limit(limit)
			.all();
	}

	/** Prune usage records older than N days. */
	prune(days: number): number {
		if (days <= 0) return 0;
		const db = getDb();
		const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
		const result = db.delete(usage).where(lt(usage.createdAt, cutoff)).run();
		return result.changes;
	}

	/** Estimate cost in USD for a single API call. */
	private estimateCost(
		model: string,
		inputTokens: number,
		outputTokens: number,
		cacheReadTokens: number,
	): number {
		// Try exact match, then prefix match
		const pricing = MODEL_PRICING[model] ?? this.findPricingByPrefix(model);
		if (!pricing) return 0;

		const inputCost = (inputTokens / 1_000_000) * pricing.input;
		const outputCost = (outputTokens / 1_000_000) * pricing.output;
		const cacheCost = pricing.cacheRead ? (cacheReadTokens / 1_000_000) * pricing.cacheRead : 0;

		return Math.round((inputCost + outputCost + cacheCost) * 1_000_000) / 1_000_000;
	}

	private findPricingByPrefix(model: string): (typeof MODEL_PRICING)[string] | undefined {
		for (const [key, val] of Object.entries(MODEL_PRICING)) {
			if (model.startsWith(key) || key.startsWith(model)) return val;
		}
		return undefined;
	}
}
