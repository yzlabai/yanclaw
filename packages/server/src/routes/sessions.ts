import { Hono } from "hono";
import { getGateway } from "../gateway";

export const sessionsRoute = new Hono()
	.get("/", (c) => {
		const gw = getGateway();
		const agentId = c.req.query("agentId");
		const channel = c.req.query("channel");
		const limit = Number(c.req.query("limit")) || 20;
		const offset = Number(c.req.query("offset")) || 0;

		const result = gw.sessions.listSessions({ agentId, channel, limit, offset });
		return c.json(result);
	})
	.get("/:key", (c) => {
		const gw = getGateway();
		const key = decodeURIComponent(c.req.param("key"));
		const session = gw.sessions.getSession(key);
		if (!session) return c.json({ error: "Session not found" }, 404);

		const messages = gw.sessions.loadMessages(key);
		return c.json({ ...session, messages });
	})
	.get("/:key/export", (c) => {
		const gw = getGateway();
		const key = decodeURIComponent(c.req.param("key"));
		const format = c.req.query("format") ?? "json";
		const session = gw.sessions.getSession(key);
		if (!session) return c.json({ error: "Session not found" }, 404);

		const msgs = gw.sessions.loadMessages(key);

		if (format === "markdown" || format === "md") {
			const title = session.title ?? key;
			const lines: string[] = [`# ${title}`, ""];
			lines.push(`- **Agent**: ${session.agentId}`);
			if (session.channel) lines.push(`- **Channel**: ${session.channel}`);
			lines.push(`- **Created**: ${new Date(session.createdAt).toISOString()}`);
			lines.push(`- **Messages**: ${session.messageCount}`);
			lines.push("");

			for (const msg of msgs) {
				const roleLabel =
					msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;
				lines.push(`## ${roleLabel}`);
				lines.push("");
				if (msg.content) lines.push(msg.content);
				if (msg.toolCalls) {
					let calls = [];
					try {
						calls = JSON.parse(msg.toolCalls);
					} catch {
						/* malformed */
					}
					for (const tc of calls) {
						lines.push("");
						lines.push(`> **Tool**: ${tc.name}`);
						if (tc.args) lines.push(`> \`\`\`json\n> ${JSON.stringify(tc.args)}\n> \`\`\``);
					}
				}
				lines.push("");
			}

			const md = lines.join("\n");
			const filename = `${title.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
			return new Response(md, {
				headers: {
					"Content-Type": "text/markdown; charset=utf-8",
					"Content-Disposition": `attachment; filename="${filename}"`,
				},
			});
		}

		// Default: JSON export
		const exported = {
			session: {
				key: session.key,
				agentId: session.agentId,
				title: session.title,
				channel: session.channel,
				messageCount: session.messageCount,
				createdAt: session.createdAt,
				updatedAt: session.updatedAt,
			},
			messages: msgs.map((m) => ({
				role: m.role,
				content: m.content,
				toolCalls: m.toolCalls
					? (() => {
							try {
								return JSON.parse(m.toolCalls);
							} catch {
								return undefined;
							}
						})()
					: undefined,
				model: m.model,
				createdAt: m.createdAt,
			})),
			exportedAt: new Date().toISOString(),
		};

		const filename = `${(session.title ?? key).replace(/[^a-zA-Z0-9_-]/g, "_")}.json`;
		return new Response(JSON.stringify(exported, null, 2), {
			headers: {
				"Content-Type": "application/json; charset=utf-8",
				"Content-Disposition": `attachment; filename="${filename}"`,
			},
		});
	})
	.delete("/:key", (c) => {
		const gw = getGateway();
		const key = decodeURIComponent(c.req.param("key"));
		const deleted = gw.sessions.deleteSession(key);
		if (!deleted) return c.json({ error: "Session not found" }, 404);
		return c.json({ deleted: true });
	});
