import { Hono } from "hono";
import { getGateway } from "../gateway";

export const mediaRoute = new Hono()
	.post("/upload", async (c) => {
		const gw = getGateway();
		const body = await c.req.parseBody();
		const file = body.file;

		if (!(file instanceof File)) {
			return c.json({ error: "No file provided" }, 400);
		}

		const data = new Uint8Array(await file.arrayBuffer());
		const sessionKey = (body.sessionKey as string) || undefined;
		const source = (body.source as string) || undefined;

		const record = await gw.media.store({
			filename: file.name,
			mimeType: file.type || "application/octet-stream",
			data,
			sessionKey,
			source,
		});

		return c.json(
			{
				id: record.id,
				filename: record.filename,
				mimeType: record.mimeType,
				size: record.size,
			},
			201,
		);
	})
	.get("/:id", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();

		const file = await gw.media.readFile(id);
		if (!file) {
			return c.json({ error: "File not found" }, 404);
		}

		return new Response(file.data, {
			headers: {
				"Content-Type": file.mimeType,
				"Content-Disposition": `inline; filename="${file.filename}"`,
				"Cache-Control": "public, max-age=86400",
			},
		});
	})
	.get("/:id/info", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();

		const record = await gw.media.get(id);
		if (!record) {
			return c.json({ error: "File not found" }, 404);
		}

		return c.json({
			id: record.id,
			filename: record.filename,
			mimeType: record.mimeType,
			size: record.size,
			source: record.source,
			createdAt: record.createdAt,
		});
	})
	.get("/:id/thumbnail", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();
		const width = Number(c.req.query("w")) || 200;
		const height = Number(c.req.query("h")) || 200;

		const result = await gw.media.thumbnail(id, { width, height });
		if (!result) {
			return c.json({ error: "Cannot generate thumbnail" }, 400);
		}

		return new Response(result.data, {
			headers: {
				"Content-Type": result.mimeType,
				"Cache-Control": "public, max-age=86400",
			},
		});
	})
	.post("/:id/process", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();
		const body = await c.req.json<{
			maxWidth?: number;
			maxHeight?: number;
			format?: "webp" | "jpeg" | "png";
			quality?: number;
		}>();

		const record = await gw.media.processImage(id, body);
		if (!record) {
			return c.json({ error: "Cannot process media" }, 400);
		}

		return c.json({
			id: record.id,
			filename: record.filename,
			mimeType: record.mimeType,
			size: record.size,
		});
	})
	.get("/:id/text", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();

		const text = await gw.media.extractPdfText(id);
		if (text === null) {
			return c.json({ error: "Cannot extract text" }, 400);
		}

		return c.json({ text });
	})
	.delete("/:id", async (c) => {
		const id = c.req.param("id");
		const gw = getGateway();

		const deleted = await gw.media.delete(id);
		if (!deleted) {
			return c.json({ error: "File not found" }, 404);
		}

		return c.json({ deleted: true });
	});
