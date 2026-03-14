import { API_BASE } from "@yanclaw/web/lib/api";
import { useEffect, useRef, useState } from "react";
import type { AgentEvent } from "./useAgentHub";

/** Accumulated message from streaming events. */
export interface StreamMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	thinking?: string;
	toolCalls: Array<{
		name: string;
		args: unknown;
		result?: unknown;
		duration?: number;
		status: "pending" | "done";
	}>;
	timestamp: number;
}

/** Upsert the current message ref into the messages array. */
function upsertCurrentMsg(prev: StreamMessage[], current: StreamMessage | null): StreamMessage[] {
	if (!current) return prev;
	const snapshot = { ...current, toolCalls: [...current.toolCalls] };
	const idx = prev.findIndex((m) => m.id === current.id);
	if (idx >= 0) {
		const next = [...prev];
		next[idx] = snapshot;
		return next;
	}
	return [...prev, snapshot];
}

/** Hook that connects to SSE for a single process and accumulates messages. */
export function useProcessEvents(processId: string | null) {
	const [messages, setMessages] = useState<StreamMessage[]>([]);
	const [connected, setConnected] = useState(false);
	const currentMsgRef = useRef<StreamMessage | null>(null);
	const msgCounterRef = useRef(0);

	useEffect(() => {
		if (!processId) return;

		setMessages([]);
		currentMsgRef.current = null;
		msgCounterRef.current = 0;

		const es = new EventSource(`${API_BASE}/api/agent-hub/processes/${processId}/events`);

		es.onopen = () => setConnected(true);
		es.onerror = () => setConnected(false);

		es.onmessage = (e) => {
			const supervisorEvent = JSON.parse(e.data);
			if (supervisorEvent.type !== "agent-event") return;
			const event: AgentEvent = supervisorEvent.event;

			switch (event.type) {
				case "delta": {
					if (!currentMsgRef.current) {
						currentMsgRef.current = {
							id: `msg-${++msgCounterRef.current}`,
							role: "assistant",
							content: "",
							toolCalls: [],
							timestamp: Date.now(),
						};
					}
					currentMsgRef.current.content += event.text ?? "";
					setMessages((prev) => upsertCurrentMsg(prev, currentMsgRef.current));
					break;
				}

				case "thinking": {
					if (!currentMsgRef.current) {
						currentMsgRef.current = {
							id: `msg-${++msgCounterRef.current}`,
							role: "assistant",
							content: "",
							toolCalls: [],
							timestamp: Date.now(),
						};
					}
					currentMsgRef.current.thinking =
						(currentMsgRef.current.thinking ?? "") + (event.text ?? "");
					setMessages((prev) => upsertCurrentMsg(prev, currentMsgRef.current));
					break;
				}

				case "tool_call": {
					if (!currentMsgRef.current) {
						currentMsgRef.current = {
							id: `msg-${++msgCounterRef.current}`,
							role: "assistant",
							content: "",
							toolCalls: [],
							timestamp: Date.now(),
						};
					}
					currentMsgRef.current.toolCalls.push({
						name: event.name ?? "unknown",
						args: event.args,
						status: "pending",
					});
					setMessages((prev) => upsertCurrentMsg(prev, currentMsgRef.current));
					break;
				}

				case "tool_result": {
					if (currentMsgRef.current) {
						const tc = currentMsgRef.current.toolCalls.find(
							(t) => t.name === event.name && t.status === "pending",
						);
						if (tc) {
							tc.result = event.result;
							tc.duration = event.duration;
							tc.status = "done";
						}
						setMessages((prev) => upsertCurrentMsg(prev, currentMsgRef.current));
					}
					break;
				}

				case "done":
				case "aborted":
				case "error": {
					// Finalize current message
					currentMsgRef.current = null;
					break;
				}
			}
		};

		return () => {
			es.close();
			setConnected(false);
		};
	}, [processId]);

	const addUserMessage = (text: string) => {
		setMessages((prev) => [
			...prev,
			{
				id: `msg-${++msgCounterRef.current}`,
				role: "user",
				content: text,
				toolCalls: [],
				timestamp: Date.now(),
			},
		]);
	};

	return { messages, connected, addUserMessage };
}
