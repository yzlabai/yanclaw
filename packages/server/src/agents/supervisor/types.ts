import type { AgentEvent } from "../runtime";

/** Status of a managed agent process. */
export type AgentProcessStatus =
	| "starting"
	| "running"
	| "waiting-approval"
	| "idle"
	| "stopped"
	| "error";

/** Supported external agent runtime types. */
export type AgentProcessType = "claude-code" | "codex" | "gemini" | "custom";

/** A managed agent process tracked by the Supervisor. */
export interface AgentProcess {
	/** Unique process ID (cuid2). */
	id: string;
	/** Reference to config agent ID. */
	agentId: string;
	/** Agent runtime type. */
	type: AgentProcessType;
	/** Current status. */
	status: AgentProcessStatus;
	/** OS process ID (if spawned as child process). */
	pid?: number;
	/** Working directory. */
	workDir: string;
	/** YanClaw session key for message persistence. */
	sessionKey: string;
	/** Human-readable task description. */
	task?: string;
	/** Git worktree path (if isolated). */
	worktreePath?: string;
	/** Agent SDK or external session ID (for resume). */
	externalSessionId?: string;
	/** Timestamp when process was started. */
	startedAt: number;
	/** Timestamp of last activity (event received). */
	lastActivityAt: number;
	/** Cumulative token usage. */
	tokenUsage: { input: number; output: number };
	/** Error message (when status is "error"). */
	error?: string;
}

/** A pending permission request from an agent. */
export interface PermissionRequest {
	/** Unique request ID. */
	requestId: string;
	/** Which process is asking. */
	processId: string;
	/** Tool name. */
	tool: string;
	/** Tool arguments. */
	args: unknown;
	/** Human-readable description of what the tool will do. */
	description: string;
	/** Risk level. */
	risk: "low" | "medium" | "high";
	/** When the request was created. */
	createdAt: number;
	/** Timeout in ms after which auto-deny. */
	timeoutMs: number;
}

/** Events emitted by the Supervisor (wraps AgentEvent with process context). */
export type SupervisorEvent =
	| { type: "process-started"; process: AgentProcess }
	| { type: "process-stopped"; processId: string; reason: "manual" | "completed" | "error" }
	| { type: "status-change"; processId: string; status: AgentProcessStatus }
	| { type: "permission-request"; request: PermissionRequest }
	| { type: "permission-resolved"; requestId: string; allowed: boolean }
	| { type: "agent-event"; processId: string; event: AgentEvent };

/** Configuration for spawning an agent process. */
export interface SpawnConfig {
	/** Config agent ID to use. */
	agentId: string;
	/** Task description. */
	task?: string;
	/** Working directory override (relative to agent's workspaceDir). */
	workDir?: string;
	/** Whether to create a git worktree for isolation. */
	worktree?: boolean;
	/** System prompt override/append. */
	systemPrompt?: string;
	/** Model override. */
	model?: string;
	/** Abort signal. */
	signal?: AbortSignal;
	/** When done, forward summary to these process IDs. */
	onDone?: OnDoneAction;
}

/** Action to take when an agent process completes. */
export interface OnDoneAction {
	/** Process IDs to notify with the completion summary. */
	notifyProcesses?: string[];
	/** Agent IDs to spawn as follow-up tasks. */
	spawnNext?: Array<{
		agentId: string;
		task?: string;
		workDir?: string;
		worktree?: boolean;
	}>;
}

/** Git worktree status information. */
export interface WorktreeInfo {
	path: string;
	branch: string;
	commitCount: number;
	changedFiles: number;
	aheadOf?: string;
}

/** A task in a dependency graph (DAG). */
export interface TaskNode {
	/** Unique task ID within the DAG. */
	id: string;
	/** Agent config ID to run this task. */
	agentId: string;
	/** Task description. */
	task: string;
	/** IDs of tasks that must complete before this one starts. */
	dependsOn: string[];
	/** Working directory. */
	workDir?: string;
	/** Use git worktree. */
	worktree?: boolean;
	/** Runtime status. */
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	/** The spawned process ID (once started). */
	processId?: string;
	/** Error message if failed. */
	error?: string;
}

/** A task DAG definition. */
export interface TaskDAG {
	id: string;
	name: string;
	tasks: TaskNode[];
	createdAt: number;
	status: "pending" | "running" | "completed" | "failed";
}
