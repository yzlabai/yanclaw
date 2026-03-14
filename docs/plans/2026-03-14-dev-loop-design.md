# Dev Loop — 自治开发循环设计

> YanClaw 调用 Claude Code 自动开发项目，24小时监控进展，测试反馈迭代。

## 需求本质

### 第一层：替代人类坐在 AI 工具前面

人类使用 Claude Code 的完整循环：给任务 → 看它写 → 遇到权限请求点批准 → 写完了跑测试 → 测试挂了把错误贴回去说"修" → 循环 → 最终 PR。Dev Loop 模拟的就是这个最机械的部分：

| 人类动作 | 程序替代 |
|---------|---------|
| 看着输出等完成 | 监听 `status-change` 事件 |
| 遇到弹窗点允许 | ConfirmPolicy 规则引擎 |
| 跑 `bun test` | TestRunner |
| 看报错，复制粘贴给 Claude | feedbackPrompt 模板 |
| 判断"这修不好了，换个思路" | 死循环检测 |
| 判断"行了，够了" | 迭代上限 |
| 最后 `git push` 开 PR | Deliverer |

核心逻辑本质上是一个 while 循环：

```typescript
while (iteration < max && !deadLoop) {
  agent.send(prompt);
  await agent.done();
  result = verify();
  if (result.passed) break;
  prompt = formatFeedback(result);
  iteration++;
}
deliver();
```

### 第二层：YanClaw 是个人 AI 协调器

Claude Code 只是 YanClaw 能调度的智能体之一。更本质地看，YanClaw 的定位是**个人 AI 助理的中枢神经**——它不直接干活，而是协调不同的 AI 工具去干活，监控它们，处理它们的反馈，判断结果，决定下一步。

```
                        YanClaw（协调器）
                       /       |        \
              Claude Code    Codex     Gemini     ...更多智能体
              (写代码)      (写代码)   (写代码)
                  |            |          |
              测试验证      测试验证    测试验证     ...更多验证方式
```

这个模式可以泛化到编码之外：

| 场景 | 智能体 | 验证方式 | 交付物 |
|------|-------|---------|-------|
| 写代码 | Claude Code / Codex / Gemini | 跑测试 | PR |
| 写文档 | Claude API | 检查格式/链接/拼写 | commit |
| 数据分析 | Code Interpreter | 检查输出完整性 | 报告文件 |
| 图片生成 | DALL-E / Midjourney | 人工确认 | 媒体文件 |
| 研究调研 | Perplexity / Web Search Agent | 检查引用有效性 | 文档 |

**所以 Dev Loop 的设计应该是可泛化的**：核心循环（派发 → 监控 → 验证 → 反馈 → 迭代）是通用的，Claude Code + 测试 + PR 只是第一个实例。设计时把"写代码"相关的逻辑（TestRunner、git 交付）做成可插拔的策略，未来替换成其他验证/交付方式就能支持新场景。

```typescript
interface TaskLoop<TResult> {
  agent: AgentAdapter;              // 谁来干活（Claude Code, Codex, ...）
  verifier: Verifier<TResult>;     // 怎么验证（跑测试, 检查格式, 人工确认, ...）
  deliverer: Deliverer<TResult>;   // 怎么交付（PR, commit, 上传文件, ...）
  feedbackFormatter: (result: TResult) => string;  // 怎么反馈
  terminationPolicy: TerminationPolicy;            // 什么时候停
  confirmPolicy: ConfirmPolicy;                    // 什么时候问人
}
```

本次实现聚焦 **Dev Loop**（编码场景），但模块边界按上述泛化接口设计，为未来扩展留好口子。

下面的设计围绕编码场景的核心循环展开，增加的是：可配置的确认断点、通知推送、DAG 编排、错误恢复等生产级包装。

## 概述

在现有 Agent Hub（AgentSupervisor）之上新增 **DevLoopController** 编排层，实现：

