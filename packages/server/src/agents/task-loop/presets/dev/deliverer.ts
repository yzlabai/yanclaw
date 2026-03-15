import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { DeliverContext, Deliverer, DeliverResult } from "../../types";
import type { DevVerifyResult } from "./verifier";

const exec = promisify(execFile);

/** Scan function type for leak detection (injected from gateway). */
export type LeakScanFn = (text: string) => { leaked: boolean };

/**
 * DevDeliverer — 任务完成后执行 git commit/push/PR 流程。
 *
 * 0. LeakDetector 扫描 worktree diff
 * 1. git add -u + 新增源码文件（排除敏感文件）
 * 2. git commit
 * 3. git push
 * 4. gh pr create
 */
export class DevDeliverer implements Deliverer<DevVerifyResult> {
	private leakScan?: LeakScanFn;

	setLeakScanner(fn: LeakScanFn): void {
		this.leakScan = fn;
	}

	async deliver(ctx: DeliverContext<DevVerifyResult>): Promise<DeliverResult> {
		const { workDir, task } = ctx;

		try {
			// 0. Scan diff for credential leaks
			if (this.leakScan) {
				const { stdout: diff } = await exec("git", ["diff", "HEAD"], { cwd: workDir });
				const { leaked } = this.leakScan(diff);
				if (leaked) {
					return {
						success: false,
						error: "LeakDetector: 在变更中检测到疑似凭据泄漏，交付已中止",
					};
				}
			}
			// 1. Stage tracked files
			await exec("git", ["add", "-u"], { cwd: workDir });

			// Stage new source files (exclude sensitive patterns)
			const { stdout: untrackedRaw } = await exec(
				"git",
				["ls-files", "--others", "--exclude-standard"],
				{ cwd: workDir },
			);
			const untracked = untrackedRaw
				.split("\n")
				.filter(Boolean)
				.filter(
					(f) =>
						!f.startsWith(".env") &&
						!f.endsWith(".key") &&
						!f.endsWith(".pem") &&
						!f.includes("node_modules/"),
				);
			if (untracked.length > 0) {
				await exec("git", ["add", ...untracked], { cwd: workDir });
			}

			// Check if there are changes to commit
			const { stdout: diffCheck } = await exec("git", ["diff", "--cached", "--stat"], {
				cwd: workDir,
			});
			if (!diffCheck.trim()) {
				return { success: false, error: "没有可提交的变更" };
			}

			// 2. Generate branch name
			const slug = task.prompt
				.slice(0, 20)
				.toLowerCase()
				.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
				.replace(/^-|-$/g, "");
			const branch = `task-loop/${task.id}-${slug}`;

			// Create and switch to branch
			await exec("git", ["checkout", "-b", branch], { cwd: workDir });

			// 3. Commit
			const commitMsg = [
				`feat: ${task.prompt.slice(0, 60)}`,
				"",
				`Task Loop 自动提交`,
				`迭代次数: ${task.iteration}`,
				`耗时: ${Math.round(((task.completedAt ?? Date.now()) - task.createdAt) / 1000)}s`,
			].join("\n");

			await exec("git", ["commit", "-m", commitMsg], { cwd: workDir });

			// 4. Push (retry once on failure)
			try {
				await exec("git", ["push", "origin", branch], { cwd: workDir });
			} catch {
				// Retry once
				await exec("git", ["push", "origin", branch], { cwd: workDir });
			}

			// 5. Create PR
			const { stdout: diffStat } = await exec("git", ["diff", "--stat", "HEAD~1"], {
				cwd: workDir,
			});
			const duration = Math.round(((task.completedAt ?? Date.now()) - task.createdAt) / 1000);
			const verifyCommands = (
				(task.options as { verifyCommands?: string[] }).verifyCommands ?? []
			).join(" && ");

			const prBody = [
				"## Task Loop 自动提交",
				"",
				`**任务**: ${task.prompt}`,
				`**迭代次数**: ${task.iteration}`,
				`**耗时**: ${duration}s`,
				`**验证命令**: \`${verifyCommands}\``,
				"",
				"## 测试结果",
				"全部通过",
				"",
				"## 变更文件",
				"```",
				diffStat.trim(),
				"```",
				"",
				"---",
				"由 YanClaw Task Loop 自动创建",
			].join("\n");

			const { stdout: prUrl } = await exec(
				"gh",
				["pr", "create", "--title", task.prompt.slice(0, 70), "--body", prBody],
				{ cwd: workDir },
			);

			return { success: true, url: prUrl.trim() };
		} catch (err) {
			return {
				success: false,
				error: err instanceof Error ? err.message : String(err),
			};
		}
	}
}
