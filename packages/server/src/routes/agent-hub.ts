import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { getGateway } from "../gateway";

const spawnSchema = z.object({
	agentId: z.string().min(1),
	task: z.string().optional(),
	workDir: z.string().optional(),
	worktree: z.boolean().default(false),
	systemPrompt: z.string().optional(),
	model: z.string().optional(),
	onDone: z
		.object({
			notifyProcesses: z.array(z.string()).optional(),
			spawnNext: z
				.array(
					z.object({
						agentId: z.string(),
						task: z.string().optional(),
						workDir: z.string().optional(),
						worktree: z.boolean().optional(),
					}),
				)
				.optional(),
		})
		.optional(),
});

const dagTaskSchema = z.object({
	id: z.string().min(1),
	agentId: z.string().min(1),
	task: z.string(),
	dependsOn: z.array(z.string()).default([]),
	workDir: z.string().optional(),
	worktree: z.boolean().optional(),
});

const dagSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	tasks: z.array(dagTaskSchema).min(1),
});

const sendSchema = z.object({
	message: z.string().min(1),
});

const approveSchema = z.object({
	requestId: z.string().min(1),
	allowed: z.boolean(),
});

export const agentHubRoute = new Hono()
	// List all processes
	.get("/processes", (c) => {
		const gw = getGateway();
		const status = c.req.query("status") as string | undefined;
		const agentId = c.req.query("agentId");
		const processes = gw.supervisor.list({
			agentId: agentId || undefined,
			status: status as "running" | "stopped" | undefined,
		});
		const pendingApprovals = gw.supervisor.getPendingApprovals();
		return c.json({ processes, pendingApprovals });
	})

	// Get single process
	.get("/processes/:id", (c) => {
		const gw = getGateway();
		const process = gw.supervisor.get(c.req.param("id"));
		if (!process) {
			return c.json({ error: "Process not found" }, 404);
		}
		const approvals = gw.supervisor.getProcessApprovals(process.id);
		return c.json({ process, approvals });
	})

	// Spawn a new agent process
	.post("/spawn", zValidator("json", spawnSchema), async (c) => {
		const body = c.req.valid("json");
		const gw = getGateway();
		const config = gw.config.get();

		// Find agent config
		const agentConfig = config.agents.find((a) => a.id === body.agentId);
		if (!agentConfig) {
			return c.json({ error: `Agent "${body.agentId}" not found` }, 404);
		}

		try {
			const process = await gw.supervisor.spawn(
				{
					agentId: body.agentId,
					task: body.task,
					workDir: body.workDir,
					worktree: body.worktree,
					systemPrompt: body.systemPrompt,
					model: body.model,
					onDone: body.onDone,
				},
				agentConfig as unknown as Record<string, unknown>,
			);
			return c.json({ process }, 201);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
		}
	})

	// Send message to a process
	.post("/processes/:id/send", zValidator("json", sendSchema), async (c) => {
		const gw = getGateway();
		const processId = c.req.param("id");
		const { message } = c.req.valid("json");

		try {
			await gw.supervisor.send(processId, message);
			return c.json({ ok: true });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
		}
	})

	// Approve/deny permission request
	.post("/processes/:id/approve", zValidator("json", approveSchema), async (c) => {
		const gw = getGateway();
		const processId = c.req.param("id");
		const { requestId, allowed } = c.req.valid("json");

		try {
			await gw.supervisor.approve(processId, requestId, allowed);
			return c.json({ ok: true });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
		}
	})

	// Stop a process
	.post("/processes/:id/stop", async (c) => {
		const gw = getGateway();
		const processId = c.req.param("id");

		try {
			await gw.supervisor.stop(processId);
			return c.json({ ok: true });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
		}
	})

	// SSE event stream for a single process
	.get("/processes/:id/events", (c) => {
		const gw = getGateway();
		const processId = c.req.param("id");
		const process = gw.supervisor.get(processId);
		if (!process) {
			return c.json({ error: "Process not found" }, 404);
		}

		c.header("Content-Type", "text/event-stream");
		c.header("Cache-Control", "no-cache");
		c.header("Connection", "keep-alive");

		return stream(c, async (s) => {
			const unsubscribe = gw.supervisor.subscribe((event) => {
				// Filter to only this process
				if ("processId" in event && event.processId !== processId) return;
				if (event.type === "agent-event" && event.processId !== processId) return;
				if (event.type === "process-started" && event.process.id !== processId) return;

				s.write(`data: ${JSON.stringify(event)}\n\n`).catch(() => {});
			});

			// Keep alive until client disconnects
			try {
				while (true) {
					await new Promise((resolve) => setTimeout(resolve, 30_000));
					s.write(": keepalive\n\n").catch(() => {});
				}
			} finally {
				unsubscribe();
			}
		});
	})

	// SSE event stream for all processes (global)
	.get("/events", (c) => {
		const gw = getGateway();

		c.header("Content-Type", "text/event-stream");
		c.header("Cache-Control", "no-cache");
		c.header("Connection", "keep-alive");

		return stream(c, async (s) => {
			const unsubscribe = gw.supervisor.subscribe((event) => {
				s.write(`data: ${JSON.stringify(event)}\n\n`).catch(() => {});
			});

			try {
				while (true) {
					await new Promise((resolve) => setTimeout(resolve, 30_000));
					s.write(": keepalive\n\n").catch(() => {});
				}
			} finally {
				unsubscribe();
			}
		});
	})

	// Get all pending approvals (across all processes)
	.get("/approvals", (c) => {
		const gw = getGateway();
		return c.json({ approvals: gw.supervisor.getPendingApprovals() });
	})

	// ── Worktree ──────────────────────────────────────────────────────

	// Get worktree info for a process
	.get("/processes/:id/worktree", (c) => {
		const gw = getGateway();
		const info = gw.supervisor.getWorktreeInfo(c.req.param("id"));
		if (!info) {
			return c.json({ error: "No worktree for this process" }, 404);
		}
		return c.json({ worktree: info });
	})

	// Remove worktree for a stopped process
	.delete("/processes/:id/worktree", (c) => {
		const gw = getGateway();
		const ok = gw.supervisor.removeWorktree(c.req.param("id"));
		if (!ok) {
			return c.json(
				{ error: "Cannot remove worktree (process still running or no worktree)" },
				400,
			);
		}
		return c.json({ ok: true });
	})

	// ── Task DAG ──────────────────────────────────────────────────────

	// Create and start a task DAG
	.post("/dags", zValidator("json", dagSchema), async (c) => {
		const gw = getGateway();
		const body = c.req.valid("json");

		try {
			const dag = await gw.supervisor.startDAG({
				id: body.id,
				name: body.name,
				tasks: body.tasks.map((t) => ({
					...t,
					status: "pending" as const,
				})),
			});
			return c.json({ dag }, 201);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
		}
	})

	// List all DAGs
	.get("/dags", (c) => {
		const gw = getGateway();
		return c.json({ dags: gw.supervisor.listDAGs() });
	})

	// Get a single DAG
	.get("/dags/:id", (c) => {
		const gw = getGateway();
		const dag = gw.supervisor.getDAG(c.req.param("id"));
		if (!dag) {
			return c.json({ error: "DAG not found" }, 404);
		}
		return c.json({ dag });
	});
