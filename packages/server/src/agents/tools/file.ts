import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { MediaStore } from "../../media";
import { truncateOutput } from "./common";

const MIME_MAP: Record<string, string> = {
	".txt": "text/plain",
	".md": "text/markdown",
	".html": "text/html",
	".css": "text/css",
	".js": "application/javascript",
	".ts": "application/typescript",
	".json": "application/json",
	".xml": "application/xml",
	".csv": "text/csv",
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".webp": "image/webp",
	".zip": "application/zip",
	".py": "text/x-python",
	".sh": "text/x-shellscript",
};

function assertSafePath(filePath: string, workspaceDir: string): string {
	const resolved = resolve(workspaceDir, filePath);
	if (!resolved.startsWith(resolve(workspaceDir))) {
		throw new Error(`Path "${filePath}" is outside workspace directory`);
	}
	return resolved;
}

/** Follow symlinks and re-check the real path is still inside workspace. */
async function assertRealSafePath(filePath: string, workspaceDir: string): Promise<string> {
	const resolved = assertSafePath(filePath, workspaceDir);
	try {
		const real = await realpath(resolved);
		const realWorkspace = await realpath(workspaceDir);
		if (!real.startsWith(realWorkspace)) {
			throw new Error(`Path "${filePath}" resolves outside workspace via symlink`);
		}
		return real;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			// File doesn't exist yet (for write), use the pre-symlink check
			return resolved;
		}
		throw err;
	}
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
				const safePath = await assertRealSafePath(path, opts.workspaceDir);
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

export function createFileWriteTool(opts: {
	workspaceDir: string;
	mediaStore?: MediaStore;
	sessionKey?: string;
}) {
	return tool({
		description: "Write content to a file, creating it if necessary.",
		parameters: z.object({
			path: z.string().describe("File path relative to workspace"),
			content: z.string().describe("Content to write"),
		}),
		execute: async ({ path, content }) => {
			try {
				const safePath = await assertRealSafePath(path, opts.workspaceDir);
				await mkdir(dirname(safePath), { recursive: true });
				await writeFile(safePath, content, "utf-8");

				// Store a copy in MediaStore for download links
				if (opts.mediaStore) {
					try {
						const filename = basename(safePath);
						const ext = extname(filename).toLowerCase();
						const mimeType = MIME_MAP[ext] ?? "application/octet-stream";
						const data = new TextEncoder().encode(content);
						const media = await opts.mediaStore.store({
							filename,
							mimeType,
							data,
							sessionKey: opts.sessionKey,
							source: "file_write",
						});
						return JSON.stringify({
							message: `File written: ${path}`,
							mediaId: media.id,
							mediaUrl: `/api/media/${media.id}`,
							filename,
							mimeType,
							size: data.byteLength,
						});
					} catch (err) {
						console.warn(
							"[file_write] Media storage failed:",
							err instanceof Error ? err.message : err,
						);
						return `File written: ${path} (media storage unavailable)`;
					}
				}

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
				const safePath = await assertRealSafePath(path, opts.workspaceDir);
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
