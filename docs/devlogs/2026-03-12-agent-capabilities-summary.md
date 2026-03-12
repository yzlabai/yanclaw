# 2026-03-12 Agent 能力增强 — 总结

## 概述

本次开发为 YanClaw Agent 系统新增 13 项能力，分三个优先级交付，并经过完整 code review 修复了 6 个安全/正确性问题。所有变更通过 122 个测试用例验证，可发布 0.7.0 版本。

对照计划文档：`docs/plans/2026-03-12-agent-capabilities-enhancement.md`

## 功能矩阵

### P0 — 运行时稳定性（3 项）

| 功能 | 说明 | 关键文件 |
|------|------|----------|
| 上下文压缩 | 对话过长时自动保留摘要 + 近期消息，支持多模态消息保护 | `agents/compaction.ts`, `runtime.ts` |
| 用量追踪 | 每次 LLM 调用记录 token 用量，按 agent/session 统计，API 可查 | `agents/usage-tracker.ts`, `routes/usage.ts` |
| 循环检测 | 5 步内工具调用序列重复 ≥3 次自动中断，防止无限循环 | `agents/tools/loop-detector.ts`, `runtime.ts` |

### P1 — 工具与自主性（5 项）

| 功能 | 说明 | 关键文件 |
|------|------|----------|
| SafeBins 安全白名单 | 25+ 常用命令免审批，含子命令/flag/位置参数三级检查 | `agents/tools/safe-bins.ts` |
| 记忆增强 | MMR 去重 + 30 天半衰期时间衰减，候选放大 3× 再筛选 | `db/memories.ts` |
| 心跳机制 | 定时自主唤醒，支持活跃时段、OK 响应抑制、输出路由 | `cron/heartbeat.ts` |
| 系统提示构建器 | 7 层分层组装（Identity→Safety→Bootstrap→Memory→Runtime→Channel→Suffix），3 种模式 | `agents/system-prompt-builder.ts` |
| 代码执行沙箱 | bun --secure → Docker → bun-limited 三级运行时，7 维权限模型 | `agents/tools/code-exec-runner.ts`, `code-exec.ts` |

### P2 — 会话与协作（5 项）

| 功能 | 说明 | 关键文件 |
|------|------|----------|
| 会话自动重置 | 空闲超时 + 每日定时重置，时区感知调度 | `db/sessions.ts`, `gateway.ts` |
| 会话序列化 | 同会话请求串行执行，防止并发竞态 | `agents/runtime.ts` |
| 线程绑定 | Discord/Slack 线程自动绑定独立会话 | `routing/resolve.ts`, `channels/manager.ts` |
| 渠道内审批 | `/approve`/`/deny` 命令在渠道内直接审批工具调用 | `approvals/manager.ts`, `channels/manager.ts` |
| 跨会话通信 | session_list/send/history 三工具，支持 agent 间协作 | `agents/tools/session-comm.ts` |

## Code Review 修复

| 级别 | 问题 | 修复 |
|------|------|------|
| Critical | system-prompt-builder 硬编码 agents[0] | 按 agentId 查找 |
| Critical | git 危险子命令绕过 safe-bins 检查 | 新增 deniedSubcommands 字段 |
| Critical | 跨会话通信无访问控制 | 限制同 agent 内通信 |
| Critical | 自动重置定时器内存泄漏 | 追踪定时器引用，热重载清理 |
| High | curl 可通过 -o 写文件 | 补充 -o/-O/-K 限制 |
| High | 沙箱 env 过滤遗漏 + timer 泄漏 | 扩展过滤正则 + finally 清理 |

## 启动序列

```
initGateway → startMcp → startPlugins → startChannels → startCron → startHeartbeats → runSessionCleanup → startMemoryIndexer → hot-reload
```

## 配置新增

```json5
{
  agents: [{
    bootstrap: { mode: "full", files: ["SOUL.md"], maxFileChars: 20000 },
    heartbeat: { enabled: true, interval: "30m", activeHours: { start: 9, end: 22, timezone: "Asia/Shanghai" } },
  }],
  session: {
    autoReset: { enabled: true, idleTimeout: "8h", dailyResetTime: "04:00", timezone: "Asia/Shanghai" }
  },
  tools: {
    codeExec: { enabled: true, runtime: "bun-secure", permissions: { net: false, read: ["./workspace"], write: false } }
  }
}
```

## 能力模型新增

- `exec:sandbox` — 代码执行沙箱（developer 预设自动包含）
- `session:read` — 跨会话列表/历史
- `session:write` — 跨会话发送（ownerOnly）

## 验证

- Tests: 10 files, 122 passed, 2 skipped
- Lint: 仅 3 个预存 warning（非本次变更）
- Build: server 9.23 MB + web 689 kB，正常构建
- Server: 可正常启动

## 变更统计

- 29 files changed, +3498 lines
- 15 个新文件，14 个修改文件
- 4 个 devlog + 1 个计划文档
