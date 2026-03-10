import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { getGateway } from "../gateway";

const { upgradeWebSocket } = createBunWebSocket();

// Track connected WebSocket clients with their subscriptions
interface ClientState {
	ws: WSContext;
	subscriptions: Set<string>;
}

const clients = new Map<WSContext, ClientState>();

/** Check if a topic matches a subscription pattern (supports wildcards like "chat.*"). */
function topicMatches(pattern: string, topic: string): boolean {
	if (pattern === "*") return true;
	if (pattern === topic) return true;
	if (pattern.endsWith(".*")) {
		const prefix = pattern.slice(0, -1);
		return topic.startsWith(prefix);
	}
	return false;
}

export function broadcastEvent(event: unknown): void {
	const data = JSON.stringify(event);
	const eventMethod = (event as { method?: string }).method;

	for (const [ws, state] of clients) {
		try {
			// If client has subscriptions, filter by topic
			if (state.subscriptions.size > 0 && eventMethod) {
				let matched = false;
				for (const sub of state.subscriptions) {
					if (topicMatches(sub, eventMethod)) {
						matched = true;
						break;
					}
				}
				if (!matched) continue;
			}
			ws.send(data);
		} catch {
			clients.delete(ws);
		}
	}
}

function jsonRpcError(id: unknown, code: number, message: string) {
	return JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
}

function jsonRpcResult(id: unknown, result: unknown) {
	return JSON.stringify({ jsonrpc: "2.0", id, result });
}

export const wsRoute = new Hono().get(
	"/",
	upgradeWebSocket(() => ({
		onOpen(_evt, ws) {
			clients.set(ws, { ws, subscriptions: new Set() });
			ws.send(
				JSON.stringify({
					jsonrpc: "2.0",
					method: "system.connected",
					params: { message: "YanClaw Gateway" },
				}),
			);
		},

		async onMessage(evt, ws) {
			let parsed: {
				jsonrpc?: string;
				id?: unknown;
				method?: string;
				params?: Record<string, unknown>;
			};

			try {
				parsed = JSON.parse(String(evt.data));
			} catch {
				ws.send(jsonRpcError(null, -32700, "Parse error"));
				return;
			}

			const { id, method, params } = parsed;

			if (!method) {
				ws.send(jsonRpcError(id, -32600, "Invalid Request: missing method"));
				return;
			}

			const gw = getGateway();

			try {
				switch (method) {
					case "chat.send": {
						const agentId = String(params?.agentId ?? "main");
						const sessionKey = String(params?.sessionKey ?? "agent:main:main");
						const message = String(params?.message ?? "");

						if (!message) {
							ws.send(jsonRpcError(id, -32602, "Missing message"));
							return;
						}

						ws.send(jsonRpcResult(id, { status: "streaming" }));

						const config = gw.config.get();

						const events = gw.agentRuntime.run({
							agentId,
							sessionKey,
							message,
							config,
						});

						for await (const event of events) {
							const rpcMethod = `chat.${event.type}`;
							ws.send(
								JSON.stringify({
									jsonrpc: "2.0",
									method: rpcMethod,
									params: event,
								}),
							);
						}
						break;
					}

					case "chat.cancel": {
						// TODO: implement cancellation
						ws.send(jsonRpcResult(id, { cancelled: true }));
						break;
					}

					case "subscribe": {
						const topics = params?.topics;
						if (!Array.isArray(topics) || topics.length === 0) {
							ws.send(jsonRpcError(id, -32602, "Missing or invalid params: topics (string[])"));
							break;
						}
						const state = clients.get(ws);
						if (state) {
							for (const t of topics) {
								state.subscriptions.add(String(t));
							}
						}
						ws.send(
							jsonRpcResult(id, {
								subscribed: topics,
								total: state?.subscriptions.size ?? 0,
							}),
						);
						break;
					}

					case "unsubscribe": {
						const unsubs = params?.topics;
						if (!Array.isArray(unsubs) || unsubs.length === 0) {
							ws.send(jsonRpcError(id, -32602, "Missing or invalid params: topics (string[])"));
							break;
						}
						const st = clients.get(ws);
						if (st) {
							for (const t of unsubs) {
								st.subscriptions.delete(String(t));
							}
						}
						ws.send(
							jsonRpcResult(id, {
								unsubscribed: unsubs,
								total: st?.subscriptions.size ?? 0,
							}),
						);
						break;
					}

					case "approval.respond": {
						const approvalId = String(params?.id ?? "");
						const decision = String(params?.decision ?? "");

						if (!approvalId || (decision !== "approved" && decision !== "denied")) {
							ws.send(
								jsonRpcError(
									id,
									-32602,
									"Missing or invalid params: id (string), decision ('approved' | 'denied')",
								),
							);
							break;
						}

						const found = gw.approvalManager.respond(approvalId, decision);
						ws.send(jsonRpcResult(id, { success: found }));
						break;
					}

					default:
						ws.send(jsonRpcError(id, -32601, `Method not found: ${method}`));
				}
			} catch (err) {
				ws.send(jsonRpcError(id, -32603, err instanceof Error ? err.message : "Internal error"));
			}
		},

		onClose(_evt, ws) {
			clients.delete(ws);
		},
	})),
);
