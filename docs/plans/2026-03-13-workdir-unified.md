# WorkDir 统一管理 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 统一 Tauri/Server 的数据目录解析，在 API 和 UI 中暴露 dataDir，补齐全局 SOUL.md fallback。

**Architecture:** Tauri 端 `data_dir()` 改读 `YANCLAW_DATA_DIR` 环境变量对齐 Server；Server 在 `/api/system/status` 新增 `dataDir` 字段、启动时打印路径；前端 Settings Gateway tab 展示；bootstrap 加载器增加全局 SOUL.md fallback。

**Tech Stack:** Rust (Tauri IPC), TypeScript (Hono route / React), Bun + Vitest

**需求文档:** `docs/todos/2026-03-11-workdir.md`

**关键发现:** SOUL.md 加载机制**已存在**（`system-prompt-builder.ts` bootstrap 机制），但仅从 agent workspace 目录加载，缺少全局 `{dataDir}/SOUL.md` fallback。热重载也无需额外实现——bootstrap 文件在每次构建 prompt 时重新读取，修改即时生效。

---

## Chunk 1: Backend + Tauri

### Task 1: Tauri `data_dir()` 读取环境变量 + `get_data_dir` IPC

**Files:**
- Modify: `src-tauri/src/lib.rs:23-26` (data_dir 函数)
- Modify: `src-tauri/src/lib.rs:445-453` (invoke_handler 注册)

- [ ] **Step 1: 修改 `data_dir()` 读取 `YANCLAW_DATA_DIR`**

```rust
fn data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("YANCLAW_DATA_DIR") {
        return PathBuf::from(dir);
    }
    dirs_home().join(".yanclaw")
}
```

- [ ] **Step 2: 新增 `get_data_dir` IPC 命令**

在 `get_auth_token` 函数前添加：

```rust
#[tauri::command]
async fn get_data_dir() -> String {
    data_dir().to_string_lossy().to_string()
}
```

- [ ] **Step 3: 注册 IPC handler**

在 `invoke_handler` 的 `generate_handler!` 宏中添加 `get_data_dir`：

```rust
.invoke_handler(tauri::generate_handler![
    get_data_dir,
    get_auth_token,
    // ... 其余不变
])
```

- [ ] **Step 4: 编译验证**

