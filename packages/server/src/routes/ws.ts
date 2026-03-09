import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import { getGateway } from "../gateway";

const { upgradeWebSocket } = createBunWebSocket();

// Track connected WebSocket clients
const clients = new Set<WSContext>();

export function broadcastEvent(event: unknown): void {
	const data = JSON.stringify(event);
	for (const ws of clients) {
		try {
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
			clients.add(ws);
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

						const gw = getGateway();
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

					case "approval.respond": {
						// TODO: wire to approval manager
						ws.send(jsonRpcResult(id, { received: true }));
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
