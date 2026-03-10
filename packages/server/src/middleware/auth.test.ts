import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

// Mock getGateway before importing auth middleware
const mockGetGateway = vi.fn();
vi.mock("../gateway", () => ({
	getGateway: () => mockGetGateway(),
}));

// Import after mock setup
const { authMiddleware } = await import("./auth");

function createApp(token: string) {
	mockGetGateway.mockReturnValue({
		config: { get: () => ({ gateway: { auth: { token } } }) },
	});

	const app = new Hono();
	app.use("*", authMiddleware);
	app.get("/api/system/health", (c) => c.json({ ok: true }));
	app.get("/api/system/setup", (c) => c.json({ needsSetup: false }));
	app.get("/api/agents", (c) => c.json([]));
	app.post("/api/chat/send", (c) => c.json({ sent: true }));
	return app;
}

describe("authMiddleware", () => {
	it("allows public health endpoint without token", async () => {
		const app = createApp("secret");
		const res = await app.request("/api/system/health");
		expect(res.status).toBe(200);
	});

	it("allows public setup endpoint without token", async () => {
		const app = createApp("secret");
		const res = await app.request("/api/system/setup");
		expect(res.status).toBe(200);
	});

	it("rejects request without Authorization header", async () => {
		const app = createApp("secret");
		const res = await app.request("/api/agents");
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toMatch(/Missing Authorization/);
	});

	it("rejects request with wrong token", async () => {
		const app = createApp("secret");
		const res = await app.request("/api/agents", {
			headers: { Authorization: "Bearer wrong-token" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toMatch(/Invalid auth token/);
	});

	it("rejects request with malformed Authorization header", async () => {
		const app = createApp("secret");
		const res = await app.request("/api/agents", {
			headers: { Authorization: "Basic abc123" },
		});
		expect(res.status).toBe(401);
		const body = await res.json();
		expect(body.error).toMatch(/Invalid Authorization format/);
	});

	it("allows request with correct Bearer token", async () => {
		const app = createApp("my-secret-token");
		const res = await app.request("/api/agents", {
			headers: { Authorization: "Bearer my-secret-token" },
		});
		expect(res.status).toBe(200);
	});

	it("skips auth for WebSocket upgrade requests", async () => {
		const app = createApp("secret");
		const res = await app.request("/api/ws", {
			headers: { Upgrade: "websocket" },
		});
		// 404 because no ws route registered, but NOT 401
		expect(res.status).not.toBe(401);
	});

	it("rejects when no token is configured (empty token)", async () => {
		const app = createApp("");
		const res = await app.request("/api/agents", {
			headers: { Authorization: "Bearer anything" },
		});
		expect(res.status).toBe(401);
	});
});
