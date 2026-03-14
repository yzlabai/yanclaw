import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { nanoid } from "nanoid";
import type { AgentEvent } from "../runtime";
import type { AgentAdapter } from "./adapter";
import type {
	AgentProcess,
	AgentProcessStatus,
	AgentProcessType,
	OnDoneAction,
	PermissionRequest,
	SpawnConfig,
	SupervisorEvent,
	TaskDAG,
	TaskNode,
	WorktreeInfo,
} from "./types";

const STALE_CHECK_INTERVAL = 60_000; // 60s
const DEFAULT_APPROVAL_TIMEOUT = 30 * 60_000; // 30 minutes
const STOPPED_PROCESS_TTL = 30 * 60_000; // 30 minutes — evict stopped/error processes after this

/**
 * AgentSupervisor manages the lifecycle of external agent processes.
 * It spawns, tracks, and routes events for Claude Code, Codex, Gemini, etc.
 */
export class AgentSupervisor {
	private processes = new Map<string, AgentProcess>();
	private adapters = new Map<string, AgentAdapter>();
	private pendingApprovals = new Map<string, PermissionRequest>();
	private approvalTimers = new Map<string, ReturnType<typeof setTimeout>>();
	private onDoneActions = new Map<string, OnDoneAction>();
	private dags = new Map<string, TaskDAG>();
	private agentConfigResolver?: (agentId: string) => Record<string, unknown> | undefined;
	private eventEmitter = new EventEmitter();
	private staleTimer?: ReturnType<typeof setInterval>;
	private approvalTimeoutMs: number;
	private maxConcurrent: number;
	/** Adapter factory: maps runtime type to adapter constructor. */
	private adapterFactories = new Map<
		string,
		(agentConfig: Record<string, unknown>) => AgentAdapter
	>();

	constructor(options?: { approvalTimeoutMs?: number; maxConcurrent?: number }) {
		this.approvalTimeoutMs = options?.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT;
		this.maxConcurrent = options?.maxConcurrent ?? 5;
		this.startStaleCheck();
	}

	// ── Adapter Registration ───────────────────────────────────────────

	/** Register an adapter factory for a given runtime type. */
	registerAdapterFactory(
		type: string,
		factory: (agentConfig: Record<string, unknown>) => AgentAdapter,
	): void {
		this.adapterFactories.set(type, factory);
	}

	/** Set a resolver to look up agent config by ID (needed for DAG spawning). */
	setAgentConfigResolver(resolver: (agentId: string) => Record<string, unknown> | undefined): void {
		this.agentConfigResolver = resolver;
	}

	// ── Process Lifecycle ──────────────────────────────────────────────

