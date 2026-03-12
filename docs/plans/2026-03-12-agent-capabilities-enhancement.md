# Agent 能力增强开发计划

> 日期：2026-03-12
> 基于：`docs/todos/2026-03-12-bun-secure-mode-code-execution.md` + `docs/plans/openclaw-comparison-and-roadmap.md`

## 背景

YanClaw 在安全性、类型安全和工程质量上已全面超越 OpenClaw，但在**智能体自主能力**和**运行可观测性**上仍有差距。本计划整合代码执行沙箱需求与 OpenClaw 对照分析，制定统一的功能开发路线。

---

## 功能总览

| 阶段 | 功能 | 优先级 | 预估工作量 |
|------|------|--------|-----------|
| P0 | 上下文压缩（Compaction） | 🔴 关键 | 3-5 天 |
| P0 | Token 追踪与成本控制 | 🔴 关键 | 1-2 天 |
| P0 | 工具循环检测 | 🔴 关键 | 1 天 |
| P1 | 代码执行沙箱（code_exec） | 🟠 重要 | 3-4 天 |
| P1 | 心跳机制（Heartbeat） | 🟠 重要 | 2-3 天 |
| P1 | 系统提示构建器 | 🟠 重要 | 2-3 天 |
| P1 | SafeBins 安全白名单 | 🟠 重要 | 1 天 |
| P1 | 记忆增强（MMR + 时间衰减） | 🟠 重要 | 1-2 天 |
| P2 | 会话自动重置 | 🟡 增强 | 1 天 |
| P2 | 会话序列化（防并发） | 🟡 增强 | 1 天 |
| P2 | 线程绑定（Discord） | 🟡 增强 | 2 天 |
| P2 | 渠道内审批 | 🟡 增强 | 2-3 天 |
| P2 | 跨会话通信 | 🟡 增强 | 3 天 |

---

## P0 — 核心补齐（立即开始）

### 1. 上下文压缩（Compaction）

**问题**：长对话撞上下文窗口限制后直接失败，这是目前最致命的功能缺失。

**方案**：

```
Agent Runtime
  │
  ├─ streamText 调用前 → estimateContextUsage()
  │    │
  │    └─ 超过 85% 上下文窗口 → 触发压缩
  │         │
  │         ├─ 1. 记忆冲刷：提取关键事实 → 写入 MemoryStore（FTS5 即时可搜索）
  │         ├─ 2. 分块摘要：用低成本模型压缩旧消息
  │         ├─ 3. 替换：旧消息 → 摘要 + 保留最近 N 条原始消息
  │         └─ 4. 标识符保护：strict 模式下保留所有 UUID/hash/ID
  │
  └─ 继续正常 streamText（无需重试，节省一次 API 调用）
```

**涉及文件**：

| 文件 | 说明 |
|------|------|
| `packages/server/src/agents/compaction.ts` | 新建，压缩引擎核心 |
| `packages/server/src/agents/runtime.ts` | 修改，在 agent loop 中注入压缩检查 |
| `packages/server/src/db/memories.ts` | 修改，添加 `flushFromMessages()` 方法 |
| `packages/server/src/config/schema.ts` | 修改，添加 `compaction` 配置项 |

**配置设计**：

```json5
{
  agents: {
    defaults: {
      compaction: {
        enabled: true,
        model: null,                    // null = 用当前 agent 模型，可配低成本模型
        triggerRatio: 0.85,             // 上下文窗口使用率阈值
        targetRatio: 0.4,              // 压缩后目标比例
        reserveTokens: 4096,           // 预留给新回复的 token
        keepRecentMessages: 10,        // 保留最近消息数
        identifierPolicy: "strict",    // "strict" | "off"
        memoryFlush: {
          enabled: true,               // 压缩前自动冲刷到记忆库
        },
      }
    }
  }
}
```

**优于 OpenClaw 的设计**：
- OpenClaw 压缩后需重试整个请求（浪费一次 API 调用），YanClaw 在发送前检查
- OpenClaw 冲刷到 Markdown 文件需重新索引，YanClaw 直接写 SQLite + FTS5 即时可搜索
- OpenClaw 无标签系统，YanClaw 给自动冲刷记忆打 `auto-flush` 标签方便筛选

