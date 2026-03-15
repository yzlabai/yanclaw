import type { Verifier, VerifyContext } from "../../types";
import { truncateTail } from "../../utils";

export interface DevVerifyResult {
	allPassed: boolean;
	results: CommandResult[];
}

export interface CommandResult {
	passed: boolean;
	command: string;
	exitCode: number;
	stdout: string;
	stderr: string;
	durationMs: number;
}

export interface DevOptions {
	verifyCommands: string[];
	testTimeoutMs: number;
	testSandbox: "none" | "docker";
}

const MAX_OUTPUT_LINES = 200;

/** 环境变量中需要剥离的敏感关键词 */
const SENSITIVE_PATTERNS = ["_KEY", "_SECRET", "_TOKEN", "_PASSWORD"];

/**
 * DevVerifier — 在 workDir 下依次执行验证命令（短路模式）。
 */
export class DevVerifier implements Verifier<DevVerifyResult> {
	async verify(ctx: VerifyContext): Promise<DevVerifyResult> {
		const opts = ctx.task.options as DevOptions;
		const commands = opts.verifyCommands;
		const results: CommandResult[] = [];

		for (const command of commands) {
			const result = await this.runCommand(command, ctx.workDir, opts.testTimeoutMs);
			results.push(result);
			if (!result.passed) {
				return { allPassed: false, results };
			}
		}

		return { allPassed: true, results };
	}

	passed(result: DevVerifyResult): boolean {
		return result.allPassed;
	}

	private async runCommand(
		command: string,
		cwd: string,
		timeoutMs: number,
	): Promise<CommandResult> {
		const start = Date.now();

		// 构造安全的环境变量（剥离敏感值）
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value == null) continue;
			const isSensitive = SENSITIVE_PATTERNS.some((p) => key.toUpperCase().includes(p));
			if (!isSensitive) {
				env[key] = value;
			}
		}

		try {
			const proc = Bun.spawn(["sh", "-c", command], {
				cwd,
				env,
				stdout: "pipe",
				stderr: "pipe",
			});

			// Timeout: kill process and race against output collection
			let timedOut = false;
			const timeout = setTimeout(() => {
				timedOut = true;
				proc.kill();
			}, timeoutMs);

			// Race output collection against a hard timeout (extra 5s grace)
			const outputPromise = Promise.all([
				new Response(proc.stdout).text(),
				new Response(proc.stderr).text(),
				proc.exited,
			]);
			const hardTimeout = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Hard timeout")), timeoutMs + 5000),
			);

			const [stdout, stderr, exitCode] = await Promise.race([outputPromise, hardTimeout]);
			clearTimeout(timeout);

			return {
				passed: !timedOut && exitCode === 0,
				command,
				exitCode: timedOut ? -1 : exitCode,
				stdout: truncateTail(stdout, MAX_OUTPUT_LINES),
				stderr: timedOut
					? `Command timed out after ${timeoutMs / 1000}s\n${truncateTail(stderr, MAX_OUTPUT_LINES)}`
					: truncateTail(stderr, MAX_OUTPUT_LINES),
				durationMs: Date.now() - start,
			};
		} catch (err) {
			return {
				passed: false,
				command,
				exitCode: -1,
				stdout: "",
				stderr: err instanceof Error ? err.message : String(err),
				durationMs: Date.now() - start,
			};
		}
	}
}
