# 2026-03-12 Agent 能力增强 P1 — SafeBins / 记忆增强 / 心跳 / 提示构建器 / 代码执行沙箱

## 概述

实现 Agent 能力增强计划的 P1 五项功能，提升工具审批效率、记忆搜索质量、Agent 自主性、系统提示灵活性和安全代码执行能力。

对照文档：`docs/plans/2026-03-12-agent-capabilities-enhancement.md`

## 1. SafeBins 安全白名单

### 动机

`jq`、`grep`、`curl` 等管道命令每次执行都需审批，严重影响流畅度。需要在保证安全的前提下自动放行常用命令。

### 实现

- **BUILTIN_PROFILES**: 25+ 条内置命令安全配置，每条定义 `maxPositional`（最大位置参数数）和 `deniedFlags`（禁止标志列表）
- **parseCommand()**: 支持引号的命令分词器，自动跳过 `sudo` 和环境变量赋值前缀
- **checkSafeBin()**: 四级检查链 — 二进制名在列表 → 无禁止标志 → 位置参数数量合规 → 管道链各段均安全
- **集成点**: 替换原有 `extractBinary()` 简单匹配，嵌入 shell 工具的审批包装器

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/tools/safe-bins.ts` | 新建 | 安全白名单引擎 |
| `packages/server/src/agents/tools/index.ts` | 修改 | 替换 extractBinary 为 checkSafeBin |

---

## 2. 记忆增强 — MMR 去重 + 时间衰减

### 动机

记忆搜索返回大量语义重复的结果，且不区分新旧记忆的时效性。

### 实现

- **时间衰减 (Temporal Decay)**: 30 天半衰期指数衰减，最低保留 30% 权重，避免彻底遗忘
- **MMR (Maximal Marginal Relevance)**: 基于 Jaccard 词级相似度的多样性感知重排序，`lambda=0.7` 平衡相关性与多样性
- **候选放大**: 搜索时取 `limit * 3` 候选，经衰减 + MMR 后返回 `limit` 条最终结果

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/db/memories.ts` | 修改 | 添加 applyTemporalDecay / applyMMR / jaccardSimilarity |

---

## 3. 心跳机制 (Heartbeat)

### 动机

Agent 完全被动，仅能响应用户消息。需要定时自主唤醒能力，执行巡检、监控等任务。

### 实现

- **HeartbeatRunner 类**: 独立定时器管理器，每个启用心跳的 Agent 注册一个 `setInterval`
- **活跃时段控制**: `activeHours` 配置（start/end/timezone），使用 `Intl.DateTimeFormat` 解析时区，支持跨午夜区间
- **提示来源**: `promptFile`（HEARTBEAT.md 文件）→ `prompt`（内联）→ 默认提示，三级回退
- **OK 响应抑制**: 匹配 `HEARTBEAT_OK`、`OK`、`No action` 等模式，静默丢弃无实质输出
- **输出路由**: `target` 支持 `"none"`（静默）、`"last"`（最近活跃渠道）、具体渠道 ID
- **活跃渠道追踪**: ChannelManager 的 `onAgentActivity` 回调通知 HeartbeatRunner 记录最近活跃渠道
- **热重载**: 配置变更时自动 refresh，停止旧定时器并按新配置重启

### 配置

```json5
{
  agents: [{
    id: "monitor",
    heartbeat: {
      enabled: true,
      interval: "30m",
      promptFile: "HEARTBEAT.md",
      activeHours: { start: 9, end: 22, timezone: "Asia/Shanghai" },
      target: "last",
      suppressOk: true,
    }
  }]
}
```

### 优于 OpenClaw 的设计

