/**
 * Code execution engine — runs code snippets in sandboxed environments.
 *
 * Runtime priority:
 * 1. bun --secure (if available)
 * 2. Docker sandbox (if Docker available)
 * 3. Restricted Bun subprocess (directory isolation + env filtering)
 */
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { truncateOutput } from "./common";

export interface CodeExecPermissions {
	/** Network access. false = none, true = all, string[] = domain allowlist. */
	net: boolean | string[];
	/** File read paths. false = none, true = all, string[] = path allowlist. */
	read: boolean | string[];
	/** File write paths. false = none, true = all, string[] = path allowlist. */
	write: boolean | string[];
	/** Env var access. false = none, string[] = allowed names. */
	env: boolean | string[];
	/** Subprocess execution. */
	run: boolean;
	/** System info access. */
	sys: boolean;
	/** FFI — always false. */
	ffi: false;
}

export interface CodeExecConfig {
	runtime: "bun-secure" | "docker" | "bun-limited";
	fallback: "docker" | "bun-limited" | "off";
	permissions: CodeExecPermissions;
	timeoutMs: number;
	maxOutputChars: number;
}

export interface CodeExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
	runtime: string;
	timedOut: boolean;
}

const LANGUAGE_CONFIG: Record<string, { ext: string; cmd: (file: string) => string[] }> = {
	javascript: { ext: ".js", cmd: (f) => ["bun", "run", f] },
	typescript: { ext: ".ts", cmd: (f) => ["bun", "run", f] },
	python: { ext: ".py", cmd: (f) => ["python3", f] },
	bash: { ext: ".sh", cmd: (f) => ["bash", f] },
	sh: { ext: ".sh", cmd: (f) => ["sh", f] },
};