1. 通过 Dashboard 或 Chat Channel 触发开发任务
2. 全自动执行：编码 → 测试 → 评估 → 迭代循环
3. 全程推送进展到 Channel
4. 用户可配置人工确认断点（按操作类型/阶段/风险等级/任务）
5. 智能终止：死循环检测 + 次数/时间上限
6. 完成后自动创建 PR 并通知
7. DAG 编排多任务依赖调度

## 架构

```
用户(Dashboard/Channel) → DevLoopController → AgentSupervisor → Claude Code
                              ↑                                      ↓
                              ← TestRunner ← IterationJudge ← 事件流 ←┘
```

DevLoopController 层叠加在 AgentSupervisor 之上，复用其 spawn/stop/permission/worktree 能力。

### Claude Code 进程交互模型

Claude Code SDK 的 `query()` 完成后进程变为 idle（`alive = false`）。DevLoopController 采用 **session resume** 模式与 Claude Code 交互：

1. **首次编码**：通过 `supervisor.spawn()` 创建进程，SDK `query()` 执行用户 prompt
2. **编码完成**：监听 supervisor 的 `status-change` 事件（`status: "idle"`），或 `process-stopped` 事件（`reason: "completed"`），表示编码完成
3. **迭代反馈**：通过 `supervisor.resume(processId, feedbackPrompt)` 发送反馈（新方法，见下）
4. **sessionId 追踪**：DevTask 记录 `sessionId`，每次 resume 时传递以保持会话连续性
5. **进程崩溃**：监听 `process-stopped` 事件（`reason: "error"`），转 `blocked` 状态

**需要新增 `supervisor.resume()` 方法**：现有 `supervisor.send()` 会拒绝 `alive === false` 的进程。新增 `resume(processId, message)` 方法，跳过 alive 检查，直接调用 adapter 的 `send()` 并将进程状态重置为 `running`。ClaudeCodeAdapter 的 `send()` 已支持 `resumeSessionId` 机制。

**防止 stale eviction**：DevLoop 管理的进程在 `idle` 状态时，supervisor 的 stale check（30 分钟 TTL）可能误删进程记录。DevLoopController 在进程 idle 后应立即决定下一步（测试 → 评估 → 迭代/完成），如果需要等待（如 `waiting_confirm`），应定期 touch 进程的 `stoppedAt` 时间戳防止被回收。

## §1 核心状态机

```mermaid
stateDiagram-v2
    [*] --> queued
    queued --> spawning: 调度触发
    spawning --> coding: Claude Code 就绪
    coding --> testing: Claude Code 报告完成 / 达到检查点
    testing --> evaluating: 验证命令执行完毕
    evaluating --> done: 全部通过
    evaluating --> iterating: 失败，未达上限
    evaluating --> blocked: 死循环检测 / 超限
    iterating --> coding: 将失败信息反馈给 Claude Code
    blocked --> coding: 人工介入后恢复
    coding --> blocked: 进程崩溃 / SDK 错误
    spawning --> blocked: 进程启动失败
    done --> delivering: 创建 PR + 通知
    delivering --> blocked: push/PR 失败
    delivering --> [*]

    coding --> waiting_confirm: 命中确认断点
    testing --> waiting_confirm: 命中确认断点
    delivering --> waiting_confirm: 命中确认断点
    waiting_confirm --> coding: 用户批准
    waiting_confirm --> testing: 用户批准
    waiting_confirm --> delivering: 用户批准
    waiting_confirm --> cancelled: 用户拒绝
    cancelled --> [*]
```

### DevTask

