import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";

export const sttRoute = new Hono().post(
	"/transcribe",
	zValidator("json", z.object({ mediaId: z.string() })),
	async (c) => {
		const gw = getGateway();
		const config = gw.config.get();

		if (!gw.sttService.isAvailable(config)) {
			return c.json({ error: "STT not configured. Set systemModels.stt in config." }, 400);
		}

		const { mediaId } = c.req.valid("json");
		const media = await gw.media.get(mediaId);
		if (!media) {
			return c.json({ error: "Media not found" }, 404);
		}

		// Build a local URL for SttService
		const port = config.gateway.port;
		const audioUrl = `http://localhost:${port}/api/media/${mediaId}`;

		try {
			const text = await gw.sttService.transcribe(audioUrl, config);
			return c.json({ text });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Transcription failed";
			return c.json({ error: message }, 500);
		}
	},
);
