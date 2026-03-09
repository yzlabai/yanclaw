import type { AppType } from "@yanclaw/server/app";
import { hc } from "hono/client";

const API_BASE = "http://localhost:18789";
const WS_BASE = "ws://localhost:18789";

export const client = hc<AppType>(API_BASE);

export function createWebSocket(): WebSocket {
	return new WebSocket(`${WS_BASE}/api/ws`);
}

export type AgentEvent =
	| { type: "delta"; sessionKey: string; text: string }
	| { type: "tool_call"; sessionKey: string; name: string; args: unknown }
	| { type: "tool_result"; sessionKey: string; name: string; result: unknown; duration: number }
	| { type: "done"; sessionKey: string; usage: { promptTokens: number; completionTokens: number } }
	| { type: "error"; sessionKey: string; message: string };

export async function sendChatMessage(
	agentId: string,
	sessionKey: string,
	message: string,
	onEvent: (event: AgentEvent) => void,
): Promise<void> {
	const res = await fetch(`${API_BASE}/api/chat/send`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ agentId, sessionKey, message }),
	});

	if (!res.ok) {
		throw new Error(`Chat request failed: ${res.status}`);
	}

	const reader = res.body?.getReader();
	if (!reader) return;

	const decoder = new TextDecoder();
	let buffer = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line) as AgentEvent;
				onEvent(event);
			} catch {
				// skip malformed lines
			}
		}
	}
}
