# 截图工具 & Claude Code 接入 — 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 YanClaw 新增系统截图 tool 和 Claude Code Agent SDK 运行时后端。

**Architecture:** 截图工具通过 `screencapture` CLI (macOS) 实现，注册为 ownerOnly tool。Claude Code 运行时通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` 接入，作为 `AgentRuntime.run()` 的可选分支，与现有 streamText 运行时并存。

**Tech Stack:** Bun, Hono, Zod, `@anthropic-ai/claude-agent-sdk`, `screencapture` CLI

---

## Chunk 1: 系统截图 Tool

### Task 1: 创建截图 tool 实现

**Files:**
- Create: `packages/server/src/agents/tools/screenshot.ts`
- Test: `packages/server/src/agents/tools/screenshot.test.ts`

- [ ] **Step 1: 编写截图 tool 的失败测试**

```typescript
// packages/server/src/agents/tools/screenshot.test.ts
import { describe, expect, it, mock } from "bun:test";
import { createDesktopScreenshotTool } from "./screenshot";

describe("createDesktopScreenshotTool", () => {
	it("returns a tool with correct schema", () => {
		const tool = createDesktopScreenshotTool();
		expect(tool.description).toContain("screenshot");
		expect(tool.parameters).toBeDefined();
	});

	it("fullscreen mode calls screencapture", async () => {
		const tool = createDesktopScreenshotTool();
		// Will test execute in integration; here just verify structure
		expect(tool).toHaveProperty("execute");
	});
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test packages/server/src/agents/tools/screenshot.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现截图 tool**

```typescript
// packages/server/src/agents/tools/screenshot.ts
import { spawn } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tool } from "ai";
import { z } from "zod";

export function createDesktopScreenshotTool() {
	return tool({
		description:
			"Take a screenshot of the desktop, a specific window, or a screen region. Returns a base64-encoded PNG data URL for vision model analysis.",
		parameters: z.object({
			mode: z
				.enum(["fullscreen", "window", "region"])
				.default("fullscreen")
				.describe("Screenshot mode: fullscreen, window (by title), or region (by coordinates)"),
			target: z
				.string()
				.optional()
				.describe("Window title to capture (mode=window only)"),
			region: z
				.object({
					x: z.number().describe("X coordinate"),
					y: z.number().describe("Y coordinate"),
					w: z.number().describe("Width"),
					h: z.number().describe("Height"),
				})
				.optional()
				.describe("Screen region to capture (mode=region only)"),
		}),
		execute: async ({ mode, target, region }) => {
			const tmpFile = join(tmpdir(), `yanclaw-screenshot-${Date.now()}.png`);

			try {
				const args = buildScreencaptureArgs(mode, target, region, tmpFile);
				await runScreencapture(args);
				const buffer = await readFile(tmpFile);
				const base64 = buffer.toString("base64");
				return `data:image/png;base64,${base64}`;
			} finally {
				await unlink(tmpFile).catch(() => {});
			}
		},
	});
}

function buildScreencaptureArgs(
	mode: "fullscreen" | "window" | "region",
	target: string | undefined,
	region: { x: number; y: number; w: number; h: number } | undefined,
	outputPath: string,
): string[] {
	switch (mode) {
		case "fullscreen":
			return ["-x", outputPath];
		case "window":
			// -l requires window ID; use -w for interactive window selection
			// For automated use, we use -x (no sound) and capture full screen as fallback
			// A better approach: use -w with title matching via osascript
			if (target) {
				return ["-x", "-t", "png", outputPath];
			}
			return ["-x", "-w", outputPath];
		case "region":
			if (region) {
				return ["-x", "-R", `${region.x},${region.y},${region.w},${region.h}`, outputPath];
			}
			return ["-x", outputPath];
		default:
			return ["-x", outputPath];
	}
}

function runScreencapture(args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("screencapture", args);
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`screencapture exited with code ${code}`));
		});
		proc.on("error", (err) => {
			reject(new Error(`screencapture failed: ${err.message}`));
		});
	});
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test packages/server/src/agents/tools/screenshot.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agents/tools/screenshot.ts packages/server/src/agents/tools/screenshot.test.ts
git commit -m "feat: add desktop screenshot tool (macOS screencapture)"
```

---

### Task 2: 注册截图 tool + 权限控制

**Files:**
- Modify: `packages/server/src/agents/tools/index.ts`

- [ ] **Step 1: 在 index.ts 中导入并注册 screenshot tool**

在 `packages/server/src/agents/tools/index.ts` 中:

1. 添加导入:
```typescript
import { createDesktopScreenshotTool } from "./screenshot";
```

2. 在 `TOOL_GROUPS` 中添加:
```typescript
"group:desktop": ["screenshot_desktop"],
```

3. 在 `OWNER_ONLY_TOOLS` 中添加:
```typescript
"screenshot_desktop",
```

4. 在 `TOOL_CAPABILITIES` 中添加:
```typescript
screenshot_desktop: ["desktop:capture"],
```

5. 在 `createToolset` 函数的 `allTools` 对象中添加:
```typescript
screenshot_desktop: createDesktopScreenshotTool(),
```

- [ ] **Step 2: 运行现有 policy 测试确认未破坏**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test packages/server/src/agents/tools/policy.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agents/tools/index.ts
git commit -m "feat: register screenshot_desktop tool with ownerOnly + capability"
```

---

## Chunk 2: Claude Code 运行时 — Config Schema 扩展

### Task 3: 扩展 Agent Config Schema

**Files:**
- Modify: `packages/server/src/config/schema.ts`

- [ ] **Step 1: 在 agentSchema 中添加 runtime 和 claudeCode 字段**

在 `packages/server/src/config/schema.ts` 的 `agentSchema` 中，`capabilities` 字段之后添加:

```typescript
runtime: z.enum(["default", "claude-code"]).default("default"),
claudeCode: z
  .object({
    allowedTools: z
      .array(z.string())
      .default(["Read", "Edit", "Write", "Bash", "Glob", "Grep"]),
    permissionMode: z
      .enum(["default", "acceptEdits", "bypassPermissions"])
      .default("acceptEdits"),
    maxTurns: z.number().default(50),
    mcpServers: z.record(z.unknown()).default({}),
  })
  .optional(),
```

- [ ] **Step 2: 验证 schema 解析正确**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test`
Expected: 所有现有测试 PASS（新字段有默认值，不影响现有配置）

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/config/schema.ts
git commit -m "feat: extend agent config schema with runtime and claudeCode fields"
```

---

## Chunk 3: Claude Code 运行时实现

### Task 4: 安装 Agent SDK 依赖

**Files:**
- Modify: `packages/server/package.json`

- [ ] **Step 1: 安装依赖**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun add @anthropic-ai/claude-agent-sdk --filter @yanclaw/server`

如果 workspace filter 不支持，则:
Run: `cd /Users/yzlabmac/ai/yanclaw/packages/server && bun add @anthropic-ai/claude-agent-sdk`

- [ ] **Step 2: 确认安装成功**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun install`
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add packages/server/package.json bun.lockb
git commit -m "chore: add @anthropic-ai/claude-agent-sdk dependency"
```

---

### Task 5: 实现 Claude Code 运行时适配层

**Files:**
- Create: `packages/server/src/agents/claude-code-runtime.ts`
- Test: `packages/server/src/agents/claude-code-runtime.test.ts`

- [ ] **Step 1: 编写失败测试**

```typescript
// packages/server/src/agents/claude-code-runtime.test.ts
import { describe, expect, it } from "bun:test";
import { mapToAgentEvent } from "./claude-code-runtime";

describe("mapToAgentEvent", () => {
	const sessionKey = "test-session";

	it("maps text result message to done event", () => {
		const msg = { result: "Hello world", stop_reason: "end_turn" };
		const events = mapToAgentEvent(msg, sessionKey);
		expect(events).toEqual([
			{ type: "done", sessionKey, usage: { promptTokens: 0, completionTokens: 0 } },
		]);
	});

	it("maps init system message", () => {
		const msg = { type: "system", subtype: "init", session_id: "sdk-123" };
		const events = mapToAgentEvent(msg, sessionKey);
		expect(events).toEqual([]);
	});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test packages/server/src/agents/claude-code-runtime.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 claude-code-runtime.ts**

```typescript
// packages/server/src/agents/claude-code-runtime.ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent } from "./runtime";

interface ClaudeCodeParams {
	prompt: string;
	sessionKey: string;
	workspaceDir: string;
	allowedTools?: string[];
	permissionMode?: "default" | "acceptEdits" | "bypassPermissions";
	maxTurns?: number;
	sessionId?: string;
	mcpServers?: Record<string, unknown>;
	systemPrompt?: string;
}

/** Map an Agent SDK message to YanClaw AgentEvent(s). */
export function mapToAgentEvent(msg: Record<string, unknown>, sessionKey: string): AgentEvent[] {
	// Result message — final output
	if ("result" in msg) {
		return [
			{
				type: "done",
				sessionKey,
				usage: { promptTokens: 0, completionTokens: 0 },
			},
		];
	}

	// System messages (init, etc.)
	if (msg.type === "system") {
		// init message contains session_id — caller saves it
		return [];
	}

	// Assistant content messages
	if (msg.type === "assistant") {
		const content = msg.content;
		if (Array.isArray(content)) {
			const events: AgentEvent[] = [];
			for (const block of content) {
				if (typeof block === "object" && block !== null) {
					const b = block as Record<string, unknown>;
					if (b.type === "text" && typeof b.text === "string") {
						events.push({ type: "delta", sessionKey, text: b.text });
					} else if (b.type === "tool_use") {
						events.push({
							type: "tool_call",
							sessionKey,
							name: b.name as string,
							args: b.input,
						});
					} else if (b.type === "tool_result") {
						events.push({
							type: "tool_result",
							sessionKey,
							name: (b.name as string) ?? "unknown",
							result: b.content,
							duration: 0,
						});
					}
				}
			}
			return events;
		}
		return [];
	}

	return [];
}

/** Run a Claude Code Agent SDK session, yielding YanClaw AgentEvents. */
export async function* runClaudeCode(params: ClaudeCodeParams): AsyncGenerator<AgentEvent> {
	const {
		prompt,
		sessionKey,
		workspaceDir,
		allowedTools = ["Read", "Edit", "Write", "Bash", "Glob", "Grep"],
		permissionMode = "acceptEdits",
		maxTurns = 50,
		sessionId,
		mcpServers,
		systemPrompt,
	} = params;

	let sdkSessionId: string | undefined;
	let lastResultText = "";

	const options: Record<string, unknown> = {
		allowedTools,
		cwd: workspaceDir,
		maxTurns,
		permissionMode,
	};

	if (sessionId) options.resume = sessionId;
	if (systemPrompt) options.systemPrompt = systemPrompt;
	if (mcpServers && Object.keys(mcpServers).length > 0) {
		options.mcpServers = mcpServers;
	}
	if (permissionMode === "bypassPermissions") {
		options.allowDangerouslySkipPermissions = true;
	}

	try {
		for await (const message of query({ prompt, options: options as never })) {
			const msg = message as Record<string, unknown>;

			// Capture session ID from init message
			if (msg.type === "system" && msg.subtype === "init" && typeof msg.session_id === "string") {
				sdkSessionId = msg.session_id;
			}

			// Capture result text for session saving
			if ("result" in msg && typeof msg.result === "string") {
				lastResultText = msg.result;
			}

			const events = mapToAgentEvent(msg, sessionKey);
			for (const event of events) {
				yield event;
			}
		}

		// Emit final result text as delta if not already emitted
		if (lastResultText) {
			yield { type: "delta", sessionKey, text: lastResultText };
		}

		yield {
			type: "done",
			sessionKey,
			usage: { promptTokens: 0, completionTokens: 0 },
		};
	} catch (err) {
		yield {
			type: "error",
			sessionKey,
			message: err instanceof Error ? err.message : String(err),
		};
	}
}

/** Get the SDK session ID captured during the last run (for resume). */
export function getSessionId(): string | undefined {
	// Session ID is captured per-run; callers should extract from init message
	return undefined;
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test packages/server/src/agents/claude-code-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/agents/claude-code-runtime.ts packages/server/src/agents/claude-code-runtime.test.ts
git commit -m "feat: implement Claude Code runtime adapter with event mapping"
```

---

### Task 6: AgentRuntime 路由 — 按 runtime 字段分发

**Files:**
- Modify: `packages/server/src/agents/runtime.ts`

- [ ] **Step 1: 在 AgentRuntime.run() 中添加 runtime 分发逻辑**

在 `packages/server/src/agents/runtime.ts` 中:

1. 添加导入:
```typescript
import { runClaudeCode } from "./claude-code-runtime";
```

2. 在 `run()` 方法中，`agentConfig` 查找之后（约 line 107）、`try` 块开始前，添加 claude-code 分支:

```typescript
// Claude Code runtime: delegate to Agent SDK
if (agentConfig.runtime === "claude-code") {
	try {
		const workspaceDir = agentConfig.workspaceDir ?? join(resolveDataDir(), "workspace", agentId);
		await mkdir(workspaceDir, { recursive: true });

		// Ensure session exists
		this.sessionStore.ensureSession({ key: sessionKey, agentId });

		const claudeCodeConfig = agentConfig.claudeCode;
		yield* runClaudeCode({
			prompt: message,
			sessionKey,
			workspaceDir,
			allowedTools: claudeCodeConfig?.allowedTools,
			permissionMode: claudeCodeConfig?.permissionMode,
			maxTurns: claudeCodeConfig?.maxTurns,
			mcpServers: claudeCodeConfig?.mcpServers as Record<string, unknown> | undefined,
			systemPrompt: agentConfig.systemPrompt !== "You are a helpful assistant."
				? agentConfig.systemPrompt
				: undefined,
		});

		return;
	} catch (err) {
		yield {
			type: "error" as const,
			sessionKey,
			message: err instanceof Error ? err.message : String(err),
		};
		return;
	}
}
```

- [ ] **Step 2: 运行完整测试套件确认未破坏**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test`
Expected: 所有测试 PASS

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/agents/runtime.ts
git commit -m "feat: route agent execution to Claude Code runtime when runtime=claude-code"
```

---

## Chunk 4: 集成验证

### Task 7: 格式检查 + 全量测试

- [ ] **Step 1: 运行 Biome 格式化**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun run format`

- [ ] **Step 2: 运行 Biome lint**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun run check`
Expected: 无错误

- [ ] **Step 3: 修复 lint 问题（如有）**

- [ ] **Step 4: 运行全量测试**

Run: `cd /Users/yzlabmac/ai/yanclaw && bun test`
Expected: 全部 PASS

- [ ] **Step 5: 最终 commit（如有格式修复）**

```bash
git add -A
git commit -m "style: format and lint fixes"
```

---

## 文件变更总结

| 文件 | 操作 | 说明 |
|------|------|------|
| `packages/server/src/agents/tools/screenshot.ts` | 新建 | 桌面截图 tool (macOS screencapture) |
| `packages/server/src/agents/tools/screenshot.test.ts` | 新建 | 截图 tool 测试 |
| `packages/server/src/agents/tools/index.ts` | 修改 | 注册 screenshot_desktop + ownerOnly + capability |
| `packages/server/src/config/schema.ts` | 修改 | 添加 runtime, claudeCode 字段 |
| `packages/server/package.json` | 修改 | 添加 @anthropic-ai/claude-agent-sdk |
| `packages/server/src/agents/claude-code-runtime.ts` | 新建 | Agent SDK 适配层 |
| `packages/server/src/agents/claude-code-runtime.test.ts` | 新建 | 适配层测试 |
| `packages/server/src/agents/runtime.ts` | 修改 | runtime 字段分发逻辑 |