	/** Spawn a new agent process. */
	async spawn(config: SpawnConfig, agentConfig: Record<string, unknown>): Promise<AgentProcess> {
		const running = this.getRunningCount();
		if (running >= this.maxConcurrent) {
			throw new Error(`Cannot spawn: ${running}/${this.maxConcurrent} concurrent agents running`);
		}

		const runtimeType = (agentConfig.runtime as string) ?? "claude-code";
		const factory = this.adapterFactories.get(runtimeType);
		if (!factory) {
			throw new Error(`No adapter registered for runtime type: ${runtimeType}`);
		}

		const processId = nanoid();
		const sessionKey = `agent-hub:${config.agentId}:${processId}`;

		// Resolve working directory
		const baseDir = (agentConfig.workspaceDir as string) ?? process.cwd();
		let workDir = config.workDir ? join(baseDir, config.workDir) : baseDir;

		// Create git worktree if requested
		let worktreePath: string | undefined;
		if (config.worktree) {
			worktreePath = join("/tmp", `yanclaw-wt-${processId}`);
			const branch = `agent/${processId}`;
			try {
				execFileSync("git", ["worktree", "add", worktreePath, "-b", branch], {
					cwd: baseDir,
					stdio: "pipe",
				});
				workDir = config.workDir ? join(worktreePath, config.workDir) : worktreePath;
			} catch (err) {
				console.warn(
					`[supervisor] Failed to create worktree, using original dir:`,
					err instanceof Error ? err.message : err,
				);
				worktreePath = undefined;
			}
		}

		await mkdir(workDir, { recursive: true });

		// Create the process record
		const process_: AgentProcess = {
			id: processId,
			agentId: config.agentId,
			type: runtimeType as AgentProcessType,
			status: "starting",
			workDir,
			sessionKey,
			task: config.task,
			worktreePath,
			startedAt: Date.now(),
			lastActivityAt: Date.now(),
			tokenUsage: { input: 0, output: 0 },
		};

		this.processes.set(processId, process_);

		// Store onDone action if specified
		if (config.onDone) {
			this.onDoneActions.set(processId, config.onDone);
		}

		// Create and wire up the adapter
		const adapter = factory(agentConfig);
		this.adapters.set(processId, adapter);

		// Subscribe to adapter events
		adapter.onEvent((event: AgentEvent) => {
			this.handleAdapterEvent(processId, event);
		});

		// Subscribe to permission requests if adapter supports it
		if (adapter.onPermissionRequest) {
			adapter.onPermissionRequest((req) => {
				this.handlePermissionRequest(processId, req);
			});
		}

		// Spawn the adapter
		try {
			const result = await adapter.spawn({
				workDir,
				task: config.task,
				systemPrompt: config.systemPrompt,
				model: config.model,
				signal: config.signal,
			});

			process_.pid = result.pid;
			process_.externalSessionId = result.sessionId;
			this.updateStatus(processId, "running");

			this.emit({ type: "process-started", process: { ...process_ } });
		} catch (err) {
			process_.status = "error";
			process_.error = err instanceof Error ? err.message : String(err);
			this.emit({
				type: "process-stopped",
				processId,
				reason: "error",
			});
			throw err;
		}

		return { ...process_ };
	}

	/** Stop a running process. */
	async stop(processId: string): Promise<void> {
		const adapter = this.adapters.get(processId);
		if (adapter) {
			try {
				await adapter.stop();
			} catch {
				// Best effort
			}
			this.adapters.delete(processId);
		}

		this.updateStatus(processId, "stopped");
		this.cleanupWorktree(processId);
		this.emit({ type: "process-stopped", processId, reason: "manual" });
	}

	/** Send a message to a running process. */
	async send(processId: string, message: string): Promise<void> {
		const adapter = this.adapters.get(processId);
		if (!adapter) {
			throw new Error(`Process ${processId} not found or not running`);
		}
		if (!adapter.isAlive()) {
			throw new Error(`Process ${processId} is not alive`);
		}
		await adapter.send(message);
	}

	/** Respond to a permission request. */
	async approve(processId: string, requestId: string, allowed: boolean): Promise<void> {
		const request = this.pendingApprovals.get(requestId);
		if (!request || request.processId !== processId) {
			throw new Error(`Permission request ${requestId} not found`);
		}

		const adapter = this.adapters.get(processId);
		if (adapter) {
			await adapter.respondPermission(requestId, allowed);
		}

		this.pendingApprovals.delete(requestId);

		// Clear timeout timer
		const timer = this.approvalTimers.get(requestId);
		if (timer) {
			clearTimeout(timer);
			this.approvalTimers.delete(requestId);
		}

		// Restore status to running
		this.updateStatus(processId, "running");
		this.emit({ type: "permission-resolved", requestId, allowed });
	}

	// ── Queries ────────────────────────────────────────────────────────

	/** List all tracked processes. */
	list(filter?: { agentId?: string; status?: AgentProcessStatus }): AgentProcess[] {
		let result = Array.from(this.processes.values());
		if (filter?.agentId) {
			result = result.filter((p) => p.agentId === filter.agentId);
		}
		if (filter?.status) {
			result = result.filter((p) => p.status === filter.status);
		}
		return result.map((p) => ({ ...p }));
	}

	/** Get a single process by ID. */
	get(processId: string): AgentProcess | undefined {
		const p = this.processes.get(processId);
		return p ? { ...p } : undefined;
	}

	/** Get all pending permission requests. */
	getPendingApprovals(): PermissionRequest[] {
		return Array.from(this.pendingApprovals.values());
	}

