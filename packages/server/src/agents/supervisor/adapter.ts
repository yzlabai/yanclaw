import type { AgentEvent } from "../runtime";

/** Options passed to an adapter when spawning an agent. */
export interface AdapterSpawnOptions {
	/** Working directory for the agent. */
	workDir: string;
	/** Task description / initial prompt. */
	task?: string;
	/** System prompt. */
	systemPrompt?: string;
	/** Model override. */
	model?: string;
	/** Resume from a previous session. */
	resumeSessionId?: string;
	/** Abort signal. */
	signal?: AbortSignal;
	/** Extra environment variables. */
	env?: Record<string, string>;
}

/** Result of spawning an adapter. */
export interface AdapterSpawnResult {
	/** OS process ID (if applicable). */
	pid?: number;
	/** External session ID (for later resume). */
	sessionId?: string;
}

/** Permission response from the user. */
export interface PermissionResponse {
	requestId: string;
	allowed: boolean;
}

/**
 * Common interface for all agent tool adapters.
 * Each adapter wraps a specific external agent (Claude Code, Codex, Gemini, etc.)
 * and translates its protocol into a unified AgentEvent stream.
 */
export interface AgentAdapter {
	/** Adapter type identifier. */
	readonly type: string;

	/** Spawn the agent process. Resolves when the agent is ready. */
	spawn(options: AdapterSpawnOptions): Promise<AdapterSpawnResult>;

	/** Send a follow-up message/instruction to the running agent. */
	send(message: string): Promise<void>;

	/** Respond to a permission request from the agent. */
	respondPermission(requestId: string, allowed: boolean): Promise<void>;

	/** Stop the agent process. */
	stop(): Promise<void>;

	/** Whether the adapter's process is still alive. */
	isAlive(): boolean;

	/** Subscribe to agent events. Returns unsubscribe function. */
	onEvent(handler: (event: AgentEvent) => void): () => void;

	/** Subscribe to permission requests. Returns unsubscribe function. */
	onPermissionRequest?(
		handler: (request: {
			requestId: string;
			tool: string;
			args: unknown;
			description: string;
		}) => void,
	): () => void;
}
