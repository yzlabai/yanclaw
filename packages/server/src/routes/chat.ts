import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { getGateway } from "../gateway";

const chatSendSchema = z.object({
	agentId: z.string().default("main"),
	sessionKey: z.string().default("agent:main:main"),
	message: z.string().min(1),
	imageUrls: z.array(z.string()).optional(),
});

export const chatRoute = new Hono().post("/send", zValidator("json", chatSendSchema), (c) => {
	const body = c.req.valid("json");
	const gw = getGateway();
	const config = gw.config.get();

	return stream(c, async (s) => {
		const events = gw.agentRuntime.run({
			agentId: body.agentId,
			sessionKey: body.sessionKey,
			message: body.message,
			config,
			imageUrls: body.imageUrls,
		});

		for await (const event of events) {
			await s.write(`${JSON.stringify(event)}\n`);
		}
	});
});
