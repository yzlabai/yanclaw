import type { JudgeDecision, TerminationContext, TerminationPolicy, Verifier } from "./types";

const DEAD_LOOP_WINDOW = 3;

/**
 * DefaultTerminationPolicy — 判断流程：
 * 1. verifier.passed(lastResult) → done
 * 2. 超过 maxIterations 或 maxDurationMs → blocked(超限)
 * 3. 最近 3 次错误相同模式 → blocked(死循环)
 * 4. 否则 → iterate
 */
export class DefaultTerminationPolicy implements TerminationPolicy {
	private verifier: Verifier<unknown>;

	constructor(verifier: Verifier<unknown>) {
		this.verifier = verifier;
	}

	judge(ctx: TerminationContext): JudgeDecision {
		const { task, lastResult, elapsed } = ctx;

		// 1. 验证通过
		if (lastResult != null && this.verifier.passed(lastResult)) {
			return { action: "done", reason: "验证通过" };
		}

		// 2. 超限检查
		if (task.iteration >= task.maxIterations) {
			return {
				action: "blocked",
				reason: `已达最大迭代次数 ${task.maxIterations}`,
			};
		}
		if (elapsed >= task.maxDurationMs) {
			const hours = Math.round((elapsed / 3_600_000) * 10) / 10;
			return {
				action: "blocked",
				reason: `已超时 ${hours}h（上限 ${task.maxDurationMs / 3_600_000}h）`,
			};
		}

		// 3. 死循环检测
		if (task.errorHistory.length >= DEAD_LOOP_WINDOW) {
			const recent = task.errorHistory.slice(-DEAD_LOOP_WINDOW);
			const normalized = recent.map(normalizeError);
			if (normalized.every((e) => e === normalized[0])) {
				return {
					action: "blocked",
					reason: `检测到死循环：最近 ${DEAD_LOOP_WINDOW} 次错误相同`,
				};
			}
		}

		// 4. 继续迭代
		return { action: "iterate", reason: "验证未通过，继续迭代" };
	}
}

/** 去除行号、时间戳等不稳定部分，提取错误模式。 */
function normalizeError(error: string): string {
	return error
		.replace(/\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}[.\d]*/g, "") // timestamps
		.replace(/:\d+:\d+/g, ":L:C") // line:col
		.replace(/line \d+/gi, "line N") // line N
		.replace(/\b0x[0-9a-f]+\b/gi, "0xADDR") // hex addresses
		.trim()
		.slice(0, 200); // cap length for comparison
}