---

### 2. Token 追踪与成本控制

**问题**：用户完全无法了解 API 调用成本，无法做优化决策。

**方案**：

| 文件 | 说明 |
|------|------|
| `packages/server/src/db/schema.ts` | 修改，添加 `usage` 表 |
| `packages/server/src/agents/usage-tracker.ts` | 新建，UsageTracker 类 |
| `packages/server/src/agents/model-pricing.ts` | 新建，模型定价表 |
| `packages/server/src/routes/usage.ts` | 新建，用量查询 API |
| `packages/server/src/app.ts` | 修改，挂载 usage 路由 |
| `packages/web/src/pages/Dashboard.tsx` | 修改，添加用量图表 |

**数据模型**（Drizzle schema）：

```typescript
const usageTable = sqliteTable("usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  agentId: text("agent_id").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  cacheReadTokens: integer("cache_read_tokens").default(0),
  cacheWriteTokens: integer("cache_write_tokens").default(0),
  estimatedCostUsd: real("estimated_cost_usd").default(0),
  durationMs: integer("duration_ms").default(0),
  createdAt: integer("created_at").notNull(),
});
```

**API 路由**：

```
GET /api/usage/summary?days=7          — 总用量摘要
GET /api/usage/by-agent?agentId=xxx    — 按 agent 维度
GET /api/usage/by-model?days=30        — 按模型维度
```

**集成点**：在 `streamText` 回调的 `onFinish` 中写入 usage 记录，从 AI SDK 的 `usage` 对象提取 token 数。

**优于 OpenClaw**：OpenClaw 存 JSONL 文件查询慢，YanClaw 用 SQLite SQL 聚合更快，且可在 Web UI Dashboard 直接展示图表。

---

### 3. 工具循环检测

**问题**：Agent 可能陷入无意义的重复工具调用循环，浪费 token。这是 OpenClaw 社区最高频投诉之一。

**方案**：

| 文件 | 说明 |
|------|------|
| `packages/server/src/agents/tools/loop-detector.ts` | 新建，循环检测器 |
| `packages/server/src/agents/runtime.ts` | 修改，在 tool call 前注入检测 |

**检测策略**：

```
追踪最近 30 次调用的 SHA256 哈希
  │
  ├─ 泛型重复检测：同一工具+参数组合 ≥ 10 次
  ├─ 乒乓检测：A→B→A→B... 模式
  ├─ 轮询无进展：poll 类调用输出不变
  │
  ├─ 10 次 → 警告（注入提示让 agent 换策略）
  ├─ 20 次 → 阻断当前工具调用
  └─ 30 次 → 熔断，终止 agent 本轮推理
```

**配置**：

```json5
{
  agents: {
    defaults: {
      loopDetection: {
        enabled: true,
        historySize: 30,
        warningThreshold: 10,
        blockThreshold: 20,
        circuitBreaker: 30,
      }
    }
  }
}
```

---

## P1 — 差异化优势（P0 完成后）

### 4. 代码执行沙箱（code_exec）

**问题**：Agent 目前只能通过 `shell` 工具执行代码，但 shell 是 ownerOnly 且安全性依赖 Docker。需要一个轻量、安全、任何人可用的代码执行环境。

**技术路线**：

```
Bun Secure Mode（PR #25911）
  │
  ├─ 已合并 → 直接使用 bun --secure 子进程
  │
  └─ 未合并 → 降级策略
       ├─ 优先：Docker sandbox（已有基础设施）
       └─ 备选：受限 Bun 子进程（目录隔离 + env 过滤）
```

**涉及文件**：

| 文件 | 说明 |
|------|------|
| `packages/server/src/agents/tools/code-exec.ts` | 新建，工具定义 |
| `packages/server/src/agents/tools/code-exec-runner.ts` | 新建，执行引擎 |
| `packages/server/src/agents/tools/index.ts` | 修改，注册 code_exec 工具 |
| `packages/server/src/config/schema.ts` | 修改，添加 `tools.codeExec` 配置 |

**执行流程**：

