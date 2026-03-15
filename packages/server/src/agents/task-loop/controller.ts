import { EventEmitter } from "node:events";
import { nanoid } from "nanoid";
import type { AgentSupervisor } from "../supervisor";
import type { SupervisorEvent } from "../supervisor/types";
import { ConfirmationGate } from "./confirm-gate";
import { assertTransition, hasDAGCycle } from "./state-machine";
import {
	type ConfirmPolicy,
	DEFAULT_CONFIRM_POLICY,
	type LoopDAG,
	type LoopDAGNode,
	type LoopPreset,
	type LoopTask,
	type LoopTaskState,
	type TaskLoopEvent,
} from "./types";

export interface TaskLoopConfig {
	defaultConfirmPolicy?: ConfirmPolicy;
	maxIterations?: number;
	maxDurationMs?: number;
}

export interface CreateTaskOptions {
	preset: string;
	prompt: string;
	workDir: string;
	agentId: string;
	worktree?: boolean;
	confirmPolicy?: ConfirmPolicy;
	maxIterations?: number;
	maxDurationMs?: number;
	triggeredBy: "dashboard" | "channel";
	channelPeer?: { channelId: string; peerId: string };
	/** Preset-specific options (passed to preset.parseOptions) */
	presetOptions?: Record<string, unknown>;
}

/**
 * TaskLoopController — 主编排器。
 *
 * 管理 Task Loop 生命周期：
 * 派发 → 监控 → 验证 → 反馈 → 迭代
 */
export class TaskLoopController {
	private tasks = new Map<string, LoopTask>();
	private presets = new Map<string, LoopPreset<unknown>>();
	private supervisor: AgentSupervisor;
	private config: TaskLoopConfig;
	private confirmGate = new ConfirmationGate();
	private eventEmitter = new EventEmitter();
	private unsubSupervisor?: () => void;
	/** Maps processId → taskId for reverse lookup. */
	private processToTask = new Map<string, string>();
	private dags = new Map<string, LoopDAG>();
	/** Touch timers for processes in waiting_confirm (prevent stale eviction). */
	private touchTimers = new Map<string, ReturnType<typeof setInterval>>();

	/** Optional callback to push notifications to channel peers. */
	onNotify?: (channelId: string, peerId: string, message: string) => void;

	constructor(options: {
		supervisor: AgentSupervisor;
		config?: TaskLoopConfig;
	}) {
		this.supervisor = options.supervisor;
		this.config = options.config ?? {};

		// Subscribe to supervisor events
		this.unsubSupervisor = this.supervisor.subscribe((event) => {
			this.handleSupervisorEvent(event);
		});
	}

	// ── Preset Registration ───────────────────────────────────────────

	registerPreset(preset: LoopPreset<unknown>): void {
		this.presets.set(preset.name, preset);
	}

	// ── Task Lifecycle ────────────────────────────────────────────────

	/** Create and enqueue a new task. */
	async createTask(opts: CreateTaskOptions): Promise<LoopTask> {
		const preset = this.presets.get(opts.preset);
		if (!preset) {
			throw new Error(`Unknown preset: ${opts.preset}`);
		}

		const taskId = nanoid(12);
		const maxIter = opts.maxIterations ?? this.config.maxIterations ?? 10;
		const maxDur = opts.maxDurationMs ?? this.config.maxDurationMs ?? 4 * 60 * 60 * 1000;

		// Parse preset-specific options
		const presetOptions = preset.parseOptions
			? preset.parseOptions({ ...opts.presetOptions, workDir: opts.workDir })
			: (opts.presetOptions ?? {});

		const task: LoopTask = {
			id: taskId,
			preset: opts.preset,
			state: "queued",
			prompt: opts.prompt,
			workDir: opts.workDir,
			iteration: 0,
			maxIterations: maxIter,
			maxDurationMs: maxDur,
			errorHistory: [],
			confirmPolicy:
				opts.confirmPolicy ?? this.config.defaultConfirmPolicy ?? DEFAULT_CONFIRM_POLICY,
			options: presetOptions,
			triggeredBy: opts.triggeredBy,
			channelPeer: opts.channelPeer as LoopTask["channelPeer"],
			createdAt: Date.now(),
		};

		this.tasks.set(taskId, task);
		this.emit({ type: "task-created", task: { ...task } });

		// Immediately start scheduling
		await this.scheduleTask(task, opts.agentId, opts.worktree);

		return { ...task };
	}