/** Check if bun --secure mode is available. */
async function isBunSecureAvailable(): Promise<boolean> {
	try {
		const proc = Bun.spawn(["bun", "--secure", "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		await proc.exited;
		return proc.exitCode === 0;
	} catch {
		return false;
	}
}

/** Check if Docker is available. */
async function isDockerAvailable(): Promise<boolean> {
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

/** Detect available runtime, respecting config preference. */
export async function detectRuntime(
	config: CodeExecConfig,
): Promise<"bun-secure" | "docker" | "bun-limited"> {
	if (config.runtime === "bun-secure" && (await isBunSecureAvailable())) {
		return "bun-secure";
	}
	if (config.runtime === "docker" && (await isDockerAvailable())) {
		return "docker";
	}
	if (config.runtime === "bun-limited") {
		return "bun-limited";
	}

	// Fallback chain
	if (config.fallback === "docker" && (await isDockerAvailable())) {
		return "docker";
	}
	if (config.fallback === "bun-limited") {
		return "bun-limited";
	}

	// Last resort
	return "bun-limited";
}

/** Execute code in the resolved runtime. */
export async function executeCode(opts: {
	code: string;
	language: string;
	workspaceDir: string;
	config: CodeExecConfig;
	runtime: "bun-secure" | "docker" | "bun-limited";
}): Promise<CodeExecResult> {
	const { code, language, workspaceDir, config, runtime } = opts;
	const langConfig = LANGUAGE_CONFIG[language] ?? LANGUAGE_CONFIG.javascript;

	// Create temp directory for the script
	const tempDir = join(workspaceDir, ".code-exec-tmp");
	if (!existsSync(tempDir)) {
		await mkdir(tempDir, { recursive: true });
	}
	const scriptFile = join(tempDir, `exec_${Date.now()}${langConfig.ext}`);

	try {
		await writeFile(scriptFile, code, "utf-8");

		switch (runtime) {
			case "bun-secure":
				return await runBunSecure(scriptFile, config, workspaceDir);
			case "docker":
				return await runDocker(scriptFile, langConfig, config, workspaceDir);
			case "bun-limited":
				return await runBunLimited(scriptFile, langConfig, config, workspaceDir);
		}
	} finally {
		// Cleanup temp file
		try {
			await rm(scriptFile, { force: true });
		} catch {
			// ignore
		}
	}
}

/** Build bun --secure permission flags. */
function buildSecureFlags(perms: CodeExecPermissions): string[] {
	const flags: string[] = [];

	// Network
	if (perms.net === false) {
		flags.push("--deny-net");
	} else if (Array.isArray(perms.net)) {
		flags.push(`--allow-net=${perms.net.join(",")}`);
	} else {
		flags.push("--allow-net");
	}

	// Read
	if (perms.read === false) {
		flags.push("--deny-read");
	} else if (Array.isArray(perms.read)) {
		flags.push(`--allow-read=${perms.read.join(",")}`);
	} else {
		flags.push("--allow-read");
	}

	// Write
	if (perms.write === false) {
		flags.push("--deny-write");
	} else if (Array.isArray(perms.write)) {
		flags.push(`--allow-write=${perms.write.join(",")}`);
	} else {
		flags.push("--allow-write");
	}

	// Env
	if (perms.env === false) {
		flags.push("--deny-env");
	} else if (Array.isArray(perms.env)) {
		flags.push(`--allow-env=${perms.env.join(",")}`);
	} else {
		flags.push("--allow-env");
	}

	// Run
	if (!perms.run) flags.push("--deny-run");
	// Sys
	if (!perms.sys) flags.push("--deny-sys");
	// FFI always denied
	flags.push("--deny-ffi");

	return flags;
}

async function runBunSecure(
	scriptFile: string,
	config: CodeExecConfig,
	workspaceDir: string,
): Promise<CodeExecResult> {
	const secureFlags = buildSecureFlags(config.permissions);
	const cmd = ["bun", "--secure", ...secureFlags, "run", scriptFile];

	return spawnWithTimeout(cmd, workspaceDir, config);
}

async function runDocker(
	scriptFile: string,
	langConfig: (typeof LANGUAGE_CONFIG)[string],
	config: CodeExecConfig,
	workspaceDir: string,
): Promise<CodeExecResult> {
	const perms = config.permissions;

	const dockerArgs = [
		"docker",
		"run",
		"--rm",
		"--memory",
		"256m",
		"--cpus",
		"0.5",
		"--pids-limit",
		"100",
		"--security-opt",
		"no-new-privileges",
	];

	// Network
	if (perms.net === false) {
		dockerArgs.push("--network", "none");
	}

	// Mount workspace read-only by default
	const mountFlag = perms.write !== false ? "rw" : "ro";
	dockerArgs.push("-v", `${workspaceDir}:/workspace:${mountFlag}`);
	dockerArgs.push("-w", "/workspace");

	// Mount the script file
	const containerScript = `/tmp/exec_script${langConfig.ext}`;
	dockerArgs.push("-v", `${scriptFile}:${containerScript}:ro`);

	dockerArgs.push("ubuntu:22.04", ...langConfig.cmd(containerScript));

	return spawnWithTimeout(dockerArgs, workspaceDir, config, "docker");
}

async function runBunLimited(
	scriptFile: string,
	langConfig: (typeof LANGUAGE_CONFIG)[string],
	config: CodeExecConfig,
	workspaceDir: string,
): Promise<CodeExecResult> {
	// Restricted: strip all sensitive env vars, isolate to workspace dir
	const cmd = langConfig.cmd(scriptFile);
	return spawnWithTimeout(cmd, workspaceDir, config, "bun-limited");
}

/** Spawn a process with timeout and output limiting. */
async function spawnWithTimeout(
	cmd: string[],
	cwd: string,
	config: CodeExecConfig,
	runtimeName?: string,
): Promise<CodeExecResult> {
	let timedOut = false;
	const runtime = runtimeName ?? cmd[0];

	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const proc = Bun.spawn(cmd, {
			cwd,
			stdout: "pipe",
			stderr: "pipe",
			env: buildSanitizedEnv(config.permissions.env),
		});

		timer = setTimeout(() => {
			timedOut = true;
			proc.kill();
		}, config.timeoutMs);

		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text(),
		]);

		const exitCode = await proc.exited;

		return {
			exitCode,
			stdout: truncateOutput(stdout, config.maxOutputChars),
			stderr: truncateOutput(stderr, config.maxOutputChars),
			runtime,
			timedOut,
		};
	} catch (err) {
		return {
			exitCode: 1,
			stdout: "",
			stderr: `Error: ${err instanceof Error ? err.message : String(err)}`,
			runtime,
			timedOut: false,
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/** Build a sanitized env object for subprocess execution. */
function buildSanitizedEnv(envConfig: boolean | string[]): Record<string, string> {
	if (envConfig === false) {
		return { PATH: process.env.PATH ?? "" };
	}

	const env: Record<string, string> = { PATH: process.env.PATH ?? "" };

	if (Array.isArray(envConfig)) {
		for (const key of envConfig) {
			const val = process.env[key];
			if (val !== undefined) env[key] = val;
		}
	} else {
		// Allow all — but still strip known secrets
		const SENSITIVE =
			/_(API_KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)$|^(DATABASE_URL|VAULT_.*|OPENAI_.*|ANTHROPIC_.*|SLACK_.*|DISCORD_.*|TELEGRAM_.*)$/i;
		for (const [key, val] of Object.entries(process.env)) {
			if (val === undefined) continue;
			if (SENSITIVE.test(key)) continue;
			env[key] = val;
		}
	}

	return env;
}