```
code_exec tool 调用
  │
  ├─ 1. 写临时脚本到隔离目录
  ├─ 2. 从 agent capability 配置映射权限 flags
  ├─ 3. 检测运行时（bun --secure / docker / bun-limited）
  ├─ 4. 启动沙箱子进程，应用权限限制
  ├─ 5. 超时 + 输出长度限制
  ├─ 6. 捕获 stdout/stderr/exitCode 返回给 agent
  └─ 7. 清理临时文件
```

**权限模型**（7 种，映射到 Bun Secure Mode flags）：

| 权限 | 默认 | 说明 |
|------|------|------|
| `net` | `false` | 网络访问，可配域名白名单 |
| `read` | `["./workspace"]` | 文件读取路径 |
| `write` | `false` | 文件写入，默认禁止 |
| `env` | `["NODE_ENV"]` | 环境变量白名单 |
| `run` | `false` | 子进程，默认禁止 |
| `sys` | `false` | 系统信息 |
| `ffi` | `false` | FFI，永远禁止 |

**与工具策略集成**：`code_exec` 默认 `ownerOnly: false`（沙箱内执行，安全性由权限配置保证），但支持按 agent 覆盖权限集。

**配置示例**：

```json5
{
  tools: {
    codeExec: {
      enabled: true,
      runtime: "bun-secure",
      fallback: "docker",           // "docker" | "bun-limited" | "off"
      fallbackWarning: true,
      permissions: {
        net: ["api.openai.com"],
        read: ["./workspace"],
        write: false,
        env: ["NODE_ENV"],
        run: false, sys: false, ffi: false,
      },
      limits: { timeoutMs: 30000, maxOutputChars: 50000 },
    }
  },
  agents: {
    researcher: {
      tools: {
        codeExec: { permissions: { net: true, write: false } }  // 研究 agent 允许联网
      }
    },
    coder: {
      tools: {
        codeExec: { permissions: { read: true, write: ["./workspace"], net: false } }  // 编码 agent 允许读写
      }
    }
  }
}
```

---

### 5. 心跳机制（Heartbeat）

**问题**：Agent 目前完全被动，只能响应用户消息。缺少定时自主唤醒能力。

**方案**：复用现有 CronManager 基础设施，注册 HeartbeatRunner 作为特殊 CronJob。

| 文件 | 说明 |
|------|------|
| `packages/server/src/infra/heartbeat.ts` | 新建，心跳调度器 |
| `packages/server/src/infra/heartbeat-config.ts` | 新建，配置解析 |
| `packages/server/src/gateway.ts` | 修改，启动时注册心跳 |
| `packages/server/src/config/schema.ts` | 修改，添加 heartbeat 配置 |

**执行流程**：

```
定时器触发 → 检查 activeHours
  │
  ├─ 不在活跃时段 → 跳过
  │
  └─ 在活跃时段 → 读取 HEARTBEAT.md
       │
       ├─ 空文件 → 跳过（零 API 消耗）
       │
       └─ 有任务 → 执行 agent 推理
            │
            ├─ 输出 HEARTBEAT_OK → 静默吞掉，不更新 session.updatedAt
            └─ 有实质输出 → 路由到 target 渠道
```

**配置**：

```json5
{
  agents: {
    defaults: {
      heartbeat: {
        every: "30m",
        activeHours: { start: "08:00", end: "23:00", timezone: "Asia/Shanghai" },
        target: "last",            // "last" | "none" | 渠道ID
        lightContext: false,       // true = 仅注入 HEARTBEAT.md，省 token
        ackToken: "HEARTBEAT_OK",
        ackMaxChars: 300,
      }
    }
  }
}
```

**优于 OpenClaw**：OpenClaw 心跳和 Cron 是两套独立系统，YanClaw 统一在 CronManager 下。

---

### 6. 系统提示构建器

**问题**：当前系统提示是简单拼接，缺少分层控制、Bootstrap 文件注入和 token 预算管理。

| 文件 | 说明 |
|------|------|
| `packages/server/src/agents/system-prompt-builder.ts` | 新建 |
| `packages/server/src/agents/runtime.ts` | 修改，替换现有提示构建逻辑 |
| `packages/server/src/config/schema.ts` | 修改，添加 bootstrap 配置 |

