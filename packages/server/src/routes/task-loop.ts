import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { getGateway } from "../gateway";

const createTaskSchema = z.object({
	preset: z.string().min(1),
	prompt: z.string().min(1),
	workDir: z.string().min(1),
	agentId: z.string().min(1),
	worktree: z.boolean().default(false),
	confirmPolicy: z
		.object({
			operations: z.array(z.string()).default([]),
			stages: z.array(z.enum(["executing", "verifying", "delivering"])).default(["delivering"]),
			riskThreshold: z.enum(["low", "medium", "high", "none"]).default("none"),
		})
		.optional(),
	maxIterations: z.number().optional(),
	maxDurationMs: z.number().optional(),
	triggeredBy: z.enum(["dashboard", "channel"]).default("dashboard"),
	presetOptions: z.record(z.unknown()).optional(),
});

export const taskLoopRoute = new Hono()
	// ── Create Task ───────────────────────────────────────────────────
	.post("/tasks", zValidator("json", createTaskSchema), async (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}

		const body = c.req.valid("json");
		const task = await gw.taskLoop.createTask(body);
		return c.json(task, 201);
	})

	// ── List Tasks ────────────────────────────────────────────────────
	.get("/tasks", (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}
		return c.json(gw.taskLoop.listTasks());
	})

	// ── Get Task ──────────────────────────────────────────────────────
	.get("/tasks/:id", (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}
		const task = gw.taskLoop.getTask(c.req.param("id"));
		if (!task) return c.json({ error: "Task not found" }, 404);
		return c.json(task);
	})

	// ── Approve Task ──────────────────────────────────────────────────
	.post("/tasks/:id/approve", async (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}
		await gw.taskLoop.approveTask(c.req.param("id"));
		return c.json({ ok: true });
	})

	// ── Cancel Task ───────────────────────────────────────────────────
	.post("/tasks/:id/cancel", (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}
		gw.taskLoop.cancelTask(c.req.param("id"));
		return c.json({ ok: true });
	})

	// ── Resume Blocked Task ───────────────────────────────────────────
	.post(
		"/tasks/:id/resume",
		zValidator("json", z.object({ message: z.string().optional() })),
		async (c) => {
			const gw = getGateway();
			if (!gw.taskLoop) {
				return c.json({ error: "Task Loop is not enabled" }, 400);
			}
			const { message } = c.req.valid("json");
			await gw.taskLoop.resumeTask(c.req.param("id"), message);
			return c.json({ ok: true });
		},
	)

	// ── DAG ───────────────────────────────────────────────────────────
	.post(
		"/dags",
		zValidator(
			"json",
			z.object({
				name: z.string().min(1),
				nodes: z.array(
					z.object({
						id: z.string().min(1),
						preset: z.string().min(1),
						prompt: z.string().min(1),
						agentId: z.string().min(1),
						workDir: z.string().min(1),
						worktree: z.boolean().optional(),
						dependsOn: z.array(z.string()).default([]),
						deliver: z.boolean().optional(),
						presetOptions: z.record(z.unknown()).optional(),
					}),
				),
				triggeredBy: z.enum(["dashboard", "channel"]).default("dashboard"),
			}),
		),
		async (c) => {
			const gw = getGateway();
			if (!gw.taskLoop) {
				return c.json({ error: "Task Loop is not enabled" }, 400);
			}
			const body = c.req.valid("json");
			const dag = await gw.taskLoop.createDAG(body);
			return c.json(dag, 201);
		},
	)

	.get("/dags", (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}
		return c.json(gw.taskLoop.listDAGs());
	})

	.get("/dags/:id", (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}
		const dag = gw.taskLoop.getDAG(c.req.param("id"));
		if (!dag) return c.json({ error: "DAG not found" }, 404);
		return c.json(dag);
	})

	// ── SSE Event Stream ──────────────────────────────────────────────
	.get("/events", (c) => {
		const gw = getGateway();
		if (!gw.taskLoop) {
			return c.json({ error: "Task Loop is not enabled" }, 400);
		}

		c.header("Content-Type", "text/event-stream");
		c.header("Cache-Control", "no-cache");
		c.header("Connection", "keep-alive");

		return stream(c, async (s) => {
			// biome-ignore lint/style/noNonNullAssertion: guarded by the check above
			const unsub = gw.taskLoop!.subscribe((event) => {
				s.write(`data: ${JSON.stringify(event)}\n\n`).catch(() => {});
			});

			// Keep-alive ping
			const ping = setInterval(() => {
				s.write(": ping\n\n").catch(() => {});
			}, 30_000);

			s.onAbort(() => {
				unsub();
				clearInterval(ping);
			});

			// Block until client disconnects
			await new Promise(() => {});
		});
	});
