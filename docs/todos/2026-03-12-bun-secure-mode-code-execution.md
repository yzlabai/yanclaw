# Bun Secure Mode 与 YanClaw 代码执行沙箱

> 日期：2026-03-12
> 参考：https://github.com/oven-sh/bun/pull/25911

## 背景

YanClaw 需要一个安全的代码执行环境，让 AI agent 可以生成脚本并在受控环境中运行。之前调研了 Deno 子进程、QuickJS-Wasm 等方案，但 Bun PR #25911 表明 **Bun 即将原生支持 Secure Mode**，这意味着 YanClaw 可以继续使用 Bun 统一技术栈，无需引入额外运行时。

## Bun Secure Mode 分析（PR #25911）

### 当前状态

- **PR 状态**：Open（未合并），38 commits，52/55 测试通过
- **关键限制**：文件系统权限检查尚未落地（`checkFsPermission()` 仍是 stub），网络/子进程/env/sys/ffi 已实现
- **预计**：鉴于 Bun 团队的开发速度和社区需求（#25929），合理预期 2026 年中前合并

### 权限模型

7 种权限类型，与 Deno 兼容且扩展了 Node.js 风格：

| 权限 | Deno 风格 | Node.js 别名 | 作用域示例 |
|------|-----------|-------------|-----------|
| 文件读 | `--allow-read[=paths]` | `--allow-fs-read` | `./workspace,/tmp` |
| 文件写 | `--allow-write[=paths]` | `--allow-fs-write` | `/tmp,./dist` |
| 网络 | `--allow-net[=hosts]` | — | `*.api.example.com,:8000-9000` |
| 环境变量 | `--allow-env[=vars]` | — | `API_KEY,NODE_ENV,AWS_*` |
| 子进程 | `--allow-run[=cmds]` | `--allow-child-process` | `node,npm,git` |
| 系统信息 | `--allow-sys[=resources]` | — | `hostname,cpus` |
| FFI | `--allow-ffi[=paths]` | — | 原生模块路径 |

**核心设计原则**：
- **Deny 优先**：`--deny-*` 始终覆盖 `--allow-*`，防止提权
- **Fail-closed**：无效 pattern 默认拒绝
- **Worker 隔离**：权限按值复制到子 Worker，不可通过引用篡改
- **零开销**：默认模式（不启用 secure）走 fast-path，无性能损失

### 运行时 API

```typescript
// Deno 兼容 API
Bun.permissions.querySync({ name: "read", path: "/tmp" });
// → { state: "granted" | "denied" | "prompt" }

await Bun.permissions.query({ name: "net", host: "api.openai.com" });
await Bun.permissions.request({ name: "env", variable: "API_KEY" });

// Node.js 兼容 API
process.permission.has("fs.read");
process.permission.has("fs.read", "/tmp");
process.permission.has("net", "example.com");
```

### bunfig.toml 配置

```toml
[permissions]
secure = true
allow-read = true
allow-write = ["/tmp", "./dist"]
allow-net = ["localhost:3000", "api.example.com"]
allow-run = ["node", "npm", "git"]
deny-env = ["AWS_SECRET_KEY", "VAULT_*"]
```

### 已实现的检查点

| 模块 | 检查位置 | 状态 |
|------|---------|------|
| `fetch()` / `Bun.serve()` | `webcore/fetch.zig` | ✅ 已实现 |
| `Bun.spawn()` / `Bun.spawnSync()` | `spawn_bindings.zig` | ✅ 已实现 |
| `process.env` / `Bun.env` | `node_process.zig` | ✅ 已实现 |
| `os.hostname()` / `os.cpus()` 等 | `node_os.zig` | ✅ 已实现 |
| `bun:ffi` | `ffi.zig` | ✅ 已实现 |
| `fs.readFile()` / `fs.writeFile()` | `node_fs_binding.zig` | ⚠️ 解析但未强制执行 |

## YanClaw 实现方案

### 设计：统一用 Bun 作为代码执行运行时

```
┌─────────────────────────────────────────────────┐
│ YanClaw Gateway (Bun)                           │
│                                                 │
│  Agent Runtime                                  │
│    │                                            │
│    ├─ shell tool ──→ Docker sandbox (已有)       │
│    │                                            │
│    └─ code_exec tool ──→ Bun --secure 子进程     │
│         │                                       │
│         ├─ 权限从 agent capability 配置映射       │
│         ├─ 临时工作目录隔离                       │
│         ├─ 超时 + 内存限制                       │
│         └─ stdout/stderr 捕获返回给 agent        │
└─────────────────────────────────────────────────┘
```

