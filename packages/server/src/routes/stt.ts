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

		if (!media.mimeType.startsWith("audio/")) {
			return c.json({ error: "File is not an audio file" }, 400);
		}

		// Read file directly instead of HTTP loopback
		const file = await gw.media.readFile(mediaId);
		if (!file) {
			return c.json({ error: "Failed to read media file" }, 500);
		}

		try {
			const text = await gw.sttService.transcribeBlob(file.data, file.filename, config);
			return c.json({ text });
		} catch (err) {
			const message = err instanceof Error ? err.message : "Transcription failed";
			return c.json({ error: message }, 500);
		}
	},
);
