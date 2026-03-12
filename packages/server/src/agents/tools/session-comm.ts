/**
 * Cross-session communication tools.
 * Allows agents to list sessions, send messages to other sessions,
 * and read history from other sessions.
 */
import { tool } from "ai";
import { z } from "zod";
import type { SessionStore } from "../../db/sessions";

export function createSessionListTool(opts: { sessionStore: SessionStore }) {
	return tool({
		description:
			"List active agent sessions. Use this to discover other sessions for cross-session communication.",
		parameters: z.object({
			agentId: z.string().optional().describe("Filter by agent ID"),
			limit: z.number().default(20).describe("Max sessions to return"),
		}),
		execute: async ({ agentId, limit }) => {
			const result = opts.sessionStore.listSessions({
				agentId,
				limit: Math.min(limit, 50),
			});
			return {
				total: result.total,
				sessions: result.sessions.map((s) => ({
					key: s.key,
					agentId: s.agentId,
					title: s.title,
					channel: s.channel,
					messageCount: s.messageCount,
					updatedAt: s.updatedAt,
				})),
			};
		},
	});
}

export function createSessionSendTool(opts: {
	sessionStore: SessionStore;
	currentSessionKey: string;
	currentAgentId: string;
}) {
	return tool({
		description:
			"Send a message to another agent session. The message will appear in that session's history as an inter-session message.",
		parameters: z.object({
			targetSessionKey: z.string().describe("The session key to send the message to"),
			message: z.string().describe("The message content to send"),
		}),
		execute: async ({ targetSessionKey, message }) => {
			// Verify target session exists
			const target = opts.sessionStore.getSession(targetSessionKey);
			if (!target) {
				return { success: false, error: "Target session not found" };
			}

			// Only allow sending to sessions belonging to the same agent
			if (target.agentId !== opts.currentAgentId) {
				return { success: false, error: "Cannot send to sessions of a different agent" };
			}

			// Prevent sending to self
			if (targetSessionKey === opts.currentSessionKey) {
				return { success: false, error: "Cannot send to own session" };
			}

			// Store as a user message in the target session with cross-session marker
			opts.sessionStore.saveMessages(targetSessionKey, [
				{
					role: "user",
					content: `[Cross-session message from ${opts.currentSessionKey}]\n${message}`,
					tokenCount: Math.ceil(message.length / 4),
				},
			]);

			return {
				success: true,
				targetSession: targetSessionKey,
				targetAgent: target.agentId,
			};
		},
	});
}

export function createSessionHistoryTool(opts: { sessionStore: SessionStore }) {
	return tool({
		description: "Read recent message history from another session.",
		parameters: z.object({
			sessionKey: z.string().describe("The session key to read history from"),
			limit: z.number().default(10).describe("Max messages to return"),
		}),
		execute: async ({ sessionKey, limit }) => {
			const session = opts.sessionStore.getSession(sessionKey);
			if (!session) {
				return { error: "Session not found" };
			}

			const allMessages = opts.sessionStore.loadMessages(sessionKey);
			// Take only the last N messages
			const recent = allMessages.slice(-Math.min(limit, 50));
			return {
				sessionKey,
				agentId: session.agentId,
				messages: recent.map((m) => ({
					role: m.role,
					content: (m.content ?? "").slice(0, 2000),
					createdAt: m.createdAt,
				})),
			};
		},
	});
}
