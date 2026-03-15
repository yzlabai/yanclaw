import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DefaultTerminationPolicy } from "../../default-termination";
import type { LoopPreset } from "../../types";
import { DevDeliverer } from "./deliverer";
import { devFeedbackFormatter } from "./feedback";
import type { DevOptions, DevVerifyResult } from "./verifier";
import { DevVerifier } from "./verifier";

const verifier = new DevVerifier();
const deliverer = new DevDeliverer();

/**
 * Dev Preset — 编码场景预设。
 * Verifier: shell 命令验证（bun test, bun run check）
 * Deliverer: git commit → push → gh pr create
 */
export const DevPreset: LoopPreset<DevVerifyResult> & { deliverer: DevDeliverer } = {
	name: "dev",
	verifier,
	deliverer,
	feedbackFormatter: devFeedbackFormatter,
	terminationPolicy: new DefaultTerminationPolicy(verifier as never),

	parseOptions(raw: Record<string, unknown>): Record<string, unknown> {
		const opts: DevOptions = {
			verifyCommands: resolveVerifyCommands(
				raw.verifyCommands as string[] | undefined,
				raw.workDir as string | undefined,
			),
			testTimeoutMs: (raw.testTimeoutMs as number) ?? 5 * 60 * 1000,
			testSandbox: (raw.testSandbox as "none" | "docker") ?? "none",
		};
		return opts as unknown as Record<string, unknown>;
	},
};

/**
 * 自动检测验证命令：
 * 1. 读 package.json → scripts.test → "bun test"
 * 2. scripts.lint / scripts.check → 追加
 * 3. 都没有 → "bun run build"
 */
function resolveVerifyCommands(
	explicit: string[] | undefined,
	workDir: string | undefined,
): string[] {
	if (explicit && explicit.length > 0) return explicit;

	const commands: string[] = [];

	try {
		const pkgPath = join(workDir ?? process.cwd(), "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
		const scripts = pkg.scripts ?? {};

		if (scripts.test) commands.push("bun test");
		if (scripts.check) commands.push("bun run check");
		else if (scripts.lint) commands.push("bun run lint");
	} catch {
		// No package.json or parse error — fallback
	}

	if (commands.length === 0) {
		commands.push("bun run build");
	}

	return commands;
}