### 新增工具：`code_exec`

```typescript
// packages/server/src/agents/tools/code-exec.ts

import { tool } from "ai";
import { z } from "zod";

export const codeExecTool = tool({
  description: "在安全沙箱中执行 TypeScript/JavaScript 代码。无文件系统写入权限，网络访问受限。",
  parameters: z.object({
    code: z.string().describe("要执行的 TypeScript/JavaScript 代码"),
    language: z.enum(["typescript", "javascript"]).default("typescript"),
    timeout: z.number().default(30000).describe("超时毫秒数"),
  }),
  execute: async ({ code, language, timeout }) => {
    // 实现见下方
  },
});
```

### 核心执行器

```typescript
// packages/server/src/agents/tools/code-exec-runner.ts

interface CodeExecConfig {
  enabled: boolean;
  runtime: "bun-secure" | "bun-docker" | "off";
  permissions: {
    net: string[] | boolean;     // 允许的域名列表
    read: string[] | boolean;    // 允许读取的路径
    write: string[] | boolean;   // 允许写入的路径（默认 false）
    env: string[] | boolean;     // 允许的环境变量
    run: boolean;                // 是否允许子进程（默认 false）
    sys: boolean;                // 系统信息（默认 false）
    ffi: boolean;                // FFI（默认 false，必须禁止）
  };
  limits: {
    timeoutMs: number;           // 默认 30000
    maxOutputChars: number;      // 默认 50000
  };
  workDir: string;               // 临时工作目录，默认 os.tmpdir()/yanclaw-exec
}

async function executeCode(
  code: string,
  config: CodeExecConfig,
  agentCapabilities: ResolvedCapabilities
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // 1. 写临时脚本文件
  const scriptPath = path.join(config.workDir, `exec-${Date.now()}.ts`);
  await Bun.write(scriptPath, code);

  // 2. 从 agent capability 映射到 Bun permission flags
  const flags = buildPermissionFlags(config.permissions, agentCapabilities);

  // 3. 启动 Bun --secure 子进程
  const proc = Bun.spawn(["bun", "--secure", ...flags, scriptPath], {
    cwd: config.workDir,
    timeout: config.limits.timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    env: filterEnv(config.permissions.env),  // 只传递允许的环境变量
  });

  // 4. 收集输出
  const stdout = await readStream(proc.stdout, config.limits.maxOutputChars);
  const stderr = await readStream(proc.stderr, config.limits.maxOutputChars);
  const exitCode = await proc.exited;

  // 5. 清理临时文件
  await unlink(scriptPath).catch(() => {});

  return { stdout, stderr, exitCode };
}

function buildPermissionFlags(
  permissions: CodeExecConfig["permissions"],
  capabilities: ResolvedCapabilities
): string[] {
  const flags: string[] = [];

  // 网络权限
  if (permissions.net === false) {
    flags.push("--deny-net");
  } else if (Array.isArray(permissions.net)) {
    flags.push(`--allow-net=${permissions.net.join(",")}`);
  } else if (permissions.net === true) {
    flags.push("--allow-net");
  }

  // 文件读权限
  if (permissions.read === false) {
    flags.push("--deny-read");
  } else if (Array.isArray(permissions.read)) {
    flags.push(`--allow-read=${permissions.read.join(",")}`);
  }

  // 写入默认禁止
  if (!permissions.write) {
    flags.push("--deny-write");
  }

  // 子进程默认禁止
  if (!permissions.run) {
    flags.push("--deny-run");
  }

  // FFI 始终禁止
  flags.push("--deny-ffi");

  return flags;
}
```

### 配置集成

```json5
// config.json5
{
  tools: {
    codeExec: {
      enabled: true,
      runtime: "bun-secure",      // Bun secure mode 可用时使用
      permissions: {
        net: ["api.openai.com", "httpbin.org"],  // 允许访问的域名
        read: ["./workspace"],     // 允许读取的路径
        write: false,              // 禁止写入
        env: ["NODE_ENV"],         // 只允许读 NODE_ENV
        run: false,                // 禁止启动子进程
        sys: false,                // 禁止读系统信息
        ffi: false,                // 禁止 FFI（永远）
      },
      limits: {
        timeoutMs: 30000,
        maxOutputChars: 50000,
      },
    }
  }
}
```

### 与现有工具策略集成

`code_exec` 工具在 3 层策略中的位置：

