import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const sendMessageSchema = z.object({
	channel: z.string(),
	to: z.string(),
	text: z.string(),
});

export const messagesRoute = new Hono().post(
	"/send",
	zValidator("json", sendMessageSchema),
	async (c) => {
		const body = c.req.valid("json");
		// TODO: route message to channel
		return c.json({ ok: true, channel: body.channel, to: body.to });
	},
);