- OpenClaw 心跳和 Cron 是两套独立系统；YanClaw HeartbeatRunner 共享 AgentRuntime，统一管理
- OpenClaw 无活跃时段控制，心跳不分昼夜执行；YanClaw 支持时区感知的活跃时段
- OpenClaw 无 OK 响应抑制，每次心跳都产生消息；YanClaw 可静默处理无实质内容的响应

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/cron/heartbeat.ts` | 新建 | HeartbeatRunner 类 |
| `packages/server/src/config/schema.ts` | 修改 | agent.heartbeat 配置项 |
| `packages/server/src/gateway.ts` | 修改 | 初始化 + 启动 + 活跃渠道回调 |
| `packages/server/src/index.ts` | 修改 | 启动序列添加 startHeartbeats |
| `packages/server/src/channels/manager.ts` | 修改 | 添加 onAgentActivity 回调 |

---

## 4. 系统提示构建器 (System Prompt Builder)

### 动机

系统提示是简单字符串拼接，缺少分层控制、Bootstrap 文件注入和 token 预算管理。

### 实现

- **7 层组装**: Identity → Safety → Bootstrap files → Memory → Runtime info → Channel context → Safety suffix
- **3 种提示模式**:
  - `full`: 主会话，注入全部 7 层
  - `minimal`: Cron/心跳/子智能体，仅 Identity + Safety + Runtime + Safety suffix
  - `none`: 极简执行，仅 Identity
- **Bootstrap 文件加载**: 从 workspace 目录读取 SOUL.md / TOOLS.md / MEMORY.md / CONTEXT.md
- **文件截断策略**: 单文件上限 20,000 chars（70% 头 + 20% 尾 + gap 指示器），总上限 150,000 chars
- **可配置**: agent.bootstrap.mode / files / maxFileChars

### 配置

```json5
{
  agents: [{
    id: "main",
    bootstrap: {
      mode: "full",
      files: ["SOUL.md", "TOOLS.md", "MEMORY.md"],
      maxFileChars: 20000,
    }
  }]
}
```

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/system-prompt-builder.ts` | 新建 | 分层提示构建器 |
| `packages/server/src/config/schema.ts` | 修改 | agent.bootstrap 配置项 |
| `packages/server/src/agents/runtime.ts` | 修改 | 替换硬编码拼接为 buildSystemPrompt() |

---

## 5. 代码执行沙箱 (code_exec)

### 动机

Agent 通过 `shell` 执行代码需要 ownerOnly 权限且安全性依赖 Docker。需要一个轻量、安全、非 owner 也可用的代码执行环境。

### 实现

- **三级运行时**: `bun --secure`（首选）→ Docker sandbox（降级）→ 受限 Bun 子进程（最终兜底）
- **运行时自动检测**: `detectRuntime()` 懒加载，首次调用时检测可用运行时
- **7 维权限模型**: net / read / write / env / run / sys / ffi，每项支持 `false`（禁止）/ `true`（全开）/ `string[]`（白名单）
- **安全隔离**:
  - `bun --secure`: 使用 Bun Secure Mode 权限 flags
  - Docker: `--network none` + `--memory 256m` + `--cpus 0.5` + `--pids-limit 100` + `--no-new-privileges`
  - Bun limited: 敏感环境变量过滤 + 目录隔离
- **临时脚本管理**: 写入 `.code-exec-tmp/` 目录，执行后自动清理
- **支持语言**: JavaScript / TypeScript / Python / Bash / Shell
- **非 ownerOnly**: 沙箱保证安全性，任何渠道用户可用
- **能力模型集成**: 新增 `exec:sandbox` 能力，developer 预设自动包含

### 配置

```json5
{
  tools: {
    codeExec: {
      enabled: true,
      runtime: "bun-secure",
      fallback: "bun-limited",
      permissions: {
        net: false,
        read: ["./workspace"],
        write: false,
        env: ["NODE_ENV"],
        run: false, sys: false, ffi: false,
      },
      timeoutMs: 30000,
      maxOutputChars: 50000,
    }
  }
}
```

### 改动文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/tools/code-exec-runner.ts` | 新建 | 执行引擎 + 运行时检测 |
| `packages/server/src/agents/tools/code-exec.ts` | 新建 | code_exec 工具定义 |
| `packages/server/src/agents/tools/index.ts` | 修改 | 注册 code_exec + 能力映射 |
| `packages/server/src/config/schema.ts` | 修改 | tools.codeExec 配置项 |

---

## 验证

- Biome lint: 仅剩 3 个预存问题（sessions.ts regex escape、test 文件 non-null assertion、App.tsx deps）
- Tests: 10 files, 122 passed, 2 skipped
- Server: 可正常启动

## 启动序列更新

```
initGateway → startMcp → startPlugins → startChannels → startCron → startHeartbeats → runSessionCleanup → startMemoryIndexer → hot-reload
```
