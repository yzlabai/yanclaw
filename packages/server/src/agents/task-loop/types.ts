import type { Peer } from "../../channels/types";

// ── Task State ────────────────────────────────────────────────────────

export type LoopTaskState =
	| "queued"
	| "spawning"
	| "executing"
	| "verifying"
	| "evaluating"
	| "iterating"
	| "done"
	| "delivering"
	| "blocked"
	| "waiting_confirm"
	| "cancelled";

export type LoopStage = "executing" | "verifying" | "delivering";

// ── LoopTask ──────────────────────────────────────────────────────────

export interface LoopTask {
	id: string;
	preset: string; // "dev" | "docs" | "research" | ...
	state: LoopTaskState;
	previousState?: LoopTaskState; // waiting_confirm 恢复时回到哪个状态
	prompt: string;
	workDir: string;
	worktreePath?: string;
	processId?: string; // AgentSupervisor 进程 ID
	sessionId?: string; // 智能体 session ID，用于 resume

	// 迭代控制
	iteration: number;
	maxIterations: number; // 默认 10
	maxDurationMs: number; // 默认 4h
	errorHistory: string[]; // 历史错误，用于死循环检测

	// 验证结果（泛型存储，由 preset 解释）
	lastResult?: unknown;

	// 确认策略
	confirmPolicy: ConfirmPolicy;

	// 交付结果
	deliverResult?: DeliverResult;

	// 预设专用字段（由 preset.parseOptions 填充）
	options: Record<string, unknown>;

	// 元数据
	triggeredBy: "dashboard" | "channel";
	channelPeer?: Peer;
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
	dagId?: string;
	dagNodeId?: string;
}

// ── Confirm Policy ────────────────────────────────────────────────────

export interface ConfirmPolicy {
	/** 命中的工具名暂停 */
	operations: string[];
	/** 进入该阶段前暂停 */
	stages: LoopStage[];
	/** 该等级及以上暂停 */
	riskThreshold: "low" | "medium" | "high" | "none";
}

export const DEFAULT_CONFIRM_POLICY: ConfirmPolicy = {
	operations: [],
	stages: ["delivering"],
	riskThreshold: "none",
};

// ── Pluggable Strategies ──────────────────────────────────────────────

/** 验证器：判断智能体的产出是否合格 */
export interface Verifier<TResult = VerifyResult> {
	verify(ctx: VerifyContext): Promise<TResult>;
	passed(result: TResult): boolean;
}

export interface VerifyContext {
	workDir: string;
	task: LoopTask;
}

/** 通用验证结果（预设可扩展） */
export interface VerifyResult {
	allPassed: boolean;
}

/** 交付器 */
export interface Deliverer<TResult = VerifyResult> {
	deliver(ctx: DeliverContext<TResult>): Promise<DeliverResult>;
}

export interface DeliverContext<TResult> {
	workDir: string;
	task: LoopTask;
	lastResult: TResult;
}

export interface DeliverResult {
	success: boolean;
	url?: string;
	error?: string;
}

/** 反馈格式化器 */
export type FeedbackFormatter<TResult = VerifyResult> = (result: TResult, task: LoopTask) => string;

/** 终止策略 */
export interface TerminationPolicy {
	judge(ctx: TerminationContext): JudgeDecision;
}

export interface TerminationContext {
	task: LoopTask;
	lastResult: unknown;
	elapsed: number;
}

export interface JudgeDecision {
	action: "done" | "iterate" | "blocked";
	reason: string;
	feedbackPrompt?: string;
}

/** 场景预设 */
export interface LoopPreset<TResult = VerifyResult> {
	name: string;
	verifier: Verifier<TResult>;
	deliverer: Deliverer<TResult>;
	feedbackFormatter: FeedbackFormatter<TResult>;
	terminationPolicy: TerminationPolicy;
	parseOptions?(raw: Record<string, unknown>): Record<string, unknown>;
}

// ── DAG ───────────────────────────────────────────────────────────────

/** A node in a Task Loop DAG. */
export interface LoopDAGNode {
	id: string;
	preset: string;
	prompt: string;
	agentId: string;
	workDir: string;
	worktree?: boolean;
	dependsOn: string[];
	/** Whether this node should independently deliver (default: only final nodes deliver). */
	deliver?: boolean;
	presetOptions?: Record<string, unknown>;
}

/** A Task Loop DAG definition. */
export interface LoopDAG {
	id: string;
	name: string;
	nodes: LoopDAGNode[];
	status: "pending" | "running" | "completed" | "failed";
	/** Maps node ID → task ID (once created). */
	nodeTaskMap: Record<string, string>;
	createdAt: number;
}

// ── Task Loop Events (for SSE / notifications) ───────────────────────

export type TaskLoopEvent =
	| { type: "task-created"; task: LoopTask }
	| {
			type: "state-change";
			taskId: string;
			from: LoopTaskState;
			to: LoopTaskState;
			reason?: string;
	  }
	| { type: "iteration"; taskId: string; iteration: number; maxIterations: number }
	| { type: "task-done"; taskId: string; deliverResult?: DeliverResult }
	| { type: "task-blocked"; taskId: string; reason: string }
	| { type: "waiting-confirm"; taskId: string; stage: string; reason: string }
	| { type: "dag-created"; dag: LoopDAG }
	| { type: "dag-completed"; dagId: string; status: "completed" | "failed" };