Run: `cd src-tauri && cargo check`
Expected: 编译通过，无 warning

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: Tauri data_dir() reads YANCLAW_DATA_DIR env var, add get_data_dir IPC"
```

---

### Task 2: API 暴露 `dataDir` + 启动日志

**Files:**
- Modify: `packages/server/src/routes/system.ts:47-63` (status 响应)
- Modify: `packages/server/src/index.ts:40` (启动日志)

- [ ] **Step 1: 在 `/api/system/status` 添加 `dataDir` 字段**

`packages/server/src/routes/system.ts` — 在 import 中添加 `resolveDataDir`，在响应 JSON 中添加字段：

```typescript
import { resolveDataDir } from "../config/store";
```

在 `return c.json({` 块中（`name` 字段后面）添加：

```typescript
dataDir: resolveDataDir(),
dataDirIsDefault: !process.env.YANCLAW_DATA_DIR,
```

- [ ] **Step 2: 启动日志打印数据目录 + 空目录安全提示**

`packages/server/src/index.ts:40` — 在现有启动日志后添加数据目录日志和安全检查：

在文件顶部 import 区域添加：

```typescript
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveDataDir } from "./config/store";
```

在 `main()` 函数体内、`console.log(... running on ...)` 之前，添加辅助函数：

```typescript
/** Normalize a path for reliable comparison (resolve symlinks, trailing slashes). */
function normalizePath(p: string): string {
	try { return realpathSync(resolve(p)); } catch { return resolve(p); }
}
```

在 `console.log(... running on ...)` 之后：

```typescript
const dataDir = resolveDataDir();
const defaultDir = join(homedir(), ".yanclaw");
console.log(`[gateway] Data directory: ${dataDir}`);

// Warn if custom dataDir has no config but default dir does (likely accidental switch)
if (normalizePath(dataDir) !== normalizePath(defaultDir)) {
	const hasConfig = existsSync(join(dataDir, "config.json5"));
	const defaultHasConfig = existsSync(join(defaultDir, "config.json5"));
	if (!hasConfig && defaultHasConfig) {
		console.warn(
			`[gateway] WARNING: ${dataDir} has no config.json5. ` +
			`Previous data exists at ${defaultDir}. ` +
			`Unset YANCLAW_DATA_DIR to use default, or copy files manually.`
		);
	}
}
```

- [ ] **Step 3: 验证**

Run: `bun run check`
Expected: lint 通过

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/system.ts packages/server/src/index.ts
git commit -m "feat: expose dataDir in /api/system/status, log data directory on startup"
```

---

### Task 3: 全局 SOUL.md fallback

**Files:**
- Modify: `packages/server/src/agents/system-prompt-builder.ts:138-170` (loadBootstrapFiles)
- Create: `packages/server/src/agents/system-prompt-builder.test.ts`

当前 `loadBootstrapFiles` 只从一个目录（agent workspace）加载 bootstrap 文件。需要增加：对于 SOUL.md，若 workspace 中不存在，fallback 到 `{dataDir}/SOUL.md`。

- [ ] **Step 1: 写测试**

```typescript
// packages/server/src/agents/system-prompt-builder.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSystemPrompt } from "./system-prompt-builder";
import type { Config } from "../config/schema";

// Minimal config for testing — only fields accessed by buildSystemPrompt
const minimalConfig = {
	agents: [{ id: "test-agent", bootstrap: { mode: "full" } }],
} as unknown as Config;

describe("buildSystemPrompt — SOUL.md fallback", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await mkdtemp(join(tmpdir(), "yanclaw-test-"));
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await rm(tempDir, { recursive: true, force: true });
	});

	it("loads SOUL.md from workspace dir", async () => {
		const wsDir = join(tempDir, "workspace", "test-agent");
		await mkdir(wsDir, { recursive: true });
		await writeFile(join(wsDir, "SOUL.md"), "Agent-specific soul");

		const prompt = await buildSystemPrompt({
			agentId: "test-agent",
			systemPrompt: "You are helpful.",
			config: minimalConfig,
			mode: "full",
			workspaceDir: wsDir,
		});

		expect(prompt).toContain("Agent-specific soul");
	});

	it("falls back to global SOUL.md when workspace has none", async () => {
		const wsDir = join(tempDir, "workspace", "test-agent");
		await mkdir(wsDir, { recursive: true });
		// No SOUL.md in workspace, but one at dataDir root
		await writeFile(join(tempDir, "SOUL.md"), "Global soul");

		vi.stubEnv("YANCLAW_DATA_DIR", tempDir);

		const prompt = await buildSystemPrompt({
			agentId: "test-agent",
			systemPrompt: "You are helpful.",
			config: minimalConfig,
			mode: "full",
			workspaceDir: wsDir,
		});

		expect(prompt).toContain("Global soul");
	});

	it("prefers workspace SOUL.md over global", async () => {
		const wsDir = join(tempDir, "workspace", "test-agent");
		await mkdir(wsDir, { recursive: true });
		await writeFile(join(wsDir, "SOUL.md"), "Agent soul");
		await writeFile(join(tempDir, "SOUL.md"), "Global soul");

		vi.stubEnv("YANCLAW_DATA_DIR", tempDir);

		const prompt = await buildSystemPrompt({
			agentId: "test-agent",
			systemPrompt: "You are helpful.",
			config: minimalConfig,
			mode: "full",
			workspaceDir: wsDir,
		});

		expect(prompt).toContain("Agent soul");
		expect(prompt).not.toContain("Global soul");
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun run test -- packages/server/src/agents/system-prompt-builder.test.ts`
Expected: "falls back to global SOUL.md" FAIL（当前无 fallback 逻辑）

- [ ] **Step 3: 实现全局 SOUL.md fallback**

修改 `packages/server/src/agents/system-prompt-builder.ts` 的 `loadBootstrapFiles` 函数。在文件读取循环中，对 `SOUL.md` 增加 fallback：

```typescript
async function loadBootstrapFiles(
	baseDir: string,
	config: Config,
	agentId: string,
): Promise<string | null> {
	const bootstrapConfig = config.agents.find((a) => a.id === agentId)?.bootstrap;
	const fileNames = bootstrapConfig?.files ?? BOOTSTRAP_FILES;

	const parts: string[] = [];
	let totalChars = 0;

	for (const fileName of fileNames) {
		if (totalChars >= MAX_TOTAL_BOOTSTRAP_CHARS) break;

		const maxForFile = bootstrapConfig?.maxFileChars ?? MAX_FILE_CHARS;
		const budget = Math.min(maxForFile, MAX_TOTAL_BOOTSTRAP_CHARS - totalChars);

		// Try workspace dir first
		let content = await tryReadFile(resolve(baseDir, fileName));

		// SOUL.md fallback: if not found in workspace, try global dataDir
		// (No path guard needed — !content already prevents double-loading
		// when baseDir IS the dataDir, since the same file would have been read above)
		if (!content && fileName === "SOUL.md") {
			content = await tryReadFile(resolve(resolveDataDir(), "SOUL.md"));
		}

		if (!content) continue;

		const truncated = truncateFile(content, budget);
		parts.push(`<bootstrap file="${fileName}">\n${truncated}\n</bootstrap>`);
		totalChars += truncated.length;
	}

	return parts.length > 0 ? parts.join("\n\n") : null;
}

/** Read a file, returning its trimmed content or null if it doesn't exist/is empty. */
async function tryReadFile(filePath: string): Promise<string | null> {
	try {
		const content = await readFile(filePath, "utf-8");
		return content.trim() || null;
	} catch {
		return null;
	}
}
```

同时删除原来循环体内的 try-catch 内联读取逻辑（已提取为 `tryReadFile`）。

同时清理多余的 `resolveDataDir` 参数：
- `system-prompt-builder.ts:65` — `resolveDataDir(ctx.config)` → `resolveDataDir()`
- `cron/heartbeat.ts:162` — `resolveDataDir(config)` → `resolveDataDir()`

- [ ] **Step 4: 运行测试确认通过**

Run: `bun run test -- packages/server/src/agents/system-prompt-builder.test.ts`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agents/system-prompt-builder.ts packages/server/src/agents/system-prompt-builder.test.ts
git commit -m "feat: global SOUL.md fallback when agent workspace has none"
```

---

## Chunk 2: Frontend

### Task 4: 前端展示 dataDir + Tauri IPC wrapper

**Files:**
- Modify: `packages/web/src/lib/tauri.ts` (新增 getDataDir)
- Modify: `packages/web/src/pages/Settings.tsx:486-499` (Gateway tab)

- [ ] **Step 1: 添加 `getDataDir` IPC wrapper**

在 `packages/web/src/lib/tauri.ts` 的 `getAuthToken` 函数后添加。此 wrapper 当前虽未直接使用（前端通过 HTTP API 获取 dataDir），但在 Tauri 模式下 server 尚未启动时需要通过 IPC 获取路径，保留备用：

```typescript
/** Get the data directory path via Tauri IPC. Returns null if not in Tauri. */
export async function getDataDir(): Promise<string | null> {
	if (!isTauri()) return null;
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<string>("get_data_dir");
	} catch {
		return null;
	}
}
```

- [ ] **Step 2: Settings Gateway tab 展示 dataDir**

修改 `packages/web/src/pages/Settings.tsx`：

1. 新增 state：

```typescript
const [dataDir, setDataDir] = useState<string | null>(null);
const [dataDirIsDefault, setDataDirIsDefault] = useState(true);
```

2. 在现有 `useEffect` 中（`apiFetch` 调用之后），从 `/api/system/status` 获取 dataDir：

```typescript
apiFetch(`${API_BASE}/api/system/status`)
	.then((r) => r.json())
	.then((status: { dataDir?: string; dataDirIsDefault?: boolean }) => {
		if (status.dataDir) {
			setDataDir(status.dataDir);
			setDataDirIsDefault(status.dataDirIsDefault ?? true);
		}
	})
	.catch(() => {});