```typescript
interface DevTask {
  id: string;
  state: DevTaskState;
  previousState?: DevTaskState; // waiting_confirm 恢复时回到哪个状态
  prompt: string;              // 用户的开发指令
  projectPath: string;         // 目标项目路径
  worktreePath?: string;       // git worktree 隔离路径
  processId?: string;          // AgentSupervisor 进程 ID
  sessionId?: string;          // Claude Code SDK session ID，用于 resume

  // 迭代控制
  iteration: number;           // 当前迭代次数
  maxIterations: number;       // 上限（默认 10）
  maxDurationMs: number;       // 时间上限（默认 4h）
  errorHistory: string[];      // 历史错误，用于死循环检测

  // 验证
  verifyCommands: string[];    // 默认 ["bun test", "bun run check"]
  lastTestResult?: VerifyResult;

  // 确认策略
  confirmPolicy: ConfirmPolicy;

  // 交付
  branch?: string;
  prUrl?: string;

  // 元数据
  triggeredBy: "dashboard" | "channel";
  channelPeer?: Peer;          // 回推通知的目标
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  dagId?: string;              // 所属 DAG（DevLoop 专用 DAG，非 supervisor DAG）
  dagNodeId?: string;
}

type DevTaskState =
  | "queued"
  | "spawning"
  | "coding"
  | "testing"
  | "evaluating"
  | "iterating"
  | "done"
  | "delivering"
  | "blocked"
  | "waiting_confirm"
  | "cancelled";
```

## §2 确认策略（ConfirmPolicy）

四个维度叠加，任意一个命中就暂停等确认：

```typescript
interface ConfirmPolicy {
  // 按操作类型：命中的工具名暂停
  operations: string[];        // 如 ["shell", "file_write", "git_push"]

  // 按阶段：进入该阶段前暂停
  stages: DevTaskStage[];      // 如 ["coding", "testing", "delivering"]

  // 按风险等级：该等级及以上暂停
  riskThreshold: "low" | "medium" | "high" | "none";  // "none" = 全自动

  // 按任务覆盖：DAG 场景下每个 node 可单独配置
}

type DevTaskStage = "coding" | "testing" | "delivering";
```

**判定优先级：** 任务级覆盖 > operations > stages > riskThreshold

**默认策略：**

```typescript
const DEFAULT_CONFIRM_POLICY: ConfirmPolicy = {
  operations: [],
  stages: ["delivering"],      // 默认只在创建 PR 前确认
  riskThreshold: "none",
};
```

**配置入口：**

- 全局：`config.json5` → `agentHub.devLoop.defaultConfirmPolicy`
- 任务级：spawn 时传入 `confirmPolicy` 覆盖
- Channel：`/dev feature X --confirm-stages=coding,delivering --confirm-risk=high`

## §3 迭代判断器（IterationJudge）

`evaluating` 阶段决定下一步：

```typescript
interface JudgeDecision {
  action: "done" | "iterate" | "blocked";
  reason: string;
  feedbackPrompt?: string;     // iterate 时反馈给 Claude Code
}
```

**判断流程：**

1. 测试全部通过 → `done`
2. 超过 maxIterations 或 maxDurationMs → `blocked(超限)`
3. 最近 3 次错误相同模式 → `blocked(死循环)`
4. 否则 → `iterate`

**死循环检测：** 对 `errorHistory` 最近 3 条提取错误关键行，去除行号/时间戳后比对。连续 3 次相同模式 → 死循环。

**feedbackPrompt 模板：**

```
测试失败（第 {n}/{max} 次迭代）。

失败命令：{command}
错误输出：
{stderr 最后 100 行}

请分析错误原因并修复。注意：
- 之前的修复尝试没有解决问题，请尝试不同的方向
- 如果需要更多上下文，请读取相关文件
```

## §4 TestRunner

```typescript
interface TestResult {
  passed: boolean;
  command: string;
  exitCode: number;
  stdout: string;              // 截断到最后 200 行
  stderr: string;              // 截断到最后 200 行
  durationMs: number;
}

interface VerifyResult {
  allPassed: boolean;
  results: TestResult[];       // 短路执行，第一个失败即停止
}
```

**执行规则：**

- 在 worktreePath（或 projectPath）下依次执行 verifyCommands
- 短路：第一个命令失败就停止
- 每个命令超时 5 分钟（可配置 `testTimeoutMs`）
- 用 `Bun.spawn` 执行，环境变量继承父进程但剥离敏感变量（`*_KEY`, `*_SECRET`, `*_TOKEN`, `*_PASSWORD`）
- 可选配置 `testSandbox: "docker"` 使用 Docker 容器隔离（复用现有 `tools.exec.sandbox` 能力）
- stdout/stderr 截断保留尾部

