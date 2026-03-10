import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileEditTool, createFileReadTool, createFileWriteTool } from "./file";

let workspaceDir: string;

beforeEach(async () => {
	workspaceDir = join(tmpdir(), `yanclaw-test-${Date.now()}`);
	await mkdir(workspaceDir, { recursive: true });
});

afterEach(async () => {
	await rm(workspaceDir, { recursive: true, force: true });
});

describe("createFileReadTool", () => {
	it("reads a file's content", async () => {
		const filePath = join(workspaceDir, "test.txt");
		await writeFile(filePath, "hello world\nsecond line", "utf-8");

		const tool = createFileReadTool({ workspaceDir, maxOutput: 10240 });
		const result = await tool.execute({ path: "test.txt" }, { toolCallId: "t1", messages: [] });
		expect(result).toContain("hello world");
		expect(result).toContain("second line");
	});

	it("reads with offset and limit", async () => {
		const lines = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`);
		await writeFile(join(workspaceDir, "multi.txt"), lines.join("\n"), "utf-8");

		const tool = createFileReadTool({ workspaceDir, maxOutput: 10240 });
		const result = await tool.execute(
			{ path: "multi.txt", offset: 3, limit: 2 },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toContain("line 3");
		expect(result).toContain("line 4");
		expect(result).not.toContain("line 5");
	});

	it("returns error for nonexistent file", async () => {
		const tool = createFileReadTool({ workspaceDir, maxOutput: 10240 });
		const result = await tool.execute({ path: "nope.txt" }, { toolCallId: "t1", messages: [] });
		expect(result).toMatch(/Error:/);
	});

	it("rejects path traversal outside workspace", async () => {
		const tool = createFileReadTool({ workspaceDir, maxOutput: 10240 });
		const result = await tool.execute(
			{ path: "../../etc/passwd" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toMatch(/Error:.*outside workspace/);
	});
});

describe("createFileWriteTool", () => {
	it("writes a new file", async () => {
		const tool = createFileWriteTool({ workspaceDir });
		const result = await tool.execute(
			{ path: "output.txt", content: "written content" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toContain("File written: output.txt");

		const content = await readFile(join(workspaceDir, "output.txt"), "utf-8");
		expect(content).toBe("written content");
	});

	it("creates subdirectories as needed", async () => {
		const tool = createFileWriteTool({ workspaceDir });
		const result = await tool.execute(
			{ path: "sub/dir/file.txt", content: "deep" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toContain("File written");

		const content = await readFile(join(workspaceDir, "sub/dir/file.txt"), "utf-8");
		expect(content).toBe("deep");
	});

	it("rejects path traversal", async () => {
		const tool = createFileWriteTool({ workspaceDir });
		const result = await tool.execute(
			{ path: "../escape.txt", content: "bad" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toMatch(/Error:.*outside workspace/);
	});

	it("returns JSON with mediaUrl when mediaStore is provided", async () => {
		const mockMediaStore = {
			store: async (params: Record<string, unknown>) => ({
				id: "media_123",
				filename: params.filename,
			}),
		};

		const tool = createFileWriteTool({
			workspaceDir,
			mediaStore: mockMediaStore as unknown as import("../../media").MediaStore,
			sessionKey: "session_1",
		});

		const result = await tool.execute(
			{ path: "report.md", content: "# Report" },
			{ toolCallId: "t1", messages: [] },
		);

		const parsed = JSON.parse(result);
		expect(parsed.mediaId).toBe("media_123");
		expect(parsed.mediaUrl).toBe("/api/media/media_123");
		expect(parsed.filename).toBe("report.md");
		expect(parsed.mimeType).toBe("text/markdown");
	});

	it("falls back gracefully when mediaStore.store throws", async () => {
		const mockMediaStore = {
			store: async () => {
				throw new Error("storage full");
			},
		};

		const tool = createFileWriteTool({
			workspaceDir,
			mediaStore: mockMediaStore as unknown as import("../../media").MediaStore,
		});

		const result = await tool.execute(
			{ path: "file.txt", content: "hello" },
			{ toolCallId: "t1", messages: [] },
		);

		expect(result).toBe("File written: file.txt (media storage unavailable)");
		// File should still exist
		const content = await readFile(join(workspaceDir, "file.txt"), "utf-8");
		expect(content).toBe("hello");
	});
});

describe("createFileEditTool", () => {
	it("replaces a unique string in a file", async () => {
		await writeFile(join(workspaceDir, "edit.txt"), "hello world foo bar", "utf-8");

		const tool = createFileEditTool({ workspaceDir });
		const result = await tool.execute(
			{ path: "edit.txt", old_string: "foo", new_string: "baz" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toContain("File edited");

		const content = await readFile(join(workspaceDir, "edit.txt"), "utf-8");
		expect(content).toBe("hello world baz bar");
	});

	it("returns error when old_string not found", async () => {
		await writeFile(join(workspaceDir, "edit.txt"), "hello", "utf-8");

		const tool = createFileEditTool({ workspaceDir });
		const result = await tool.execute(
			{ path: "edit.txt", old_string: "missing", new_string: "x" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toMatch(/Error:.*not found/);
	});

	it("returns error when old_string matches multiple times", async () => {
		await writeFile(join(workspaceDir, "edit.txt"), "aaa aaa aaa", "utf-8");

		const tool = createFileEditTool({ workspaceDir });
		const result = await tool.execute(
			{ path: "edit.txt", old_string: "aaa", new_string: "bbb" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toMatch(/Error:.*3 times/);
	});
});
