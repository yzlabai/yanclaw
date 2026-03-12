import { tool } from "ai";
import { z } from "zod";
import { truncateOutput } from "./common";

/** Environment variable names to strip from child processes to prevent credential leakage. */
const SENSITIVE_ENV_KEYS = new Set([
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"GOOGLE_API_KEY",
	"SLACK_BOT_TOKEN",
	"SLACK_APP_TOKEN",
	"DISCORD_TOKEN",
	"TELEGRAM_TOKEN",
	"YANCLAW_AUTH_TOKEN",
	"AWS_SECRET_ACCESS_KEY",
	"GITHUB_TOKEN",
	"NPM_TOKEN",
]);

/** Build a sanitized copy of process.env, stripping keys that match known credential patterns. */
function sanitizeEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if (SENSITIVE_ENV_KEYS.has(key)) continue;
		// Also strip any key ending with _KEY, _SECRET, _TOKEN (catch-all)
		if (/_(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$/i.test(key)) continue;
		env[key] = value;
	}
	env.HOME = process.env.HOME ?? "";
	return env;
}

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
					env: sanitizeEnv(),
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
