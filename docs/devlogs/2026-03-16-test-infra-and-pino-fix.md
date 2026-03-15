# 2026-03-16 测试基础设施完善与 Pino Transport 修复

> 修复 pino-pretty transport 在 Bun bundled 模式下解析失败的问题，顺带发现并解决了测试体系的「运行时不同构」盲区。建立了 Vitest 单元测试 + Bun 原生冒烟测试的双层测试架构。

## 问题背景

### 1. Pino Transport 解析失败

Gateway 启动时崩溃：

```
error: unable to determine transport target for "pino-pretty"
```

**根因**：Pino 的 `transport` API 在 `worker_threads` 中动态加载模块。Bun 打包后裸模块名（`"pino-pretty"`、`"pino-roll"`）无法被 worker 解析。

### 2. 运行时不同构

发现后续排查中暴露了测试体系的结构性问题：

- Vitest 测试跑在 **Node.js worker threads** 中，`globalThis.Bun` 为 `undefined`
- 即使通过 `bun run vitest` 启动，测试进程仍然是 Node.js
- `bun:sqlite`、`import.meta.resolve` 等 Bun 特有 API 的行为差异在测试中完全不可见
- 没有冒烟测试验证关键启动链

### 3. DB Migration 冲突

`pim_items` 表的 `reminded` 列在 v9 的 `CREATE TABLE` DDL 中已包含，但 v10 migration 又执行 `ALTER TABLE ADD COLUMN reminded`，新建数据库时会报 `duplicate column name` 错误。

## 修复方案

### Phase 1: Pino Transport 修复 ✅

- `packages/server/src/logger.ts` — 新增 `resolveTransport()` 函数：Bun 下用 `import.meta.resolve` 解析绝对路径，Node.js/Vitest 下 fallback 到裸模块名
- 涉及文件：`packages/server/src/logger.ts`（修改）

### Phase 2: 双层测试架构 ✅

建立 Vitest + Bun 原生测试并行运行的体系：

| 层级 | Runner | 作用 | 命令 |
|------|--------|------|------|
| 单元测试 | Vitest (Node.js) | 逻辑正确性，mock 外部依赖 | `bun run test` |
| 冒烟测试 | Bun 原生运行时 | Bun API、模块加载、启动链验证 | `bun run test:smoke` |

**冒烟测试覆盖 7 项**：
1. Bun 运行时检测
2. `bun:sqlite` 可用性
3. `import.meta.resolve` pino transport 解析
4. Logger 初始化（pino transport 创建）
5. Config schema 默认值解析
6. Database 初始化（in-memory）
7. Hono app 构建与路由加载

**涉及文件：**
- `packages/server/src/smoke.test.ts`（新增）— Vitest 冒烟测试
- `packages/server/src/smoke.bun.test.ts`（新增）— Bun 原生冒烟测试
- `vitest.config.ts`（修改）— 排除 `*.bun.test.ts`
- `package.json`（修改）— 新增 `test:smoke` 脚本
- `.github/workflows/ci.yml`（修改）— CI 新增 "Smoke tests (Bun runtime)" 步骤

### Phase 3: DB Migration 容错 ✅

- `packages/server/src/db/sqlite.ts` — migration runner 捕获 `duplicate column` 错误并跳过，兼容 DDL 中已包含目标列的情况
- 涉及文件：`packages/server/src/db/sqlite.ts`（修改）

## 检查结果

- Vitest: ✅ 23 个文件，265 测试通过，2 跳过
- Bun 冒烟测试: ✅ 7 项全部通过
- 服务器启动: ✅ 正常
