import type { FeedbackFormatter, LoopTask } from "../../types";
import { truncateTail } from "../../utils";
import type { DevVerifyResult } from "./verifier";

const MAX_ERROR_LINES = 100;

/**
 * DevFeedbackFormatter — 将测试失败结果格式化为给智能体的反馈提示。
 */
export const devFeedbackFormatter: FeedbackFormatter<DevVerifyResult> = (
	result: DevVerifyResult,
	task: LoopTask,
): string => {
	const failed = result.results.find((r) => !r.passed);
	if (!failed) return "所有验证通过。";

	const errorOutput = failed.stderr || failed.stdout;
	const truncated = truncateTail(errorOutput, MAX_ERROR_LINES);

	return [
		`测试失败（第 ${task.iteration}/${task.maxIterations} 次迭代）。`,
		"",
		`失败命令：${failed.command}`,
		`退出码：${failed.exitCode}`,
		"错误输出：",
		"```",
		truncated,
		"```",
		"",
		"请分析错误原因并修复。注意：",
		"- 之前的修复尝试没有解决问题，请尝试不同的方向",
		"- 如果需要更多上下文，请读取相关文件",
	].join("\n");
};
