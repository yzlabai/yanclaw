import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import { truncateOutput } from "./common";

function assertSafePath(filePath: string, workspaceDir: string): string {
	const resolved = resolve(workspaceDir, filePath);
	if (!resolved.startsWith(resolve(workspaceDir))) {
		throw new Error(`Path "${filePath}" is outside workspace directory`);
	}
	return resolved;
}

export function createFileReadTool(opts: { workspaceDir: string; maxOutput: number }) {
	return tool({
		description: "Read the contents of a file. Returns the file content as text.",
		parameters: z.object({
			path: z.string().describe("File path relative to workspace"),
			offset: z.number().optional().describe("Line number to start reading from (1-based)"),
			limit: z.number().optional().describe("Maximum number of lines to read"),
		}),
		execute: async ({ path, offset, limit }) => {
			try {
				const safePath = assertSafePath(path, opts.workspaceDir);
				let content = await readFile(safePath, "utf-8");

				if (offset || limit) {
					const lines = content.split("\n");
					const start = (offset ?? 1) - 1;
					const end = limit ? start + limit : lines.length;
					content = lines
						.slice(start, end)
						.map((line, i) => `${start + i + 1}\t${line}`)
						.join("\n");
				}

				return truncateOutput(content, opts.maxOutput);
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}

export function createFileWriteTool(opts: { workspaceDir: string }) {
	return tool({
		description: "Write content to a file, creating it if necessary.",
		parameters: z.object({
			path: z.string().describe("File path relative to workspace"),
			content: z.string().describe("Content to write"),
		}),
		execute: async ({ path, content }) => {
			try {
				const safePath = assertSafePath(path, opts.workspaceDir);
				await mkdir(dirname(safePath), { recursive: true });
				await writeFile(safePath, content, "utf-8");
				return `File written: ${path}`;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}

export function createFileEditTool(opts: { workspaceDir: string }) {
	return tool({
		description:
			"Edit a file by replacing a specific string with another. The old_string must be unique in the file.",
		parameters: z.object({
			path: z.string().describe("File path relative to workspace"),
			old_string: z.string().describe("The exact text to find and replace"),
			new_string: z.string().describe("The replacement text"),
		}),
		execute: async ({ path, old_string, new_string }) => {
			try {
				const safePath = assertSafePath(path, opts.workspaceDir);
				const content = await readFile(safePath, "utf-8");

				const occurrences = content.split(old_string).length - 1;
				if (occurrences === 0) {
					return `Error: old_string not found in ${path}`;
				}
				if (occurrences > 1) {
					return `Error: old_string found ${occurrences} times in ${path}. It must be unique. Provide more context.`;
				}

				const updated = content.replace(old_string, new_string);
				await writeFile(safePath, updated, "utf-8");
				return `File edited: ${path}`;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}
