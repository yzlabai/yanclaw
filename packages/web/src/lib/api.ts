import type { AppType } from "@yanclaw/server/app";
import { hc } from "hono/client";
import { getAuthToken } from "./tauri";

export const API_BASE = "http://localhost:18789";
const WS_BASE = "ws://localhost:18789";

/** Cached auth token for the session. */
let cachedToken: string | null = null;

/** Get auth token (from Tauri IPC, env, or localStorage). */
async function resolveAuthToken(): Promise<string | null> {
	if (cachedToken) return cachedToken;

	// Try Tauri IPC first
	const tauriToken = await getAuthToken();
	if (tauriToken) {
		cachedToken = tauriToken;
		return cachedToken;
	}

	// Fall back to localStorage (for dev/browser mode)
	cachedToken = localStorage.getItem("yanclaw_auth_token");
	return cachedToken;
}

/** Set auth token manually (e.g., from a login form or dev tools). */
export function setAuthToken(token: string): void {
	cachedToken = token;
	localStorage.setItem("yanclaw_auth_token", token);
}

/** Fetch wrapper that automatically attaches Authorization header. */
export async function apiFetch(
	input: string | URL | Request,
	init?: RequestInit,
): Promise<Response> {
	const token = await resolveAuthToken();
	const headers = new Headers(init?.headers);
	if (token) {
		headers.set("Authorization", `Bearer ${token}`);
	}
	if (!headers.has("Content-Type") && init?.body && typeof init.body === "string") {
		headers.set("Content-Type", "application/json");
	}
	return fetch(input, { ...init, headers });
}

/** Upload a file to the media endpoint. Returns the media URL. */
export async function uploadMedia(
	file: File,
	sessionKey?: string,
): Promise<{ id: string; filename: string; mimeType: string; size: number }> {
	const form = new FormData();
	form.append("file", file);
	if (sessionKey) form.append("sessionKey", sessionKey);
	form.append("source", "webchat");

	const token = await resolveAuthToken();
	const headers: Record<string, string> = {};
	if (token) headers.Authorization = `Bearer ${token}`;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 60_000);

	const res = await fetch(`${API_BASE}/api/media/upload`, {
		method: "POST",
		headers,
		body: form,
		signal: controller.signal,
	}).finally(() => clearTimeout(timer));

	if (!res.ok) {
		const body = await res.json().catch(() => ({}));
		throw new Error((body as { error?: string }).error ?? `Upload failed: ${res.status}`);
	}
	return res.json();
}

export const client = hc<AppType>(API_BASE);

/** Get a one-time ticket for WebSocket authentication. */
async function getWsTicket(): Promise<string | null> {
	try {
		const res = await apiFetch(`${API_BASE}/api/ws/ticket`, { method: "POST" });
		if (!res.ok) return null;
		const data = (await res.json()) as { ticket: string };
		return data.ticket;
	} catch {
		return null;
	}
}

export async function createWebSocket(): Promise<WebSocket> {
	const ticket = await getWsTicket();
	const params = ticket ? `?ticket=${ticket}` : "";
	return new WebSocket(`${WS_BASE}/api/ws${params}`);
}

export type AgentEvent =
	| { type: "delta"; sessionKey: string; text: string }
	| { type: "thinking"; sessionKey: string; text: string }
	| { type: "tool_call"; sessionKey: string; name: string; args: unknown }
	| { type: "tool_result"; sessionKey: string; name: string; result: unknown; duration: number }
	| { type: "done"; sessionKey: string; usage: { promptTokens: number; completionTokens: number } }
	| { type: "aborted"; sessionKey: string; partial: string }
	| { type: "error"; sessionKey: string; message: string }
	| { type: "steering_resume"; sessionKey: string; message: string };

export async function sendChatMessage(
	agentId: string,
	sessionKey: string,
	message: string,
	onEvent: (event: AgentEvent) => void,
	imageUrls?: string[],
): Promise<void> {
	const res = await apiFetch(`${API_BASE}/api/chat/send`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ agentId, sessionKey, message, imageUrls }),
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

/** Send a steering message while the agent is still streaming. */
export async function steerChat(
	sessionKey: string,
	message: string,
	intent?: "cancel" | "redirect" | "supplement" | "aside",
): Promise<{ intent: string; queued: boolean; answer?: string | null }> {
	const res = await apiFetch(`${API_BASE}/api/chat/steer`, {
		method: "POST",
		body: JSON.stringify({ sessionKey, message, ...(intent && { intent }) }),
	});
	if (!res.ok) throw new Error(`Steer failed: ${res.status}`);
	return res.json();
}

/** Cancel the active agent run for a session. */
export async function cancelChat(sessionKey: string): Promise<void> {
	const res = await apiFetch(`${API_BASE}/api/chat/cancel`, {
		method: "POST",
		body: JSON.stringify({ sessionKey }),
	});
	if (!res.ok) throw new Error(`Cancel failed: ${res.status}`);
}
