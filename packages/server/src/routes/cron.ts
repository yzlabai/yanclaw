import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";

const cronTaskSchema = z.object({
	id: z.string().min(1),
	agent: z.string().default("main"),
	schedule: z.string().min(1),
	prompt: z.string().min(1),
	deliveryTargets: z
		.array(z.object({ channel: z.string(), peer: z.string().optional() }))
		.default([]),
	enabled: z.boolean().default(true),
});

export const cronRoute = new Hono()
	.get("/", (c) => {
		const gw = getGateway();
		const statuses = gw.cronService.getTaskStatuses();
		return c.json(statuses);
	})
	.post("/", zValidator("json", cronTaskSchema), async (c) => {
		const body = c.req.valid("json");
		const gw = getGateway();
		const config = gw.config.get();

		// Check for duplicate ID
		if (config.cron.tasks.some((t) => t.id === body.id)) {
			return c.json({ error: `Task "${body.id}" already exists` }, 409);
		}

		// Add to config
		const updatedTasks = [...config.cron.tasks, body];
		await gw.config.patch({ cron: { tasks: updatedTasks } });

		// Refresh scheduler
		gw.cronService.refreshSchedules();
		if (updatedTasks.length === 1) {
			gw.cronService.start();
		}

		return c.json(body, 201);
	})
	.patch("/:id", zValidator("json", cronTaskSchema.partial().omit({ id: true })), async (c) => {
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const gw = getGateway();
		const config = gw.config.get();

		const idx = config.cron.tasks.findIndex((t) => t.id === id);
		if (idx === -1) {
			return c.json({ error: `Task "${id}" not found` }, 404);
		}

		const updatedTasks = [...config.cron.tasks];
		updatedTasks[idx] = { ...updatedTasks[idx], ...body };
		await gw.config.patch({ cron: { tasks: updatedTasks } });

		gw.cronService.refreshSchedules();
		return c.json(updatedTasks[idx]);
	})
	.delete("/:id", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();
		const config = gw.config.get();

		const updatedTasks = config.cron.tasks.filter((t) => t.id !== id);
		if (updatedTasks.length === config.cron.tasks.length) {
			return c.json({ error: `Task "${id}" not found` }, 404);
		}

		await gw.config.patch({ cron: { tasks: updatedTasks } });
		gw.cronService.refreshSchedules();

		return c.json({ deleted: true });
	})
	.post("/:id/run", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();

		try {
			const result = await gw.cronService.runTask(id);
			return c.json({ result: result.slice(0, 2000) });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
		}
	});
