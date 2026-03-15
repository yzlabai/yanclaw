import type { ConfirmPolicy, LoopStage, LoopTask } from "./types";

/**
 * ConfirmationGate — 判断是否需要在某个阶段暂停等确认。
 *
 * 四个维度叠加，任意一个命中就暂停：
 * 1. operations: 工具名匹配（TODO: 需要 controller 拦截 supervisor 的 permission-request 事件）
 * 2. stages: 阶段匹配（已接入）
 * 3. riskThreshold: 风险等级（TODO: 需要配合 operations 维度一起接入）
 */
export class ConfirmationGate {
	/** 判断是否应在指定阶段暂停。 */
	shouldConfirm(task: LoopTask, stage: LoopStage): boolean {
		const policy = task.confirmPolicy;

		// Stage match
		if (policy.stages.includes(stage)) {
			return true;
		}

		return false;
	}

	/** 判断是否应对指定操作（工具调用）暂停。 */
	shouldConfirmOperation(policy: ConfirmPolicy, tool: string): boolean {
		if (policy.operations.includes(tool)) {
			return true;
		}
		return false;
	}

	/** 判断是否应对指定风险等级暂停。 */
	shouldConfirmRisk(policy: ConfirmPolicy, risk: "low" | "medium" | "high"): boolean {
		if (policy.riskThreshold === "none") return false;

		const levels: Record<string, number> = { low: 1, medium: 2, high: 3 };
		return levels[risk] >= levels[policy.riskThreshold];
	}
}
