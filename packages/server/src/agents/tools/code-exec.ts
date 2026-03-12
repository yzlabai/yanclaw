/**
 * code_exec tool — Execute code snippets in a sandboxed environment.
 * Unlike the shell tool, this is designed for non-owners too (sandbox protects).
 */
import { tool } from "ai";
import { z } from "zod";
import type { CodeExecConfig } from "./code-exec-runner";
import { detectRuntime, executeCode } from "./code-exec-runner";

const SUPPORTED_LANGUAGES = ["javascript", "typescript", "python", "bash", "sh"] as const;

export function createCodeExecTool(opts: { workspaceDir: string; config: CodeExecConfig }) {
	let resolvedRuntime: "bun-secure" | "docker" | "bun-limited" | null = null;

	return tool({
		description: [
			"Execute a code snippet in a sandboxed environment.",
			`Supported languages: ${SUPPORTED_LANGUAGES.join(", ")}.`,
			"The code runs in an isolated sandbox with limited permissions.",
			"Use this for computations, data processing, or testing code snippets.",
		].join(" "),
		parameters: z.object({
			code: z.string().describe("The code to execute"),
			language: z
				.enum(SUPPORTED_LANGUAGES)
				.default("javascript")
				.describe("Programming language of the code"),
		}),
		execute: async ({ code, language }) => {
			// Lazy-detect runtime on first call
			if (!resolvedRuntime) {
				resolvedRuntime = await detectRuntime(opts.config);
				console.log(`[code_exec] Using runtime: ${resolvedRuntime}`);
			}

			const result = await executeCode({
				code,
				language,
				workspaceDir: opts.workspaceDir,
				config: opts.config,
				runtime: resolvedRuntime,
			});

			let output = result.stdout;
			if (result.stderr) {
				output += (output ? "\n[stderr]\n" : "[stderr]\n") + result.stderr;
			}
			if (result.timedOut) {
				output = `[TIMEOUT after ${opts.config.timeoutMs}ms]\n${output}`;
			}

			return {
				exitCode: result.exitCode,
				output: output || "(no output)",
				runtime: result.runtime,
			};
		},
	});
}
