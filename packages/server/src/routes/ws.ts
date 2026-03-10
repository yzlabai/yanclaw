import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { getGateway } from "../gateway";
import { wsTicketStore } from "../security/ws-ticket";
import { chatSteering } from "./chat";

const { upgradeWebSocket } = createBunWebSocket();

// Track connected WebSocket clients with their subscriptions
interface ClientState {
	ws: WSContext;
	subscriptions: Set<string>;
	activeSessions: Set<string>;
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

export const wsRoute = new Hono()
	.post("/ticket", async (c) => {
		// Authenticated endpoint (auth middleware already applied) to issue a WS ticket
		const ticket = wsTicketStore.issue();
		return c.json({ ticket });
	})
	.get(
		"/",
		upgradeWebSocket((c) => {
			// Validate ticket from query parameter
			const url = new URL(c.req.url);
			const ticket = url.searchParams.get("ticket");
			const ticketValid = wsTicketStore.consume(ticket);

			return {
				onOpen(_evt, ws) {
					if (!ticketValid) {
						ws.close(4001, "Invalid or expired ticket");
						return;
					}
					clients.set(ws, {
						ws,
						subscriptions: new Set(),
						activeSessions: new Set(),
					});
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

								// Track active session for cleanup on disconnect
								const clientState = clients.get(ws);
								clientState?.activeSessions.add(sessionKey);

								const config = gw.config.get();

								// Run with steering support — loop to drain pending messages
								const runWithSteering = async (msg: string) => {
									const signal = chatSteering.register(sessionKey);
									const events = gw.agentRuntime.run({
										agentId,
										sessionKey,
										message: msg,
										config,
										signal,
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

									// Check for queued steering messages
									const next = chatSteering.dequeue(sessionKey);
									if (!next) {
										chatSteering.unregister(sessionKey);
									} else {
										ws.send(
											JSON.stringify({
												jsonrpc: "2.0",
												method: "chat.steering_resume",
												params: {
													sessionKey,
													message: next,
												},
											}),
										);
										await runWithSteering(next);
									}
								};

								await runWithSteering(message);
								clientState?.activeSessions.delete(sessionKey);
								break;
							}

							case "chat.steer": {
								const sessionKey = String(params?.sessionKey ?? "");
								const message = String(params?.message ?? "");

								if (!sessionKey || !message) {
									ws.send(jsonRpcError(id, -32602, "Missing sessionKey or message"));
									return;
								}

								if (!chatSteering.isActive(sessionKey)) {
									ws.send(
										jsonRpcResult(id, {
											intent: "none",
											queued: false,
										}),
									);
									return;
								}

								const result = chatSteering.steer(sessionKey, message);
								ws.send(jsonRpcResult(id, result));
								break;
							}

							case "chat.cancel": {
								const sessionKey = String(params?.sessionKey ?? "");
								if (sessionKey && chatSteering.isActive(sessionKey)) {
									chatSteering.steer(sessionKey, "cancel");
								}
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
						ws.send(
							jsonRpcError(id, -32603, err instanceof Error ? err.message : "Internal error"),
						);
					}
				},

				onClose(_evt, ws) {
					const state = clients.get(ws);
					if (state) {
						for (const sessionKey of state.activeSessions) {
							chatSteering.remove(sessionKey);
						}
					}
					clients.delete(ws);
				},
			};
		}),
	);