**默认验证命令自动检测：**

1. 读 `package.json` → `scripts.test` 有则用 `bun test`
2. `scripts.lint` / `scripts.check` 有则追加
3. 都没有 → `bun run build`（至少编译通过）

## §5 触发入口

### Dashboard

扩展 SpawnDialog 新增 "Dev Loop" 模式选项卡：

- 任务描述（prompt）
- 目标项目路径
- 验证命令（可编辑列表，自动检测填充）
- 确认策略（操作类型多选、阶段多选、风险等级下拉）
- 迭代上限 / 时间上限
- worktree 隔离开关

ProcessCard 增加迭代进度指示（`第 3/10 次迭代`、当前阶段 badge）。

### Channel 指令

```
/dev <prompt>                          # 最简形式，全部默认配置
/dev <prompt> --path=/path/to/project
/dev <prompt> --verify="bun test && bun run check"
/dev <prompt> --max-iterations=5
/dev <prompt> --confirm-risk=high
/dev status                            # 查看所有 DevTask 状态
/dev stop <taskId>                     # 停止任务
/dev resume <taskId>                   # 人工介入后恢复
/dev approve <taskId>                  # 批准确认断点
```

在 routing 层注册 `/dev` 前缀命令，转发到 `channel-command.ts`，调用 DevLoopController 同一套 API。

## §6 通知推送

| 阶段变化 | 推送内容 |
|---------|---------|
| `queued → spawning` | 任务已开始：{prompt 前50字} |
| `spawning → coding` | Claude Code 已启动，开始编码 |
| `coding → testing` | 编码完成，开始运行测试 |
| `evaluating → done` | 测试通过（第 {n} 次迭代），准备交付 |
| `evaluating → iterating` | 测试失败（第 {n}/{max} 次），自动重试中。错误摘要：{前3行} |
| `evaluating → blocked` | 任务阻塞：{原因}，需要人工介入。/dev resume {id} |
| `waiting_confirm` | 等待确认：{断点原因}。/dev approve {id} |
| `delivering` | PR 已创建：{prUrl} |

**推送目标：**

- `triggeredBy === "channel"` → 推回触发的 Channel peer
- `triggeredBy === "dashboard"` → 推送到 `agentHub.notifyChannel`
- 两者都配了则都推

**配置：** `agentHub.devLoop.notifyEvents`（`null` = 全部推送，`[]` = 不推送，指定数组 = 仅推送列出的阶段）

## §7 交付流程

任务 `done` 后自动执行：

1. 运行 LeakDetector 扫描 worktree diff，检测 secrets/credentials
2. `git add -u`（仅已跟踪文件）+ `git add` 新增的源码文件（排除 `.env*`, `*.key`, `*.pem`, `node_modules/`）
3. `git commit`（在 worktree 中）
4. 生成 branch：`dev-loop/{taskId}-{prompt前20字slugify}`
5. `git push origin {branch}`（失败则重试 1 次，仍失败 → 转 `blocked`）
6. `gh pr create`（失败 → 转 `blocked`，通知用户手动处理）
7. 推送 PR URL 到 Channel
8. 保留 worktree，用户 merge 后手动清理

**交付失败处理**：步骤 5-6 任一失败 → 状态转为 `blocked`，推送错误详情到 Channel，用户可 `/dev resume` 重试。

**PR Body 模板：**

```markdown
## Dev Loop 自动提交

**任务**: {prompt}
**迭代次数**: {iteration}
**耗时**: {duration}
**验证命令**: {verifyCommands.join(" && ")}

## 测试结果
全部通过

## 变更文件
{git diff --stat}

---
由 YanClaw Dev Loop 自动创建
```

**DAG 场景：**

