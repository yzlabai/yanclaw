import type { LoopDAGNode, LoopTaskState } from "./types";

/** Valid state transitions for the Task Loop state machine. */
const TRANSITIONS: Record<LoopTaskState, LoopTaskState[]> = {
	queued: ["spawning"],
	spawning: ["executing", "blocked"],
	executing: ["verifying", "blocked", "waiting_confirm"],
	verifying: ["evaluating", "waiting_confirm"],
	evaluating: ["done", "iterating", "blocked"],
	iterating: ["executing"],
	done: ["delivering"],
	delivering: ["blocked", "waiting_confirm"], // terminal on success (removed from map)
	blocked: ["executing", "cancelled"],
	waiting_confirm: ["executing", "verifying", "delivering", "cancelled"],
	cancelled: [], // terminal
};

/** Check whether a state transition is valid. */
export function canTransition(from: LoopTaskState, to: LoopTaskState): boolean {
	return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Assert a state transition is valid; throw if not. */
export function assertTransition(from: LoopTaskState, to: LoopTaskState): void {
	if (!canTransition(from, to)) {
		throw new Error(`Invalid task loop state transition: ${from} → ${to}`);
	}
}

/** Whether a state is terminal (no further transitions possible). */
export function isTerminal(state: LoopTaskState): boolean {
	return state === "cancelled";
	// Note: "delivering" is terminal on success but can transition to blocked/waiting_confirm on failure.
	// The controller handles the final removal after successful delivery.
}

/** Whether the task is in an active (non-terminal, non-blocked) state. */
export function isActive(state: LoopTaskState): boolean {
	return !["done", "delivering", "blocked", "waiting_confirm", "cancelled"].includes(state);
}

/** Detect cycles in a DAG node list via DFS. */
export function hasDAGCycle(nodes: Pick<LoopDAGNode, "id" | "dependsOn">[]): boolean {
	const visited = new Set<string>();
	const visiting = new Set<string>();

	const dfs = (id: string): boolean => {
		if (visiting.has(id)) return true;
		if (visited.has(id)) return false;
		visiting.add(id);
		const node = nodes.find((n) => n.id === id);
		if (node) {
			for (const dep of node.dependsOn) {
				if (dfs(dep)) return true;
			}
		}
		visiting.delete(id);
		visited.add(id);
		return false;
	};

	return nodes.some((n) => dfs(n.id));
}
