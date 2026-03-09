import { tool } from "ai";
import { z } from "zod";
import { truncateOutput } from "./common";

export function createShellTool(opts: {
	workspaceDir: string;
	timeout: number;
	maxOutput: number;
}) {
	return tool({
		description:
			"Execute a shell command and return its output. Use this for running programs, listing files, searching code, etc.",
		parameters: z.object({
			command: z.string().describe("The shell command to execute"),
		}),
		execute: async ({ command }) => {
			try {
				const proc = Bun.spawn(["bash", "-c", command], {
					cwd: opts.workspaceDir,
					stdout: "pipe",
					stderr: "pipe",
					env: { ...process.env, HOME: process.env.HOME ?? "" },
				});

				const timer = setTimeout(() => {
					proc.kill();
				}, opts.timeout);

				const [stdout, stderr] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
				]);

				clearTimeout(timer);
				const exitCode = await proc.exited;

				let output = stdout;
				if (stderr) {
					output += (output ? "\n" : "") + stderr;
				}
				output = truncateOutput(output, opts.maxOutput);

				return {
					exitCode,
					output: output || "(no output)",
				};
			} catch (err) {
				return {
					exitCode: 1,
					output: `Error: ${err instanceof Error ? err.message : String(err)}`,
				};
			}
		},
	});
}