```

3. 在 Gateway TabsContent 中，Port 输入框之前，添加 dataDir 展示（含默认/自定义标识）：

```tsx
{dataDir && (
	<div>
		<label className={labelCls}>Data Directory</label>
		<div className="bg-muted rounded-xl px-4 py-2 text-sm text-foreground/80 font-mono flex items-center gap-2">
			<span>{dataDir}</span>
			<span className="text-xs text-muted-foreground">
				{dataDirIsDefault ? "(默认)" : "(自定义)"}
			</span>
		</div>
	</div>
)}
```

- [ ] **Step 3: 验证**

Run: `bun run check`
Expected: lint 通过

- [ ] **Step 4: 手动验证**

Run: `bun run dev & bun run dev:server`

1. 检查终端输出包含 `[gateway] Data directory: /Users/.../.yanclaw`
2. 打开 `http://localhost:5173`，进入 Settings → Gateway tab，确认显示 Data Directory
3. 调用 `curl -s http://localhost:18789/api/system/status | jq .dataDir` 确认返回路径

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/tauri.ts packages/web/src/pages/Settings.tsx
git commit -m "feat: display data directory in Settings Gateway tab"
```

---

## 设计决策：切换工作目录时的数据迁移

### 问题

用户设置 `YANCLAW_DATA_DIR` 指向新目录后重启，如果不做任何处理：

- `config.json5` 不存在 → 进入 onboarding 重新配置
- `data.db` 不存在 → 所有会话、消息历史消失
- `vault.json` 不存在 → 所有 API key 丢失
- `media/` 空 → 聊天中的图片/文件全部 404
- `workspace/` 空 → agent 记忆、SOUL.md 全没了

**改一个目录设置 → 丢失全部数据，违反最小惊讶原则。**

### 两种用户意图

| 意图 | 类比 | 期望行为 |
|---|---|---|
| **搬家**：数据迁移到新位置 | Docker Desktop 移动磁盘映像 | 自动复制所有文件到新目录 |
| **新档**：创建全新隔离环境 | Chrome Profile、Obsidian Vault | 明确提示"将创建全新环境"，不迁移 |

### 当前 scope 的做法（env var 级别，无 UI 切换）

本次不实现 UI 级目录切换（需求文档"后续可考虑"），但需要在 **Server 启动时增加安全检查**：

```
场景：YANCLAW_DATA_DIR 指向一个无 config.json5 的目录
```

**启动时行为：**

1. 检测目标目录是否有 `config.json5`
2. 如果没有，且默认目录 `~/.yanclaw/config.json5` 存在（说明是从默认目录切换过来的）：
   - 日志 WARN：`[gateway] Data directory /new/path has no config. Previous data exists at ~/.yanclaw. Set YANCLAW_DATA_DIR back or copy files manually.`
   - 正常启动（进入 onboarding），不自动迁移
3. 如果两边都没有：正常首次启动

**为什么不自动迁移：**
- env var 切换是 power user 操作，用户应理解后果
- 自动复制大量文件（media/、db）可能耗时且有部分失败风险
- 无法区分"搬家"还是"新档"意图

### 后续 UI 切换时（不在本次 scope）

当实现 UI 内目录切换时，应提供明确的二选一：

```
┌─────────────────────────────────────┐
│  切换工作目录                         │
│                                     │
│  新路径: [___________________] [选择] │
│                                     │
│  ○ 迁移数据到新目录                   │
│    复制所有配置、数据库、媒体文件       │
│                                     │
│  ○ 创建全新环境                       │
│    新目录将从零开始配置                │
│                                     │
│  [取消]              [确认并重启]     │
└─────────────────────────────────────┘
```

---

## 不需要做的（需求文档勘误）

| 需求文档描述 | 实际情况 |
|---|---|
| "SOUL.md 机制缺失" | **已存在。** `system-prompt-builder.ts:39-44` 定义了 `BOOTSTRAP_FILES = ["SOUL.md", ...]`，`loadBootstrapFiles` 从 workspace 目录加载。真正缺的只是全局 fallback。 |
| "需处理热重载" | **无需额外实现。** bootstrap 文件在每次 `buildSystemPrompt()` 调用时重新读取（每条消息触发），修改即时生效。 |
| "与 config.systemPrompt 合并而非替代" | **已是合并。** systemPrompt 是 prompt 的 layer 1（Identity），SOUL.md 是 layer 3（Bootstrap），两者拼接在最终 prompt 中。 |
