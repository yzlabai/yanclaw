import { describe, expect, it } from "vitest";
import { mapToAgentEvent, type SdkMessage } from "./claude-code-runtime";

const SESSION = "test-session-123";

describe("mapToAgentEvent", () => {
	it("returns empty for system init message", () => {
		const msg: SdkMessage = { type: "system", subtype: "init", session_id: "sess-abc" };
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("returns empty for final result message", () => {
		const msg: SdkMessage = { result: "Here is the answer.", stop_reason: "end_turn" };
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("returns empty for result with empty string", () => {
		const msg: SdkMessage = { result: "", stop_reason: "end_turn" };
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("maps text content block to delta event", () => {
		const msg: SdkMessage = {
			content: [{ type: "text", text: "Hello world" }],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([
			{ type: "delta", sessionKey: SESSION, text: "Hello world" },
		]);
	});

	it("skips text block with empty text", () => {
		const msg: SdkMessage = {
			content: [{ type: "text", text: "" }],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("maps thinking content block to thinking event", () => {
		const msg: SdkMessage = {
			content: [{ type: "thinking", text: "Let me reason about this..." }],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([
			{ type: "thinking", sessionKey: SESSION, text: "Let me reason about this..." },
		]);
	});

	it("skips thinking block with empty text", () => {
		const msg: SdkMessage = {
			content: [{ type: "thinking", text: "" }],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("maps tool_use block to tool_call event", () => {
		const msg: SdkMessage = {
			content: [
				{
					type: "tool_use",
					name: "Bash",
					input: { command: "ls -la" },
				},
			],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([
			{
				type: "tool_call",
				sessionKey: SESSION,
				name: "Bash",
				args: { command: "ls -la" },
			},
		]);
	});

	it("uses empty object for tool_use with no input", () => {
		const msg: SdkMessage = {
			content: [{ type: "tool_use", name: "Read" }],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([
			{
				type: "tool_call",
				sessionKey: SESSION,
				name: "Read",
				args: {},
			},
		]);
	});

	it("maps tool_result block with nested content", () => {
		const msg: SdkMessage = {
			content: [
				{
					type: "tool_result",
					name: "Bash",
					content: [
						{ type: "text", text: "file1.ts" },
						{ type: "text", text: "file2.ts" },
					],
				},
			],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([
			{
				type: "tool_result",
				sessionKey: SESSION,
				name: "Bash",
				result: "file1.ts\nfile2.ts",
				duration: 0,
			},
		]);
	});

	it("maps tool_result block using id when name is absent", () => {
		const msg: SdkMessage = {
			content: [
				{
					type: "tool_result",
					id: "toolu_123",
					text: "result text",
				},
			],
		};
		expect(mapToAgentEvent(msg, SESSION)).toEqual([
			{
				type: "tool_result",
				sessionKey: SESSION,
				name: "toolu_123",
				result: "result text",
				duration: 0,
			},
		]);
	});

	it("handles multiple content blocks in one message", () => {
		const msg: SdkMessage = {
			content: [
				{ type: "thinking", text: "Thinking..." },
				{ type: "text", text: "Here is the result" },
				{ type: "tool_use", name: "Grep", input: { pattern: "foo" } },
			],
		};
		const events = mapToAgentEvent(msg, SESSION);
		expect(events).toHaveLength(3);
		expect(events[0].type).toBe("thinking");
		expect(events[1].type).toBe("delta");
		expect(events[2].type).toBe("tool_call");
	});

	it("returns empty for unknown message shape", () => {
		const msg: SdkMessage = { type: "unknown", data: "something" };
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("returns empty for message with empty content array", () => {
		const msg: SdkMessage = { content: [] };
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("returns empty for message with no content", () => {
		const msg: SdkMessage = { type: "assistant" };
		expect(mapToAgentEvent(msg, SESSION)).toEqual([]);
	});

	it("ignores unknown content block types", () => {
		const msg: SdkMessage = {
			content: [
				{ type: "image", text: "some-base64" },
				{ type: "text", text: "actual text" },
			],
		};
		const events = mapToAgentEvent(msg, SESSION);
		expect(events).toHaveLength(1);
		expect(events[0]).toEqual({ type: "delta", sessionKey: SESSION, text: "actual text" });
	});
});