```json5
{
  tools: {
    // 全局策略
    allow: ["code_exec"],   // 全局允许
    // code_exec 自动标记为 ownerOnly = false（安全沙箱内执行，任何人可用）
  },
  agents: {
    researcher: {
      tools: {
        allow: ["code_exec"],
        // 研究 agent: 允许网络但禁止文件写入
        codeExec: { permissions: { net: true, write: false } }
      }
    },
    coder: {
      tools: {
        allow: ["code_exec"],
        // 编码 agent: 允许文件读写但限制网络
        codeExec: { permissions: { read: true, write: ["./workspace"], net: false } }
      }
    }
  }
}
```

## 过渡策略：Bun Secure Mode 合并前

在 Bun Secure Mode 正式合并前，`code_exec` 工具有两个降级路径：

### 降级方案 A：Docker 沙箱（已有基础设施）

```typescript
if (config.runtime === "bun-secure" && !bunSupportsSecureMode()) {
  // 降级到 Docker 执行
  return executeInDocker(code, config);
}
```

YanClaw 已有 Docker sandbox 基础设施，直接复用。

### 降级方案 B：受限 Bun 子进程

在没有 Docker 的环境中，使用操作系统级限制：

```typescript
async function executeWithOsLimits(code: string, config: CodeExecConfig) {
  const proc = Bun.spawn(["bun", scriptPath], {
    cwd: isolatedTmpDir,      // 隔离的临时目录
    timeout: config.limits.timeoutMs,
    env: filterEnv(config.permissions.env),  // 只传最小环境变量
    // 注意：无 --secure flag，安全性依赖目录隔离 + env 过滤
  });
}
```

这种模式安全性较弱，应在配置中标记风险等级：

```json5
{
  tools: {
    codeExec: {
      runtime: "bun-secure",
      fallback: "docker",        // "docker" | "bun-limited" | "off"
      fallbackWarning: true,     // 降级时在日志中警告
    }
  }
}
```

## Bun Secure Mode vs Deno 权限模型对比

| 维度 | Bun Secure Mode (PR #25911) | Deno |
|------|---------------------------|------|
| 启用方式 | `--secure` flag | 默认启用（默认拒绝所有） |
| 权限类型 | 7 种（read/write/net/env/run/sys/ffi） | 10 种（+hrtime/import 等） |
| 网络粒度 | 通配符域名、端口范围、IPv6 | 域名+端口 |
| Deny 优先 | ✅ `--deny-*` 覆盖 `--allow-*` | ✅ 相同 |
| 运行时 API | `Bun.permissions` + `process.permission` | `Deno.permissions` |
| Node.js 兼容 | ✅ `--allow-fs-read` 等别名 | ❌ |
| 配置文件 | `bunfig.toml [permissions]` | `deno.json` |
| 成熟度 | 🔴 PR 阶段，FS 未完成 | 🟢 生产就绪 |
| 性能 | Bun 原生（最快） | V8（略慢于 Bun） |

**结论**：Bun Secure Mode 的设计质量高，与 Deno 对等甚至更好（Node.js 兼容、网络通配符更灵活）。主要风险是**合并时间不确定**和**FS 检查未完成**。

## 为什么选择等待 Bun 而不是引入 Deno

1. **统一技术栈** — YanClaw 全栈 Bun，引入 Deno 意味着维护两个运行时的版本/分发/升级
2. **零额外体积** — Bun 已经随 app 分发，无需额外 58MB
3. **性能一致** — 同一个 V8 引擎优化（Bun 的 JavaScriptCore 实际上比 V8 更快）
4. **API 兼容** — agent 生成的代码用的是 Bun 生态的 API，不需要适配 Deno 的差异
5. **降级方案可用** — Docker sandbox 已经存在，过渡期不影响安全性

## TODO

- [ ] 实现 `code_exec` 工具骨架（先对接 Docker sandbox）
- [ ] 实现权限配置到 Bun/Docker flags 的映射层
- [ ] 在 config schema 中添加 `tools.codeExec` 配置项
- [ ] 添加运行时检测：`bunSupportsSecureMode()` 函数
- [ ] Bun Secure Mode 合并后：切换到 `bun --secure` 子进程
- [ ] 添加 code_exec 到工具策略文档和 onboarding 流程
- [ ] 实现工具循环检测（防止 agent 无限生成+执行代码）
- [ ] 考虑执行结果缓存（相同代码 + 相同输入 = 跳过重复执行）
