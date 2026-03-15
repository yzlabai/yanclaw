import { API_BASE, apiFetch } from "@yanclaw/web/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

/** Task Loop task state. */
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

/** A Task Loop task. */
export interface LoopTask {
	id: string;
	preset: string;
	state: LoopTaskState;
	prompt: string;
	workDir: string;
	iteration: number;
	maxIterations: number;
	processId?: string;
	deliverResult?: { success: boolean; url?: string; error?: string };
	createdAt: number;
	startedAt?: number;
	completedAt?: number;
}

/** Task Loop event from SSE. */
export type TaskLoopEvent =
	| { type: "task-created"; task: LoopTask }
	| { type: "state-change"; taskId: string; from: LoopTaskState; to: LoopTaskState }
	| { type: "iteration"; taskId: string; iteration: number; maxIterations: number }
	| { type: "task-done"; taskId: string; deliverResult?: LoopTask["deliverResult"] }
	| { type: "task-blocked"; taskId: string; reason: string }
	| { type: "waiting-confirm"; taskId: string; stage: string; reason: string };

/** Hook for managing Task Loop state with SSE real-time updates. */
export function useTaskLoop() {
	const [tasks, setTasks] = useState<LoopTask[]>([]);
	const [loading, setLoading] = useState(true);
	const eventSourceRef = useRef<EventSource | null>(null);

	const refresh = useCallback(async () => {
		try {
			const res = await apiFetch(`${API_BASE}/api/task-loop/tasks`);
			if (res.ok) {
				const data = await res.json();
				setTasks(Array.isArray(data) ? data : []);
			}
		} catch {
			// Task Loop may not be enabled
			setTasks([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();

		const es = new EventSource(`${API_BASE}/api/task-loop/events`);
		eventSourceRef.current = es;

		es.onmessage = (e) => {
			const event: TaskLoopEvent = JSON.parse(e.data);

			switch (event.type) {
				case "task-created":
					setTasks((prev) => [...prev, event.task]);
					break;
				case "state-change":
					setTasks((prev) =>
						prev.map((t) => (t.id === event.taskId ? { ...t, state: event.to } : t)),
					);
					break;
				case "iteration":
					setTasks((prev) =>
						prev.map((t) => (t.id === event.taskId ? { ...t, iteration: event.iteration } : t)),
					);
					break;
				case "task-done":
					setTasks((prev) =>
						prev.map((t) =>
							t.id === event.taskId
								? { ...t, state: "done" as const, deliverResult: event.deliverResult }
								: t,
						),
					);
					break;
				case "task-blocked":
					setTasks((prev) =>
						prev.map((t) => (t.id === event.taskId ? { ...t, state: "blocked" as const } : t)),
					);
					break;
				case "waiting-confirm":
					setTasks((prev) =>
						prev.map((t) =>
							t.id === event.taskId ? { ...t, state: "waiting_confirm" as const } : t,
						),
					);
					break;
			}
		};

		// Re-sync full task list on reconnect (events may have been missed)
		es.onerror = () => {
			refresh();
		};

		return () => {
			es.close();
		};
	}, [refresh]);

	const createTask = useCallback(
		async (config: {
			preset: string;
			prompt: string;
			workDir: string;
			agentId: string;
			worktree?: boolean;
			maxIterations?: number;
			presetOptions?: Record<string, unknown>;
		}) => {
			const res = await apiFetch(`${API_BASE}/api/task-loop/tasks`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(config),
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? "Task creation failed");
			}
			return (await res.json()) as LoopTask;
		},
		[],
	);

	const approveTask = useCallback(async (taskId: string) => {
		await apiFetch(`${API_BASE}/api/task-loop/tasks/${taskId}/approve`, {
			method: "POST",
		});
	}, []);

	const cancelTask = useCallback(async (taskId: string) => {
		await apiFetch(`${API_BASE}/api/task-loop/tasks/${taskId}/cancel`, {
			method: "POST",
		});
	}, []);

	const resumeTask = useCallback(async (taskId: string, message?: string) => {
		await apiFetch(`${API_BASE}/api/task-loop/tasks/${taskId}/resume`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message }),
		});
	}, []);

	return {
		tasks,
		loading,
		refresh,
		createTask,
		approveTask,
		cancelTask,
		resumeTask,
	};
}
