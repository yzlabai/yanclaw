import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";

const { upgradeWebSocket } = createBunWebSocket();

export const wsRoute = new Hono().get(
	"/",
	upgradeWebSocket(() => ({
		onOpen(_evt, ws) {
			console.log("WebSocket client connected");
			ws.send(JSON.stringify({ type: "connected" }));
		},
		onMessage(evt, ws) {
			// TODO: JSON-RPC message dispatch
			console.log("WebSocket message:", evt.data);
		},
		onClose() {
			console.log("WebSocket client disconnected");
		},
	})),
);
