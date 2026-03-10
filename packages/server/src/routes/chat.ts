import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { z } from "zod";
import { SteeringManager } from "../agents/steering";
import { getGateway } from "../gateway";

const chatSendSchema = z.object({
	agentId: z.string().default("main"),
	sessionKey: z.string().default("agent:main:main"),
	message: z.string().min(1),
	imageUrls: z.array(z.string()).optional(),
	preference: z.enum(["default", "fast", "quality", "cheap"]).optional(),
});

const chatSteerSchema = z.object({
	sessionKey: z.string().min(1),
	message: z.string().min(1),
});

const chatCancelSchema = z.object({
	sessionKey: z.string().min(1),
});

/** Shared SteeringManager instance for HTTP chat routes. */
export const chatSteering = new SteeringManager();

export const chatRoute = new Hono()
	.post("/send", zValidator("json", chatSendSchema), (c) => {
		const body = c.req.valid("json");
		const gw = getGateway();
		const config = gw.config.get();

		return stream(c, async (s) => {
			const runMessage = async (msg: string) => {
				const signal = chatSteering.register(body.sessionKey);
				const events = gw.agentRuntime.run({
					agentId: body.agentId,
					sessionKey: body.sessionKey,
					message: msg,
					config,
					imageUrls: body.imageUrls,
					signal,
					preference: body.preference,
				});

				for await (const event of events) {
					await s.write(`${JSON.stringify(event)}\n`);
				}

				// Drain queued steering messages (dequeue before unregister to avoid race)
				const next = chatSteering.dequeue(body.sessionKey);
				if (!next) {
					chatSteering.unregister(body.sessionKey);
				} else {
					await s.write(
						`${JSON.stringify({ type: "steering_resume", sessionKey: body.sessionKey, message: next })}\n`,
					);
					await runMessage(next);
				}
			};

			await runMessage(body.message);
		});
	})
	.post("/steer", zValidator("json", chatSteerSchema), (c) => {
		const { sessionKey, message } = c.req.valid("json");

		if (!chatSteering.isActive(sessionKey)) {
			return c.json({ intent: "none", queued: false });
		}

		const result = chatSteering.steer(sessionKey, message);
		return c.json(result);
	})
	.post("/cancel", zValidator("json", chatCancelSchema), (c) => {
		const { sessionKey } = c.req.valid("json");

		if (chatSteering.isActive(sessionKey)) {
			chatSteering.steer(sessionKey, "cancel");
		}

		return c.json({ cancelled: true });
	});
