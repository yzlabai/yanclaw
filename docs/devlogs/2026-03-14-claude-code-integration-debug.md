# 2026-03-14 Claude Code 对接调试 — SDK 集成端到端验证

> 目标：验证 YanClaw Agent Hub 能否通过 `@anthropic-ai/claude-agent-sdk` 正确调度 Claude Code 子进程。

## 概要

通过 API 端到端测试 Agent Hub → Claude Code 对接，发现并修复了 4 个阻塞性 bug，最终成功 spawn Claude Code 进程并完成工具调用任务。

## 发现与修复

### 1. `skill-loader.ts` package.json 路径错误

`packages/server/src/plugins/skill-loader.ts:4` 中 `../../../package.json` 从 `plugins/` 向上 3 层到达 `packages/server/` 而非项目根目录，导致 `bun --watch` 以外的方式启动时直接崩溃。

**修复**：改为 `../../../../package.json`

### 2. `gateway.ts` 变量引用未定义

`packages/server/src/gateway.ts:94` — `channelManager.sessions = sessions` 中 `sessions` 变量在使用前未声明（`SessionStore` 在第 172 行才创建）。

**原因**：commit `905df53` 新增了 `channelManager.sessions` 赋值，但忘了在上方创建变量。

**修复**：提前创建 `const sessions = new SessionStore()`，ctx 中复用该实例。

### 3. `supervisor/index.ts` 绝对路径拼接错误

| 输入 workDir | 期望结果 | 实际结果 |
|---|---|---|
| `/Users/x/project` | `/Users/x/project` | `/Users/x/.../server/Users/x/project` |

`join(baseDir, config.workDir)` 对绝对路径会产生错误拼接。

**修复**：加 `isAbsolute()` 检查，绝对路径直接使用。

### 4. claude-agent-sdk 版本不一致

| 位置 | 版本 | 结果 |
|---|---|---|
| 根 `node_modules` | 0.2.76 | 正常 |
| `packages/server/node_modules` | 0.2.72 | exit code 1 |

bun workspace 在 server 包下保留了旧版副本。0.2.72 在 bun 环境下调用 `query()` 时子进程直接崩溃，无有用错误信息。

**修复**：统一升级到 `0.2.76`，`bun install --force` 清理缓存。

### 5. PORT 环境变量支持（增强）

`packages/server/src/index.ts:30` 原来硬编码读 `config.gateway.port`，开发时无法与 Tauri 桌面应用（占 18789）共存。

**修复**：`process.env.PORT ? Number(process.env.PORT) : config.gateway.port`

## 文件变更

| 文件 | 操作 | 说明 |
|---|---|---|
| `packages/server/src/plugins/skill-loader.ts` | 修改 | 修正 package.json 相对路径 |
| `packages/server/src/gateway.ts` | 修改 | 提前创建 SessionStore，复用实例 |
| `packages/server/src/agents/supervisor/index.ts` | 修改 | 绝对路径 workDir 不做 join |
| `packages/server/src/agents/supervisor/adapters/claude-code.ts` | 修改 | 增加错误日志 |
| `packages/server/src/index.ts` | 修改 | 支持 PORT 环境变量 |
| `packages/server/package.json` | 修改 | SDK 升级到 0.2.76 |

## 验证结果

```
# 简单对话 — 成功
POST /api/agent-hub/spawn  agentId=claude-coder  task="Say hello"
→ status: idle, tokens: {input: 3, output: 16}

# 工具调用 — 成功
POST /api/agent-hub/spawn  task="Read packages/shared/src/types.ts and list exported types"
→ status: idle, tokens: {input: 4, output: 100}
```

## 调试要点

- Tauri 桌面应用会用编译好的 binary 占 18789 端口，`bun run dev:server` 静默失败但不报错
- `bun workspace` 可能在子包下保留旧版依赖副本，`bun install` 不会自动更新，需要 `--force`
- SDK `query()` 的 exit code 1 错误信息极不友好（输出 minified JS），需要逐步排除