	/** Get pending approvals for a specific process. */
	getProcessApprovals(processId: string): PermissionRequest[] {
		return Array.from(this.pendingApprovals.values()).filter((r) => r.processId === processId);
	}

	/** Get number of running processes. */
	getRunningCount(): number {
		return Array.from(this.processes.values()).filter(
			(p) => p.status === "running" || p.status === "starting" || p.status === "waiting-approval",
		).length;
	}

	// ── Worktree ──────────────────────────────────────────────────────

	/** Get worktree info for a process. */
	getWorktreeInfo(processId: string): WorktreeInfo | null {
		const process_ = this.processes.get(processId);
		if (!process_?.worktreePath) return null;

		try {
			const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
				cwd: process_.worktreePath,
				encoding: "utf-8",
				stdio: "pipe",
			}).trim();

			const commitCountStr = execFileSync("git", ["rev-list", "--count", "HEAD", "^main"], {
				cwd: process_.worktreePath,
				encoding: "utf-8",
				stdio: "pipe",
			}).trim();

			const diffStat = execFileSync("git", ["diff", "--stat", "HEAD"], {
				cwd: process_.worktreePath,
				encoding: "utf-8",
				stdio: "pipe",
			}).trim();

			// Count changed files from diff stat
			const changedFiles = diffStat ? diffStat.split("\n").length - 1 : 0;

