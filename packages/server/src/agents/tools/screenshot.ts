import { spawn } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";

/**
 * Run a command and return { exitCode, stderr }.
 * Uses node:child_process for compatibility with both Bun and Node (vitest).
 */
function runCommand(cmd: string, args: string[]): Promise<{ exitCode: number; stderr: string }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(cmd, args);
		const stderrChunks: Buffer[] = [];
		proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		proc.on("error", reject);
		proc.on("close", (code) => {
			resolve({
				exitCode: code ?? 1,
				stderr: Buffer.concat(stderrChunks).toString(),
			});
		});
	});
}

/**
 * Capture a desktop screenshot using macOS `screencapture` CLI.
 * Supports fullscreen and region modes. Window mode is intentionally omitted
 * because `-w` is interactive and cannot run headlessly.
 */
export function createDesktopScreenshotTool() {
	return tool({
		description:
			"Take a screenshot of the desktop. Supports fullscreen capture or a specific screen region. macOS only.",
		parameters: z.object({
			mode: z
				.enum(["fullscreen", "region"])
				.optional()
				.default("fullscreen")
				.describe("Capture mode: fullscreen (entire display) or region (specific rectangle)"),
			x: z.number().int().optional().describe("Region left edge in pixels (required for region mode)"),
			y: z.number().int().optional().describe("Region top edge in pixels (required for region mode)"),
			width: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Region width in pixels (required for region mode)"),
			height: z
				.number()
				.int()
				.positive()
				.optional()
				.describe("Region height in pixels (required for region mode)"),
		}),
		execute: async ({ mode, x, y, width, height }) => {
			if (mode === "region") {
				if (x === undefined || y === undefined || width === undefined || height === undefined) {
					return "Error: region mode requires x, y, width, and height parameters.";
				}
			}

			const tmpPath = join(tmpdir(), `yanclaw-screenshot-${Date.now()}.png`);
			try {
				const args =
					mode === "region"
						? ["-x", `-R${x},${y},${width},${height}`, tmpPath]
						: ["-x", tmpPath];

				const { exitCode, stderr } = await runCommand("screencapture", args);
				if (exitCode !== 0) {
					return `Error: screencapture exited with code ${exitCode}${stderr ? `: ${stderr.trim()}` : ""}`;
				}

				const buffer = await readFile(tmpPath);
				const base64 = buffer.toString("base64");
				return `data:image/png;base64,${base64}`;
			} catch (err) {
				return `Error: ${err instanceof Error ? err.message : String(err)}`;
			} finally {
				await rm(tmpPath, { force: true });
			}
		},
	});
}