	/** Approve a waiting_confirm task. */
	async approveTask(taskId: string): Promise<void> {
		const task = this.tasks.get(taskId);
		if (!task || task.state !== "waiting_confirm") {
			throw new Error(`Task ${taskId} is not waiting for confirmation`);
		}

		const returnTo = task.previousState;
		if (!returnTo) {
			throw new Error(`Task ${taskId} has no previous state to return to`);
		}

		this.transition(task, returnTo as LoopTaskState);

		// Resume the appropriate phase
		if (returnTo === "executing") {
			await this.resumeExecution(task);
		} else if (returnTo === "verifying") {
			await this.runVerification(task);
		} else if (returnTo === "delivering") {
			await this.runDelivery(task);
		}
	}

	/** Cancel a task. */
	cancelTask(taskId: string): void {
		const task = this.tasks.get(taskId);
		if (!task) throw new Error(`Task ${taskId} not found`);

		if (task.processId) {
			this.supervisor.stop(task.processId).catch(() => {});
			this.processToTask.delete(task.processId);
		}

		this.transition(task, "cancelled");
	}

	/** Resume a blocked task with optional human input. */
	async resumeTask(taskId: string, message?: string): Promise<void> {
		const task = this.tasks.get(taskId);
		if (!task || task.state !== "blocked") {
			throw new Error(`Task ${taskId} is not blocked`);
		}

		// Reset for retry
		this.transition(task, "executing");

		if (task.processId && message) {
			await this.supervisor.resume(task.processId, message);
		} else if (task.processId) {
			await this.supervisor.resume(task.processId, task.prompt);
		}
	}

	// ── Queries ───────────────────────────────────────────────────────

	getTask(taskId: string): LoopTask | undefined {
		const t = this.tasks.get(taskId);
		return t ? { ...t } : undefined;
	}

	listTasks(): LoopTask[] {
		return Array.from(this.tasks.values()).map((t) => ({ ...t }));
	}

	// ── DAG ───────────────────────────────────────────────────────────

	/** Create and start a Task Loop DAG. */
	async createDAG(dagDef: {
		name: string;
		nodes: LoopDAGNode[];
		triggeredBy: "dashboard" | "channel";
		channelPeer?: { channelId: string; peerId: string };
	}): Promise<LoopDAG> {
		// Validate: all presets exist
		for (const node of dagDef.nodes) {
			if (!this.presets.has(node.preset)) {
				throw new Error(`Unknown preset "${node.preset}" in DAG node "${node.id}"`);
			}
		}

		// Validate: no cycles
		if (hasDAGCycle(dagDef.nodes)) {
			throw new Error("DAG contains a cycle");
		}

		const dag: LoopDAG = {
			id: nanoid(12),
			name: dagDef.name,
			nodes: dagDef.nodes.map((n) => ({ ...n })),
			status: "running",
			nodeTaskMap: {},
			createdAt: Date.now(),
		};

		this.dags.set(dag.id, dag);
		this.emit({ type: "dag-created", dag: { ...dag } });

		// Start all root nodes (no dependencies)
		await this.advanceDAG(dag, dagDef.triggeredBy, dagDef.channelPeer);

		return { ...dag };
	}

	getDAG(dagId: string): LoopDAG | undefined {
		const d = this.dags.get(dagId);
		return d ? { ...d, nodeTaskMap: { ...d.nodeTaskMap } } : undefined;
	}

	listDAGs(): LoopDAG[] {
		return Array.from(this.dags.values()).map((d) => ({
			...d,
			nodeTaskMap: { ...d.nodeTaskMap },
		}));
	}

	// ── Event Subscription ────────────────────────────────────────────

	subscribe(handler: (event: TaskLoopEvent) => void): () => void {
		this.eventEmitter.on("event", handler);
		return () => {
			this.eventEmitter.off("event", handler);
		};
	}

	// ── Cleanup ───────────────────────────────────────────────────────

	shutdown(): void {
		if (this.unsubSupervisor) {
			this.unsubSupervisor();
		}
		for (const timer of this.touchTimers.values()) {
			clearInterval(timer);
		}
		this.touchTimers.clear();
	}

	/**
	 * Remove completed/cancelled/blocked tasks older than the given age.
	 * Called periodically or manually to prevent memory buildup.
	 */
	pruneStale(maxAgeMs = 60 * 60_000): number {
		const now = Date.now();
		let pruned = 0;
		for (const [id, task] of this.tasks) {
			if (!["done", "cancelled", "blocked"].includes(task.state)) continue;
			const age = now - (task.completedAt ?? task.createdAt);
			if (age > maxAgeMs) {
				if (task.processId) this.processToTask.delete(task.processId);
				this.tasks.delete(id);
				pruned++;
			}
		}
		return pruned;
	}