			return {
				path: process_.worktreePath,
				branch,
				commitCount: Number.parseInt(commitCountStr, 10) || 0,
				changedFiles: Math.max(0, changedFiles),
			};
		} catch {
			return { path: process_.worktreePath, branch: "unknown", commitCount: 0, changedFiles: 0 };
		}
	}

	/** Remove a worktree (without stopping the process — only for stopped/idle processes). */
	removeWorktree(processId: string): boolean {
		const process_ = this.processes.get(processId);
		if (!process_?.worktreePath) return false;
		if (process_.status === "running" || process_.status === "starting") return false;

		this.cleanupWorktree(processId);
		process_.worktreePath = undefined;
		return true;
	}

	// ── Task DAG ──────────────────────────────────────────────────────

	/** Create and start a task DAG. */
	async startDAG(dag: Omit<TaskDAG, "status" | "createdAt">): Promise<TaskDAG> {
		const fullDag: TaskDAG = {
			...dag,
			status: "pending",
			createdAt: Date.now(),
		};

		// Validate: check for cycles
		if (this.hasCycle(fullDag.tasks)) {
			throw new Error("Task DAG contains a cycle");
		}

		this.dags.set(dag.id, fullDag);
		fullDag.status = "running";

		// Start all tasks with no dependencies
		await this.advanceDAG(dag.id);
		return { ...fullDag };
	}

	/** Get a DAG by ID. */
	getDAG(dagId: string): TaskDAG | undefined {
		const dag = this.dags.get(dagId);
		return dag ? { ...dag, tasks: dag.tasks.map((t) => ({ ...t })) } : undefined;
	}

	/** List all DAGs. */
	listDAGs(): TaskDAG[] {
		return Array.from(this.dags.values()).map((d) => ({
			...d,
			tasks: d.tasks.map((t) => ({ ...t })),
		}));
	}

	// ── Event Subscription ─────────────────────────────────────────────

	/** Subscribe to supervisor events. Returns unsubscribe function. */
	subscribe(handler: (event: SupervisorEvent) => void): () => void {
		this.eventEmitter.on("event", handler);
		return () => {
			this.eventEmitter.off("event", handler);
		};
	}

	// ── Cleanup ────────────────────────────────────────────────────────

	/** Shutdown all processes and cleanup. */
	async shutdown(): Promise<void> {
		if (this.staleTimer) {
			clearInterval(this.staleTimer);
		}

		const stopPromises = Array.from(this.adapters.keys()).map((id) =>
			this.stop(id).catch(() => {}),
		);
		await Promise.all(stopPromises);
	}

	// ── Internal ───────────────────────────────────────────────────────

	private emit(event: SupervisorEvent): void {
		this.eventEmitter.emit("event", event);
	}

	private updateStatus(processId: string, status: AgentProcessStatus): void {
		const process_ = this.processes.get(processId);
		if (!process_ || process_.status === status) return;
		process_.status = status;
		process_.lastActivityAt = Date.now();
		this.emit({ type: "status-change", processId, status });
	}

	private handleAdapterEvent(processId: string, event: AgentEvent): void {
		const process_ = this.processes.get(processId);
		if (!process_) return;

		process_.lastActivityAt = Date.now();

		// Track token usage
		if (event.type === "done" && "usage" in event) {
			process_.tokenUsage.input += event.usage.promptTokens;
			process_.tokenUsage.output += event.usage.completionTokens;

			// Process completed
			this.updateStatus(processId, "idle");
			this.emit({ type: "process-stopped", processId, reason: "completed" });

			// Execute onDone actions
			this.executeOnDone(processId).catch((err) => {
				console.warn("[supervisor] onDone failed:", err);
			});

			// Advance any DAGs this process belongs to
			this.advanceDAGsForProcess(processId).catch((err) => {
				console.warn("[supervisor] DAG advance failed:", err);
			});
		}

		if (event.type === "error") {
			process_.error = event.message;
			this.updateStatus(processId, "error");

			// Mark DAG tasks as failed
			this.failDAGsForProcess(processId);
		}

		this.emit({ type: "agent-event", processId, event });
	}

	private handlePermissionRequest(
		processId: string,
		req: { requestId: string; tool: string; args: unknown; description: string },
	): void {
		const risk = classifyRisk(req.tool, req.args);
		const request: PermissionRequest = {
			...req,
			processId,
			risk,
			createdAt: Date.now(),
			timeoutMs: this.approvalTimeoutMs,
		};

		this.pendingApprovals.set(req.requestId, request);
		this.updateStatus(processId, "waiting-approval");
		this.emit({ type: "permission-request", request });

		// Auto-deny on timeout
		const timer = setTimeout(() => {
			this.approvalTimers.delete(req.requestId);
			if (this.pendingApprovals.has(req.requestId)) {
				this.approve(processId, req.requestId, false).catch(() => {});
			}
		}, this.approvalTimeoutMs);
		this.approvalTimers.set(req.requestId, timer);
	}

	private startStaleCheck(): void {
		this.staleTimer = setInterval(() => {
			const now = Date.now();
			for (const [id, process_] of this.processes) {
				// Evict stopped/error processes after TTL
				if (
					(process_.status === "stopped" || process_.status === "error") &&
					now - process_.lastActivityAt > STOPPED_PROCESS_TTL
				) {
					this.processes.delete(id);
					this.onDoneActions.delete(id);
					continue;
				}

				if (process_.status === "stopped" || process_.status === "error") continue;

				const adapter = this.adapters.get(id);
				if (adapter && !adapter.isAlive()) {
					process_.status = "stopped";
					this.adapters.delete(id);
					this.emit({ type: "process-stopped", processId: id, reason: "error" });
				}
			}
		}, STALE_CHECK_INTERVAL);
	}

	private async executeOnDone(processId: string): Promise<void> {
		const action = this.onDoneActions.get(processId);
		if (!action) return;

		const process_ = this.processes.get(processId);
		if (!process_) return;

		const summary = `Agent "${process_.agentId}" completed task: ${process_.task ?? "(no task)"}`;

		// Notify other running processes
		if (action.notifyProcesses) {
			for (const targetId of action.notifyProcesses) {
				const adapter = this.adapters.get(targetId);
				if (adapter?.isAlive()) {
					await adapter.send(summary).catch(() => {});
				}
			}
		}

		// Spawn follow-up agents
		if (action.spawnNext && this.agentConfigResolver) {
			for (const next of action.spawnNext) {
				const agentConfig = this.agentConfigResolver(next.agentId);
				if (!agentConfig) continue;

				const task = next.task ?? `Follow-up from ${process_.agentId}: ${process_.task ?? ""}`;
				await this.spawn(
					{ agentId: next.agentId, task, workDir: next.workDir, worktree: next.worktree },
					agentConfig,
				).catch((err) => {
					console.warn(`[supervisor] Failed to spawn follow-up ${next.agentId}:`, err);
				});
			}
		}

		this.onDoneActions.delete(processId);
	}

	private async advanceDAG(dagId: string): Promise<void> {
		const dag = this.dags.get(dagId);
		if (!dag || dag.status !== "running") return;

		// Find tasks ready to run (all dependencies completed)
		for (const task of dag.tasks) {
			if (task.status !== "pending") continue;

			const depsCompleted = task.dependsOn.every((depId) => {
				const dep = dag.tasks.find((t) => t.id === depId);
				return dep?.status === "completed";
			});

			const depsFailed = task.dependsOn.some((depId) => {
				const dep = dag.tasks.find((t) => t.id === depId);
				return dep?.status === "failed";
			});

			if (depsFailed) {
				task.status = "skipped";
				continue;
			}

			if (!depsCompleted) continue;

			// Resolve agent config and spawn
			if (!this.agentConfigResolver) {
				task.status = "failed";
				task.error = "No agent config resolver set";
				continue;
			}

			const agentConfig = this.agentConfigResolver(task.agentId);
			if (!agentConfig) {
				task.status = "failed";
				task.error = `Agent "${task.agentId}" not found`;
				continue;
			}

			try {
				task.status = "running";
				const proc = await this.spawn(
					{
						agentId: task.agentId,
						task: task.task,
						workDir: task.workDir,
						worktree: task.worktree,
					},
					agentConfig,
				);
				task.processId = proc.id;
			} catch (err) {
				task.status = "failed";
				task.error = err instanceof Error ? err.message : String(err);
			}
		}

		// Check if DAG is complete
		const allDone = dag.tasks.every((t) => ["completed", "failed", "skipped"].includes(t.status));
		if (allDone) {
			dag.status = dag.tasks.some((t) => t.status === "failed") ? "failed" : "completed";
		}
	}

	private async advanceDAGsForProcess(processId: string): Promise<void> {
		for (const [dagId, dag] of this.dags) {
			if (dag.status !== "running") continue;

			const task = dag.tasks.find((t) => t.processId === processId);
			if (task) {
				task.status = "completed";
				await this.advanceDAG(dagId);
			}
		}
	}

	private failDAGsForProcess(processId: string): void {
		for (const dag of this.dags.values()) {
			if (dag.status !== "running") continue;

			const task = dag.tasks.find((t) => t.processId === processId);
			if (task) {
				task.status = "failed";
				task.error = this.processes.get(processId)?.error ?? "Process failed";
			}
		}
	}

	private hasCycle(tasks: TaskNode[]): boolean {
		const visited = new Set<string>();
		const visiting = new Set<string>();

		const dfs = (id: string): boolean => {
			if (visiting.has(id)) return true;
			if (visited.has(id)) return false;
			visiting.add(id);

			const task = tasks.find((t) => t.id === id);
			if (task) {
				for (const depId of task.dependsOn) {
					if (dfs(depId)) return true;
				}
			}

			visiting.delete(id);
			visited.add(id);
			return false;
		};

		return tasks.some((t) => dfs(t.id));
	}

	private cleanupWorktree(processId: string): void {
		const process_ = this.processes.get(processId);
		if (!process_?.worktreePath) return;

		try {
			execFileSync("git", ["worktree", "remove", process_.worktreePath, "--force"], {
				cwd: process_.workDir,
				stdio: "pipe",
			});
		} catch {
			// Best effort — user can clean up manually
		}
	}
}

/** Classify risk level based on tool name and args. */
function classifyRisk(tool: string, args: unknown): "low" | "medium" | "high" {
	const toolLower = tool.toLowerCase();
	const highRiskTools = ["bash", "shell", "file_write", "file_edit"];
	const mediumRiskTools = ["edit", "write", "notebookedit"];

	if (highRiskTools.includes(toolLower)) {
		// Check for destructive patterns in args
		const argsStr = JSON.stringify(args);
		if (/\b(rm\s+-rf|DROP\s+TABLE|DELETE\s+FROM|truncate|format|mkfs)/i.test(argsStr)) {
			return "high";
		}
		return "medium";
	}

	if (mediumRiskTools.includes(toolLower)) {
		return "medium";
	}

	return "low";
}
