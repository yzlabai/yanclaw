import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db";
import { approvals } from "../db/schema";
import { getGateway } from "../gateway";

export const approvalsRoute = new Hono()
	.get("/", (c) => {
		const status = c.req.query("status");
		const db = getDb();

		let query = db.select().from(approvals).orderBy(desc(approvals.createdAt));
		if (status) {
			query = query.where(eq(approvals.status, status)) as typeof query;
		}

		const rows = query.limit(100).all();
		return c.json(
			rows.map((r) => ({
				...r,
				args: JSON.parse(r.args),
			})),
		);
	})
	.post("/:id/respond", async (c) => {
		const id = c.req.param("id");
		const body = await c.req.json<{ decision: string }>();

		if (body.decision !== "approved" && body.decision !== "denied") {
			return c.json({ error: "decision must be 'approved' or 'denied'" }, 400);
		}

		const gw = getGateway();
		const found = gw.approvalManager.respond(id, body.decision);

		if (!found) {
			return c.json({ error: "Approval not found or already resolved" }, 404);
		}

		return c.json({ success: true });
	});