	// ── Internal: Scheduling ──────────────────────────────────────────

	private async scheduleTask(task: LoopTask, agentId: string, worktree?: boolean): Promise<void> {
		this.transition(task, "spawning");
		task.startedAt = Date.now();

		try {
			const proc = await this.supervisor.spawn(
				{
					agentId,
					task: task.prompt,
					workDir: task.workDir,
					worktree,
				},
				this.resolveAgentConfig(agentId),
			);

			task.processId = proc.id;
			task.sessionId = proc.externalSessionId;
			task.worktreePath = proc.worktreePath;
			if (proc.worktreePath) {
				task.workDir = proc.worktreePath;
			}
			this.processToTask.set(proc.id, task.id);
			this.transition(task, "executing");
		} catch (err) {
			this.transition(task, "blocked");
			this.emit({
				type: "task-blocked",
				taskId: task.id,
				reason: `启动失败: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	private resolveAgentConfig(agentId: string): Record<string, unknown> {
		// The supervisor's agentConfigResolver handles this
		// We pass a minimal config; the supervisor will resolve full config
		return { id: agentId } as Record<string, unknown>;
	}

	// ── Internal: Supervisor Event Handling ────────────────────────────

	private handleSupervisorEvent(event: SupervisorEvent): void {
		if (event.type === "process-stopped") {
			const taskId = this.processToTask.get(event.processId);
			if (!taskId) return;
			const task = this.tasks.get(taskId);
			if (!task) return;

			if (event.reason === "completed") {
				// Touch immediately to prevent stale eviction during verification
				this.supervisor.touch(event.processId);
				// Agent finished — move to verification
				this.onAgentCompleted(task);
			} else if (event.reason === "error") {
				// Agent crashed
				this.transition(task, "blocked");
				this.emit({
					type: "task-blocked",
					taskId: task.id,
					reason: "智能体进程崩溃",
				});
			}
		}

		if (event.type === "status-change") {
			const taskId = this.processToTask.get(event.processId);
			if (!taskId) return;
			const task = this.tasks.get(taskId);
			if (!task) return;

			// Capture session ID updates
			const proc = this.supervisor.get(event.processId);
			if (proc?.externalSessionId) {
				task.sessionId = proc.externalSessionId;
			}
		}
	}

	private async onAgentCompleted(task: LoopTask): Promise<void> {
		if (task.state !== "executing") return;

		// Check confirm gate before verification
		if (this.confirmGate.shouldConfirm(task, "verifying")) {
			task.previousState = "verifying";
			this.transition(task, "waiting_confirm");
			this.emit({
				type: "waiting-confirm",
				taskId: task.id,
				stage: "verifying",
				reason: "确认策略要求验证前确认",
			});
			return;
		}

		await this.runVerification(task);
	}

	// ── Internal: Verification ────────────────────────────────────────

	private async runVerification(task: LoopTask): Promise<void> {
		const preset = this.presets.get(task.preset);
		if (!preset) return;

		this.transition(task, "verifying");

		try {
			const result = await preset.verifier.verify({
				workDir: task.workDir,
				task,
			});

			task.lastResult = result;
			this.transition(task, "evaluating");

			// Run termination policy
			const elapsed = Date.now() - (task.startedAt ?? task.createdAt);
			const decision = preset.terminationPolicy.judge({
				task,
				lastResult: result,
				elapsed,
			});

			switch (decision.action) {
				case "done":
					this.transition(task, "done");
					task.completedAt = Date.now();
					// Proceed to delivery (task-done emitted after delivery)
					await this.startDelivery(task);
					break;

				case "iterate": {
					// Record error for dead loop detection
					if (!preset.verifier.passed(result)) {
						const errorSummary = this.extractErrorSummary(result);
						task.errorHistory.push(errorSummary);
					}

					task.iteration++;
					this.transition(task, "iterating");
					this.emit({
						type: "iteration",
						taskId: task.id,
						iteration: task.iteration,
						maxIterations: task.maxIterations,
					});

					// Generate feedback and send to agent
					const feedback = preset.feedbackFormatter(result, task);
					this.transition(task, "executing");

					if (task.processId) {
						await this.supervisor.resume(task.processId, feedback);
					}
					break;
				}

				case "blocked":
					this.transition(task, "blocked");
					this.emit({
						type: "task-blocked",
						taskId: task.id,
						reason: decision.reason,
					});
					break;
			}
		} catch (err) {
			this.transition(task, "blocked");
			this.emit({
				type: "task-blocked",
				taskId: task.id,
				reason: `验证执行失败: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// ── Internal: Delivery ────────────────────────────────────────────

	private async startDelivery(task: LoopTask): Promise<void> {
		// Skip delivery for non-final DAG nodes
		if (task.options._skipDelivery) {
			task.deliverResult = { success: true };
			this.emit({ type: "task-done", taskId: task.id, deliverResult: task.deliverResult });
			await this.onDAGTaskCompleted(task);
			return;
		}

		// Check confirm gate before delivery
		if (this.confirmGate.shouldConfirm(task, "delivering")) {
			task.previousState = "delivering";
			this.transition(task, "waiting_confirm");
			this.emit({
				type: "waiting-confirm",
				taskId: task.id,
				stage: "delivering",
				reason: "确认策略要求交付前确认",
			});
			return;
		}

		await this.runDelivery(task);
	}

	private async runDelivery(task: LoopTask): Promise<void> {
		const preset = this.presets.get(task.preset);
		if (!preset) return;

		this.transition(task, "delivering");

		try {
			const result = await preset.deliverer.deliver({
				workDir: task.workDir,
				task,
				lastResult: task.lastResult,
			});

			task.deliverResult = result;

			if (result.success) {
				this.emit({
					type: "task-done",
					taskId: task.id,
					deliverResult: result,
				});
				// Advance DAG if this task is part of one
				await this.onDAGTaskCompleted(task);
			} else {
				this.transition(task, "blocked");
				this.emit({
					type: "task-blocked",
					taskId: task.id,
					reason: `交付失败: ${result.error ?? "未知错误"}`,
				});
			}
		} catch (err) {
			this.transition(task, "blocked");
			this.emit({
				type: "task-blocked",
				taskId: task.id,
				reason: `交付异常: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// ── Internal: Resume execution ────────────────────────────────────

	private async resumeExecution(task: LoopTask): Promise<void> {
		if (task.processId) {
			await this.supervisor.resume(task.processId, "继续执行");
		}
	}

	// ── Internal: Helpers ─────────────────────────────────────────────

	private transition(task: LoopTask, to: LoopTaskState): void {
		const from = task.state;
		assertTransition(from, to);
		task.state = to;

		// Start/stop touch timer for stale eviction protection
		if (to === "waiting_confirm" && task.processId) {
			this.startTouchTimer(task.processId);
		}
		if (from === "waiting_confirm" && task.processId) {
			this.stopTouchTimer(task.processId);
		}

		this.emit({ type: "state-change", taskId: task.id, from, to });
	}

	private startTouchTimer(processId: string): void {
		this.stopTouchTimer(processId);
		// Touch every 5 minutes to prevent 30-min stale eviction
		this.supervisor.touch(processId);
		const timer = setInterval(() => {
			this.supervisor.touch(processId);
		}, 5 * 60_000);
		this.touchTimers.set(processId, timer);
	}

	private stopTouchTimer(processId: string): void {
		const timer = this.touchTimers.get(processId);
		if (timer) {
			clearInterval(timer);
			this.touchTimers.delete(processId);
		}
	}

	private emit(event: TaskLoopEvent): void {
		this.eventEmitter.emit("event", event);
		this.pushNotification(event);
	}

	/** Push notification to channel peer if the task was triggered from a channel. */
	private pushNotification(event: TaskLoopEvent): void {
		if (!this.onNotify) return;

		let taskId: string;
		let message: string;

		switch (event.type) {
			case "task-created":
				taskId = event.task.id;
				message = `Task Loop 已启动: ${event.task.prompt.slice(0, 50)}`;
				break;
			case "iteration":
				taskId = event.taskId;
				message = `迭代 ${event.iteration}/${event.maxIterations}，继续重试中`;
				break;
			case "task-done":
				taskId = event.taskId;
				message = event.deliverResult?.url ? `任务完成: ${event.deliverResult.url}` : "任务完成";
				break;
			case "task-blocked":
				taskId = event.taskId;
				message = `任务阻塞: ${event.reason}\n/task resume ${event.taskId}`;
				break;
			case "waiting-confirm":
				taskId = event.taskId;
				message = `等待确认: ${event.reason}\n/task approve ${event.taskId}`;
				break;
			default:
				return;
		}

		const task = this.tasks.get(taskId);
		if (!task?.channelPeer) return;

		const peer = task.channelPeer;
		this.onNotify(peer.channelId, peer.peerId, message);
	}

	// ── Internal: DAG ─────────────────────────────────────────────────

	/** Advance a DAG: start all nodes whose dependencies are satisfied. */
	private async advanceDAG(
		dag: LoopDAG,
		triggeredBy: "dashboard" | "channel",
		channelPeer?: { channelId: string; peerId: string },
	): Promise<void> {
		if (dag.status !== "running") return;

		for (const node of dag.nodes) {
			// Already started
			if (dag.nodeTaskMap[node.id]) continue;

			// Check if all deps are done
			const depsOk = node.dependsOn.every((depId) => {
				const depTaskId = dag.nodeTaskMap[depId];
				if (!depTaskId) return false;
				const depTask = this.tasks.get(depTaskId);
				return depTask && (depTask.state === "done" || depTask.deliverResult?.success);
			});

			const depsFailed = node.dependsOn.some((depId) => {
				const depTaskId = dag.nodeTaskMap[depId];
				if (!depTaskId) return false;
				const depTask = this.tasks.get(depTaskId);
				return depTask && (depTask.state === "cancelled" || depTask.state === "blocked");
			});

			if (depsFailed) {
				// Skip this node — dep failed
				continue;
			}
			if (!depsOk) continue;

			// Determine if this node should deliver
			const isFinalNode = node.deliver ?? !dag.nodes.some((n) => n.dependsOn.includes(node.id));

			// Create the task for this node
			const task = await this.createTask({
				preset: node.preset,
				prompt: node.prompt,
				workDir: node.workDir,
				agentId: node.agentId,
				worktree: node.worktree,
				triggeredBy,
				channelPeer,
				presetOptions: {
					...node.presetOptions,
					// Skip delivery for non-final nodes
					_skipDelivery: !isFinalNode,
				},
			});

			task.dagId = dag.id;
			task.dagNodeId = node.id;
			dag.nodeTaskMap[node.id] = task.id;
		}

		// Check if all nodes are done or skipped
		this.checkDAGCompletion(dag);
	}

	/** Called after a task in a DAG finishes. Advances downstream nodes. */
	private async onDAGTaskCompleted(task: LoopTask): Promise<void> {
		if (!task.dagId) return;
		const dag = this.dags.get(task.dagId);
		if (!dag || dag.status !== "running") return;

		await this.advanceDAG(
			dag,
			task.triggeredBy,
			task.channelPeer as { channelId: string; peerId: string },
		);
	}

	private checkDAGCompletion(dag: LoopDAG): void {
		const allNodesDone = dag.nodes.every((node) => {
			const taskId = dag.nodeTaskMap[node.id];
			if (!taskId) {
				// Check if this node was skipped due to dep failure
				return node.dependsOn.some((depId) => {
					const depTaskId = dag.nodeTaskMap[depId];
					if (!depTaskId) return false;
					const depTask = this.tasks.get(depTaskId);
					return depTask && (depTask.state === "cancelled" || depTask.state === "blocked");
				});
			}
			const task = this.tasks.get(taskId);
			if (!task) return false;
			return task.state === "done" || task.state === "cancelled" || task.deliverResult != null;
		});

		if (!allNodesDone) return;

		const anyFailed = dag.nodes.some((node) => {
			const taskId = dag.nodeTaskMap[node.id];
			if (!taskId) return true; // skipped = failed dep
			const task = this.tasks.get(taskId);
			return task && (task.state === "blocked" || task.state === "cancelled");
		});

		dag.status = anyFailed ? "failed" : "completed";
		this.emit({ type: "dag-completed", dagId: dag.id, status: dag.status });
	}

	private extractErrorSummary(result: unknown): string {
		if (result && typeof result === "object" && "results" in result) {
			const r = result as { results: Array<{ stderr?: string; stdout?: string }> };
			const failed = r.results.find((x: { stderr?: string }) => x.stderr);
			if (failed) {
				// Take first meaningful error line
				const lines = (failed.stderr ?? failed.stdout ?? "")
					.split("\n")
					.filter((l: string) => l.trim() && !l.startsWith("at "));
				return lines.slice(0, 3).join("\n");
			}
		}
		return String(result).slice(0, 200);
	}
}
