import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";

const createAgentSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	model: z.string().default("claude-sonnet-4-20250514"),
	systemPrompt: z.string().default("You are a helpful assistant."),
});

const updateAgentSchema = z.object({
	name: z.string().optional(),
	model: z.string().optional(),
	systemPrompt: z.string().optional(),
});

export const agentsRoute = new Hono()
	.get("/", (c) => {
		const config = getGateway().config.get();
		return c.json(
			config.agents.map((a) => ({
				id: a.id,
				name: a.name,
				model: a.model,
				systemPrompt: a.systemPrompt,
			})),
		);
	})
	.get("/:id", (c) => {
		const config = getGateway().config.get();
		const agent = config.agents.find((a) => a.id === c.req.param("id"));
		if (!agent) return c.json({ error: "Agent not found" }, 404);
		return c.json(agent);
	})
	.post("/", zValidator("json", createAgentSchema), async (c) => {
		const gw = getGateway();
		const body = c.req.valid("json");
		const config = gw.config.get();

		if (config.agents.some((a) => a.id === body.id)) {
			return c.json({ error: "Agent ID already exists" }, 409);
		}

		await gw.config.patch({ agents: [...config.agents, body] });
		return c.json(body, 201);
	})
	.patch("/:id", zValidator("json", updateAgentSchema), async (c) => {
		const gw = getGateway();
		const id = c.req.param("id");
		const body = c.req.valid("json");
		const config = gw.config.get();

		const idx = config.agents.findIndex((a) => a.id === id);
		if (idx === -1) return c.json({ error: "Agent not found" }, 404);

		const updated = { ...config.agents[idx], ...body };
		const agents = [...config.agents];
		agents[idx] = updated;
		await gw.config.patch({ agents });
		return c.json(updated);
	})
	.delete("/:id", async (c) => {
		const gw = getGateway();
		const id = c.req.param("id");
		if (id === "main") return c.json({ error: "Cannot delete default agent" }, 400);

		const config = gw.config.get();
		const agents = config.agents.filter((a) => a.id !== id);
		if (agents.length === config.agents.length) {
			return c.json({ error: "Agent not found" }, 404);
		}

		await gw.config.patch({ agents });
		return c.json({ deleted: true });
	});