**提示组装顺序**：

```
1. Identity        — agent.systemPrompt 或默认身份
2. Safety          — 安全护栏（权力寻求/监督绕过防护）
3. Tool guidance   — 工具使用指导（mode=full/minimal 时）
4. Bootstrap files — SOUL.md / TOOLS.md / MEMORY.md 等（mode=full 时）
5. Runtime info    — 日期、时区、模型名、工作目录
6. Channel context — 渠道类型、用户身份、会话元数据
```

**提示模式**：

| 模式 | 场景 | 注入内容 |
|------|------|---------|
| `full` | 主会话 | 全部 6 层 |
| `minimal` | Cron/心跳/子智能体 | 1+2+5 |
| `none` | 极简执行 | 仅 1 |

**Bootstrap 文件截断策略**：单文件上限 20,000 chars（70% 头 + 20% 尾），总上限 150,000 chars，可配。

---

### 7. SafeBins 安全白名单

**问题**：`jq`、`grep`、`curl` 等常用管道命令每次都需审批，影响流畅度。

| 文件 | 说明 |
|------|------|
| `packages/server/src/agents/tools/safe-bins.ts` | 新建，白名单定义 + 参数检查 |
| `packages/server/src/approvals/manager.ts` | 修改，SafeBin 命令跳过审批 |

**白名单机制**：对指定命令限制为 stdin-only + 禁止危险参数后，自动放行跳过审批。

```json5
{
  tools: {
    exec: {
      safeBins: ["jq", "grep", "curl", "head", "tail", "wc", "sort", "uniq"],
    }
  }
}
```

---

### 8. 记忆增强

**8.1 MMR 去重**：对搜索结果应用 Maximal Marginal Relevance，避免返回大量语义相近的记忆碎片。

**8.2 时间衰减**：30 天半衰期指数衰减，近期记忆权重更高。

| 文件 | 说明 |
|------|------|
| `packages/server/src/db/memories.ts` | 修改，添加 `applyMMR()` 和 `applyTemporalDecay()` |
| `packages/server/src/config/schema.ts` | 修改，添加 memory 搜索配置 |

---

## P2 — 锦上添花（P1 完成后）

### 9. 会话自动重置

空闲超时（默认 8 小时）或每日定时（凌晨 4 点）自动清空消息历史，保留元数据。在 SessionStore 上添加 `resetSession(id)` 方法。

### 10. 会话序列化（防并发）

用 session lane（`Map<string, Promise>` 串行队列）确保同一会话的请求串行执行，防止并发工具调用导致竞态。

### 11. 线程绑定（Discord）

Discord 线程自动绑定 agent + session，解决群聊多话题混淆。支持空闲超时自动解绑。

### 12. 渠道内审批

允许 owner 通过 Telegram/Slack/Discord 直接回复 `/approve` 或 `/deny` 完成审批，无需打开 Web UI。

### 13. 跨会话通信

新增 `sessions_list`、`sessions_send`、`sessions_history` 工具，支持 agent 之间发消息协作。

---

## 不做的事情

| 功能 | 理由 |
|------|------|
| 20+ 渠道适配器 | 广度不是 YanClaw 的定位，质量优先 |
| 设备节点控制 | 物理设备场景过于 niche，增加攻击面 |
| Canvas / A2UI | 酷但实用性存疑，投入产出比低 |
| SKILL.md 格式兼容 | Markdown-as-code 是 OpenClaw 的安全隐患 |
| Lobster 工作流引擎 | 过度工程化，插件钩子已足够 |

---

## 实施顺序

```
Week 1:  P0 — 上下文压缩 + Token 追踪 + 循环检测
Week 2:  P1a — 代码执行沙箱（骨架 + Docker 降级）+ SafeBins
Week 3:  P1b — 心跳机制 + 系统提示构建器 + 记忆增强
Week 4+: P2 — 会话增强 + 渠道审批 + 跨会话通信
```

**核心原则**：学习 OpenClaw 的智能体能力深度，用 YanClaw 的工程标准实现 — Zod 校验、SQLite 存储、TypeScript 类型安全、安全第一。
