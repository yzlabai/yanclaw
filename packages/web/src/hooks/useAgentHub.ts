import { API_BASE, apiFetch } from "@yanclaw/web/lib/api";
import { useCallback, useEffect, useRef, useState } from "react";

/** Agent process status. */
export type AgentProcessStatus =
	| "starting"
	| "running"
	| "waiting-approval"
	| "idle"
	| "stopped"
	| "error";

/** A managed agent process from the Supervisor. */
export interface AgentProcess {
	id: string;
	agentId: string;
	type: string;
	status: AgentProcessStatus;
	pid?: number;
	workDir: string;
	sessionKey: string;
	task?: string;
	worktreePath?: string;
	startedAt: number;
	lastActivityAt: number;
	tokenUsage: { input: number; output: number };
	error?: string;
}

/** A pending permission request. */
export interface PermissionRequest {
	requestId: string;
	processId: string;
	tool: string;
	args: unknown;
	description: string;
	risk: "low" | "medium" | "high";
	createdAt: number;
	timeoutMs: number;
}

/** Supervisor event from SSE. */
export type SupervisorEvent =
	| { type: "process-started"; process: AgentProcess }
	| { type: "process-stopped"; processId: string; reason: string }
	| { type: "status-change"; processId: string; status: AgentProcessStatus }
	| { type: "permission-request"; request: PermissionRequest }
	| { type: "permission-resolved"; requestId: string; allowed: boolean }
	| { type: "agent-event"; processId: string; event: AgentEvent };

/** Agent event types. */
export interface AgentEvent {
	type: string;
	sessionKey: string;
	text?: string;
	name?: string;
	args?: unknown;
	result?: unknown;
	message?: string;
	usage?: { promptTokens: number; completionTokens: number };
	// biome-ignore lint/suspicious/noExplicitAny: flexible event shape
	[key: string]: any;
}

/** Hook for managing agent hub state with SSE real-time updates. */
export function useAgentHub() {
	const [processes, setProcesses] = useState<AgentProcess[]>([]);
	const [pendingApprovals, setPendingApprovals] = useState<PermissionRequest[]>([]);
	const [loading, setLoading] = useState(true);
	const eventSourceRef = useRef<EventSource | null>(null);

	// Fetch initial state
	const refresh = useCallback(async () => {
		try {
			const res = await apiFetch(`${API_BASE}/api/agent-hub/processes`);
			if (res.ok) {
				const data = await res.json();
				setProcesses(data.processes);
				setPendingApprovals(data.pendingApprovals);
			}
		} finally {
			setLoading(false);
		}
	}, []);

	// Connect to SSE for real-time updates
	useEffect(() => {
		refresh();

		const es = new EventSource(`${API_BASE}/api/agent-hub/events`);
		eventSourceRef.current = es;

		es.onmessage = (e) => {
			const event: SupervisorEvent = JSON.parse(e.data);

			switch (event.type) {
				case "process-started":
					setProcesses((prev) => [...prev, event.process]);
					break;
				case "process-stopped":
					setProcesses((prev) =>
						prev.map((p) => (p.id === event.processId ? { ...p, status: "stopped" as const } : p)),
					);
					break;
				case "status-change":
					setProcesses((prev) =>
						prev.map((p) => (p.id === event.processId ? { ...p, status: event.status } : p)),
					);
					break;
				case "permission-request":
					setPendingApprovals((prev) => [...prev, event.request]);
					break;
				case "permission-resolved":
					setPendingApprovals((prev) => prev.filter((r) => r.requestId !== event.requestId));
					break;
			}
		};

		es.onerror = () => {
			// Will auto-reconnect
		};

		return () => {
			es.close();
		};
	}, [refresh]);

	// Actions
	const spawn = useCallback(
		async (config: {
			agentId: string;
			task?: string;
			workDir?: string;
			worktree?: boolean;
			systemPrompt?: string;
			model?: string;
		}) => {
			const res = await apiFetch(`${API_BASE}/api/agent-hub/spawn`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(config),
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? "Spawn failed");
			}
			const data = await res.json();
			return data.process as AgentProcess;
		},
		[],
	);

	const stop = useCallback(async (processId: string) => {
		await apiFetch(`${API_BASE}/api/agent-hub/processes/${processId}/stop`, {
			method: "POST",
		});
	}, []);

	const send = useCallback(async (processId: string, message: string) => {
		await apiFetch(`${API_BASE}/api/agent-hub/processes/${processId}/send`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message }),
		});
	}, []);

	const approve = useCallback(async (processId: string, requestId: string, allowed: boolean) => {
		await apiFetch(`${API_BASE}/api/agent-hub/processes/${processId}/approve`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ requestId, allowed }),
		});
	}, []);

	const getWorktreeInfo = useCallback(async (processId: string) => {
		const res = await apiFetch(`${API_BASE}/api/agent-hub/processes/${processId}/worktree`);
		if (!res.ok) return null;
		const data = await res.json();
		return data.worktree as {
			path: string;
			branch: string;
			commitCount: number;
			changedFiles: number;
		};
	}, []);

	const removeWorktree = useCallback(async (processId: string) => {
		await apiFetch(`${API_BASE}/api/agent-hub/processes/${processId}/worktree`, {
			method: "DELETE",
		});
	}, []);

	const startDAG = useCallback(
		async (dag: {
			id: string;
			name: string;
			tasks: Array<{
				id: string;
				agentId: string;
				task: string;
				dependsOn?: string[];
				workDir?: string;
				worktree?: boolean;
			}>;
		}) => {
			const res = await apiFetch(`${API_BASE}/api/agent-hub/dags`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(dag),
			});
			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.error ?? "DAG creation failed");
			}
			return (await res.json()).dag;
		},
		[],
	);

	const listDAGs = useCallback(async () => {
		const res = await apiFetch(`${API_BASE}/api/agent-hub/dags`);
		if (!res.ok) return [];
		return (await res.json()).dags as Array<{
			id: string;
			name: string;
			status: string;
			createdAt: number;
			tasks: Array<{
				id: string;
				agentId: string;
				task: string;
				status: string;
				dependsOn: string[];
				processId?: string;
				error?: string;
			}>;
		}>;
	}, []);

	return {
		processes,
		pendingApprovals,
		loading,
		refresh,
		spawn,
		stop,
		send,
		approve,
		getWorktreeInfo,
		removeWorktree,
		startDAG,
		listDAGs,
	};
}