DevLoopController 维护独立的 **DevLoop DAG**（与 supervisor 的 TaskDAG 分离），避免状态模型冲突：
- supervisor DAG node 状态为 `pending/running/completed/failed/skipped`
- DevLoop DAG node 状态为完整的 DevTaskState（含迭代循环）
- DevLoopController 为每个 DAG node 创建独立的 supervisor 进程，但不使用 supervisor 的 DAG 调度
- 依赖管理和拓扑排序由 DevLoopController 自行实现（逻辑可复用 supervisor 的 `topologicalSort`）

流程：
- 当前 node 完成（DevTask 状态 = `done`）→ DevLoopController 标记 node 完成 → 触发下游依赖 node
- 最终 node 完成时创建 PR（中间 node 只 commit 不 PR）
- 可配置为每个 node 独立 PR

## §8 模块结构

```
packages/server/src/agents/dev-loop/
├── controller.ts        # DevLoopController — 主编排器
├── state-machine.ts     # 状态机定义与转换逻辑
├── test-runner.ts       # TestRunner — 执行验证命令
├── iteration-judge.ts   # IterationJudge — 死循环检测 + 迭代决策
├── confirm-gate.ts      # ConfirmationGate — 断点拦截与恢复
├── deliverer.ts         # Deliverer — git commit/push/PR
├── channel-command.ts   # /dev 命令解析器
└── types.ts             # 所有类型定义
```

**集成点：**

| 集成点 | 方式 |
|-------|------|
| AgentSupervisor | DevLoopController 持有引用，调用 spawn/send/stop，监听事件流 |
| ConfirmPolicy ↔ Permission | Claude Code 的 permission_request 经 ConfirmationGate 判定 |
| Notifier | 复用现有 notifier，DevLoopController 发射事件 |
| DAG | DevLoopController 维护独立的 DevLoop DAG（非 supervisor DAG），仅在全部 node 完成后才通知 supervisor |
| Routes | 新增 `routes/dev-loop.ts` → `/api/dev-loop/*` |
| Channel | routing 层注册 `/dev` 前缀命令 |
| Config | `agentHub.devLoop` 新增配置块 |
| Dashboard | 扩展 SpawnDialog + ProcessCard |

**Gateway 初始化：**

```typescript
// gateway.ts — GatewayContext 接口新增可选字段
interface GatewayContext {
  // ... 现有字段
  devLoop?: DevLoopController;  // 仅 devLoop.enabled 时创建
}

// initGateway() 中，在 supervisor 创建之后：
if (hubCfg.devLoop?.enabled) {
  const devLoop = new DevLoopController({
    supervisor,
    notifier: agentHubNotifier ?? null,  // notifier 可为 null，此时仅 SSE 推送
    config,
  });
  ctx.devLoop = devLoop;
}
```

## 配置 Schema

```typescript
// config/schema.ts 新增

const ConfirmPolicySchema = z.object({
  operations: z.array(z.string()).default([]),
  stages: z.array(z.enum(["coding", "testing", "delivering"])).default(["delivering"]),
  riskThreshold: z.enum(["low", "medium", "high", "none"]).default("none"),
});

const DevLoopSchema = z.object({
  enabled: z.boolean().default(false),
  defaultConfirmPolicy: ConfirmPolicySchema.default({}),
  maxIterations: z.number().min(1).max(50).default(10),
  maxDurationMs: z.number().default(4 * 60 * 60 * 1000),   // 4h
  testTimeoutMs: z.number().default(5 * 60 * 1000),         // 5min per command
  testSandbox: z.enum(["none", "docker"]).default("none"),
  notifyEvents: z.array(z.enum([
    "spawning", "coding", "testing", "iterating", "blocked",
    "waiting_confirm", "done", "delivering", "cancelled",
  ])).nullable().default(null),  // null = 全部推送，[] = 不推送
});

// agentHub schema 新增：
agentHub: z.object({
  // ... 现有字段保持不变
  devLoop: DevLoopSchema.default({}),
})
```
