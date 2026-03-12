# 2026-03-12 Agent 能力增强 — Code Review 及修复

## 概述

对 P0/P1/P2 全部 13 项功能的代码进行全面 review，发现 6 个 Critical/High 级别问题和 3 个 Medium 级别问题。Critical/High 全部修复。

## Critical 级别修复

### 1. System Prompt Builder — agent[0] 硬编码 (system-prompt-builder.ts)

**问题**: `loadBootstrapFiles()` 使用 `config.agents[0]?.bootstrap` 硬编码取第一个 agent 的配置，多 agent 场景下所有 agent 都会使用第一个 agent 的 bootstrap 配置。

**修复**: 将 `agentId` 传递到 `loadBootstrapFiles()`，使用 `config.agents.find(a => a.id === agentId)` 查找正确的 agent 配置。

### 2. SafeBins — Git 危险子命令绕过 (safe-bins.ts)

**问题**: `git push`、`git reset --hard` 等危险子命令被放在 `deniedFlags` 中，但子命令是位置参数不以 `-` 开头，永远不会被 flag 检查匹配到。

**修复**:
- 新增 `deniedSubcommands` 字段，将危险子命令（push/reset/checkout/clean/rm/mv/rebase/merge/commit/stash/remote/config）移入
- 在 `checkSafeBin()` 中添加子命令检查逻辑，在 flag 检查之前执行
- 子命令通过 `args.find(a => !a.startsWith("-"))` 识别第一个非 flag 参数

### 3. 跨会话通信无访问控制 (session-comm.ts)

**问题**: `session_send` 工具可以向任意 agent 的任意会话发送消息，缺乏基本的访问控制。恶意用户可以通过渠道消息跨 agent 污染会话。

**修复**: 添加 `currentAgentId` 参数，在发送前验证目标会话的 `agentId` 必须与当前 agent 一致。跨 agent 通信被拒绝。

### 4. Gateway 自动重置定时器内存泄漏 (gateway.ts)

**问题**: `setInterval`（30分钟空闲检查）和递归 `setTimeout`（每日重置）创建后未保存引用。热重载时旧定时器无法清理，导致多个定时器叠加执行。

**修复**:
- 新增 `autoResetTimers` 数组收集所有定时器引用
- 新增 `clearAutoResetTimers()` 清理函数
- `runSessionCleanup()` 入口处先清理旧定时器
- `scheduleDailyReset()` 中的 `setTimeout` 也纳入追踪

## High 级别修复

### 5. curl 文件写入限制不完整 (safe-bins.ts)

**问题**: curl 的 `deniedFlags` 缺少 `-o`/`--output`（写入文件）、`-O`/`--remote-name`（使用远程文件名保存）和 `-K`/`--config`（读取配置文件，可能包含凭证）。

**修复**: 在 deniedFlags 中补充 `-o`、`--output`、`-O`、`--remote-name`、`-K`、`--config`。

### 6. 代码执行沙箱环境变量过滤不完整 + 超时 timer 泄漏 (code-exec-runner.ts)

**问题**:
- `SENSITIVE` 正则只匹配 `_API_KEY`/`_SECRET` 等后缀，遗漏 `DATABASE_URL`、`VAULT_*`、`OPENAI_*`、`ANTHROPIC_*`、`SLACK_*`、`DISCORD_*`、`TELEGRAM_*` 等完整环境变量名
- 超时 `timer` 的 `clearTimeout` 在 try 块正常路径中，catch 异常路径下不会清理

**修复**:
- 扩展正则为复合模式，增加完整变量名匹配
- 将 `timer` 声明提到 try 外部，`clearTimeout` 移到 `finally` 块

## Medium 级别（已知，暂不修复）

### 7. 每日重置时间边界

**问题**: 午夜附近 `msUntilReset` 可能计算出极短间隔（几秒），导致提前触发。

**缓解**: 将 `<= 0` 判断改为 `<= 60_000`，不足 1 分钟时推迟到次日。

### 8. SessionLanes 并发残留

sessionLanes Map 在极端并发下 lane 引用比较可能不一致，留下残余 entry。实际影响极小（仅内存，不影响功能），暂不处理。

### 9. Docker 内存限制硬编码

`--memory 256m` 对某些数据处理脚本可能不足。建议后续从 `codeExec` 配置中读取，当前硬编码可接受。

## 验证

- Biome lint: 仅剩 1 个预存的 React hook 依赖 warning
- Tests: 10 files, 122 passed, 2 skipped
- Server: 可正常启动

## 改动文件汇总

| 文件 | 修复项 |
|------|--------|
| `packages/server/src/agents/system-prompt-builder.ts` | #1 agent[0] → find by agentId |
| `packages/server/src/agents/tools/safe-bins.ts` | #2 子命令检查 + #5 curl 限制 |
| `packages/server/src/agents/tools/session-comm.ts` | #3 跨 agent 访问控制 |
| `packages/server/src/agents/tools/index.ts` | #3 传递 currentAgentId |
| `packages/server/src/gateway.ts` | #4 定时器追踪 + #7 时间边界 |
| `packages/server/src/agents/tools/code-exec-runner.ts` | #6 env 过滤 + timer finally |
