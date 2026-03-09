import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getGateway } from "../gateway";

function maskSecrets(obj: unknown): unknown {
	if (typeof obj === "string" && obj.length > 8) {
		if (obj.startsWith("sk-") || obj.startsWith("xoxb-") || /^\d+:[A-Za-z0-9_-]+$/.test(obj)) {
			return `${obj.slice(0, 6)}***`;
		}
	}
	if (Array.isArray(obj)) return obj.map(maskSecrets);
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			if (/key|token|secret|password/i.test(key) && typeof value === "string") {
				result[key] = value.length > 4 ? `${value.slice(0, 4)}***` : "***";
			} else {
				result[key] = maskSecrets(value);
			}
		}
		return result;
	}
	return obj;
}

export const configRoute = new Hono()
	.get("/", (c) => {
		const config = getGateway().config.get();
		return c.json(maskSecrets(config));
	})
	.patch("/", zValidator("json", z.record(z.unknown())), async (c) => {
		const gw = getGateway();
		const body = c.req.valid("json");

		try {
			await gw.config.patch(body);
			return c.json({ updated: true });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : "Invalid config" }, 400);
		}
	});
