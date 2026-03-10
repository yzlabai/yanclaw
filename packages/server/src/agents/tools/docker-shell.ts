import { tool } from "ai";
import { z } from "zod";
import { truncateOutput } from "./common";

export interface DockerSandboxConfig {
	/** Docker image to use. Default: "ubuntu:22.04" */
	image: string;
	/** Memory limit. Default: "256m" */
	memoryLimit: string;
	/** CPU limit (number of CPUs). Default: "0.5" */
	cpuLimit: string;
	/** Network mode. Default: "none" (no network access) */
	network: string;
	/** Whether to mount workspace as read-only */
	readOnlyWorkspace: boolean;
}

const DEFAULT_CONFIG: DockerSandboxConfig = {
	image: "ubuntu:22.04",
	memoryLimit: "256m",
	cpuLimit: "0.5",
	network: "none",
	readOnlyWorkspace: false,
};

/** Check if Docker is available on the system. */
export async function isDockerAvailable(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["docker", "info"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

export function createDockerShellTool(opts: {
	workspaceDir: string;
	timeout: number;
	maxOutput: number;
	sandbox?: Partial<DockerSandboxConfig>;
}) {
	const config = { ...DEFAULT_CONFIG, ...opts.sandbox };

	return tool({
		description:
			"Execute a shell command inside a sandboxed Docker container. Use this for running untrusted code safely.",
		parameters: z.object({
			command: z.string().describe("The shell command to execute inside the container"),
		}),
		execute: async ({ command }) => {
			const dockerArgs = [
				"docker",
				"run",
				"--rm",
				"--memory",
				config.memoryLimit,
				"--cpus",
				config.cpuLimit,
				"--network",
				config.network,
				"--pids-limit",
				"100",
				"--security-opt",
				"no-new-privileges",
			];

			// Mount workspace
			const mountFlag = config.readOnlyWorkspace ? "ro" : "rw";
			dockerArgs.push("-v", `${opts.workspaceDir}:/workspace:${mountFlag}`);
			dockerArgs.push("-w", "/workspace");

			dockerArgs.push(config.image, "bash", "-c", command);

			let timedOut = false;
			const timer = setTimeout(() => {
				timedOut = true;
				proc.kill();
			}, opts.timeout);

			let proc: ReturnType<typeof Bun.spawn>;
			try {
				proc = Bun.spawn(dockerArgs, {
					stdout: "pipe",
					stderr: "pipe",
				});

				const [stdout, stderr] = await Promise.all([
					new Response(proc.stdout).text(),
					new Response(proc.stderr).text(),
				]);

				const exitCode = await proc.exited;

				let output = stdout;
				if (stderr) {
					output += (output ? "\n" : "") + stderr;
				}
				output = truncateOutput(output, opts.maxOutput);

				return {
					exitCode,
					output: (timedOut ? "[TIMEOUT] " : "") + (output || "(no output)"),
					sandboxed: true,
				};
			} catch (err) {
				return {
					exitCode: 1,
					output: `Error: ${err instanceof Error ? err.message : String(err)}`,
					sandboxed: true,
				};
			} finally {
				clearTimeout(timer);
			}
		},
	});
}
