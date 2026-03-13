# 网页抓取 + 知识库 + 记忆系统 需求分析

## 背景

智能体需要三大核心能力：**获取外部信息**（网页抓取）、**构建持久知识**（知识库）、**维护对话记忆**（记忆系统），且用户需要可视化管理这些内容。

---

## 一、网页数据抓取

### 现状（YanClaw）

已有三类工具：

| 工具 | 文件 | 方式 | 能力 |
|------|------|------|------|
| `web_fetch` | `agents/tools/web.ts` | HTTP GET | 纯文本/JSON 抓取，SSRF 防护，30s 超时，无 JS 执行 |
| `web_search` | `agents/tools/web.ts` | DuckDuckGo HTML 抓取 | 无需 API Key，regex 解析搜索结果 |
| `browser_*` | `agents/tools/browser.ts` | Playwright headless | navigate/screenshot/action，支持 JS 渲染 |

### 对比 OpenClaw

| 维度 | OpenClaw | YanClaw | 差距 |
|------|----------|---------|------|
| HTTP 抓取 | `@mozilla/readability` + HTML→Markdown 转换 + Firecrawl 可选 | 原始文本截断 | **内容提取质量差** |
| 搜索引擎 | 5 个 provider（Brave/Gemini/Grok/Kimi/Perplexity）自动检测 | 仅 DuckDuckGo | **单一来源，不稳定** |
| 浏览器 | CDP 直连 Chrome/Brave/Edge + profile 隔离 + 扩展 relay | Playwright headless | **无法利用用户已登录的浏览器** |
| 缓存 | 15 分钟结果缓存 | 无缓存 | **重复请求浪费** |
| Firecrawl | 可选集成，API 级别的高质量页面解析 | 无 | **复杂页面处理弱** |

### 需求方案

#### R1. 增强 `web_fetch` 内容提取

- 集成 `@mozilla/readability` + `turndown`（HTML→Markdown）
- 对 HTML 页面自动提取正文，去除导航/广告/脚本
- 保留原始 URL、标题、摘要等元数据
- 可选：集成 Firecrawl 作为高级解析后端

**改动范围：** `packages/server/src/agents/tools/web.ts`
**工作量：** 小

#### R2. 多搜索引擎支持

- 配置多个搜索 provider，按优先级 fallback
- 优先级建议：Brave（免费额度高）→ Kimi（中文优势）→ DuckDuckGo（无需 Key 兜底）
- 配置方式：

```json5
tools: {
  web: {
    search: {
      providers: ["brave", "kimi", "duckduckgo"],
      brave: { apiKey: "${BRAVE_API_KEY}" },
      kimi: { apiKey: "${KIMI_API_KEY}" }
    }
  }
}
```

**改动范围：** `agents/tools/web.ts` + `config/schema.ts`
**工作量：** 中

#### R3. 浏览器扩展 Relay 模式

> 对应用户需求第 3 点：让用户装浏览器插件，由插件提供接口。

**设计思路：**

```
Chrome 扩展 ←WebSocket→ YanClaw Server ←tool call→ Agent
```

- 开发一个轻量 Chrome 扩展，通过 WebSocket 连接 YanClaw 后端
- 扩展能力：获取当前页面内容、截图、执行 JS、读取 Cookie（仅限用户授权的域）
- 优势：利用用户已登录状态，访问需要认证的网站（GitHub、内网、付费内容等）
- 新增 tool：`browser_extension_fetch`（通过扩展获取页面内容）
- 安全：域名白名单 + 用户确认弹窗 + 不暴露完整 Cookie 到 agent

**改动范围：** 新增 `packages/browser-extension/`（Chrome 扩展）+ `server/src/agents/tools/browser-ext.ts`
**工作量：** 大
**优先级：** P1（先做好 R1、R2）

#### R4. 结果缓存

- 对 `web_fetch` 和 `web_search` 结果添加 TTL 缓存（默认 15 分钟）
- 内存缓存即可，无需持久化
- 相同 URL/查询在 TTL 内直接返回缓存结果
- 可配置开关和 TTL

**改动范围：** `agents/tools/web.ts`
**工作量：** 小

---

## 二、知识库系统

### 现状（YanClaw）

| 能力 | 状态 |
|------|------|
| FTS5 全文搜索 | ✅ 已实现（`db/memories.ts`） |
| 向量嵌入搜索 | ✅ 已实现（`memory/embeddings.ts`，Vercel AI SDK） |
| 混合搜索（FTS + Vector + MMR 去重 + 时间衰减） | ✅ 已实现 |
| 文件自动索引 | ✅ 已实现（`memory/auto-indexer.ts`，监听文件变化） |
| Agent 工具（store/search/delete） | ✅ 已实现（`agents/tools/memory.ts`） |
| 用户可查看/管理 | ⚠️ 后端 API 已有（`routes/memory.ts`），缺前端 UI |
| 知识分类/标签管理 | ⚠️ tags 字段 + API 支持，缺管理界面 |
| 网页内容自动入库 | ❌ 抓取结果不自动存储 |
| 文档批量导入 | ❌ 仅支持 auto-indexer 目录监听 |

### 对比 OpenClaw

| 维度 | OpenClaw | YanClaw | 差距 |
|------|----------|---------|------|
| 存储格式 | Markdown 文件（source of truth）+ 可选向量索引 | SQLite（FTS5 + embedding BLOB） | 设计不同，各有优劣 |
| 日记/长期 | 每日 `memory/YYYY-MM-DD.md` + 永久 `MEMORY.md` | 统一 memories 表 | YanClaw 更简洁 |
| 嵌入 provider | 6 种（local/openai/gemini/voyage/mistral/ollama） | 1 种（Vercel AI SDK 代理，实际取决于配置） | **YanClaw 已通过 AI SDK 支持多 provider** |
| 内存刷新 | 上下文压缩前自动提醒保存 | ✅ 已有（`compaction.ts` flushToMemory，LLM 提取事实） | 功能已对齐 |
| UI 管理 | 配置页 + CLI（status/index/search） | 无 | **核心差距** |
| 插件化 | memory 为可替换 plugin slot（Core / LanceDB） | 内置固定实现 | 灵活性不同 |

### 需求方案

#### R5. 知识库管理 UI

Web 端新增 **Knowledge** 页面（或作为 Agent 详情的 tab）：

- **列表视图**：分页展示记忆条目（content 摘要、tags、source、时间）
- **搜索**：支持关键词搜索 + 语义搜索切换
- **标签过滤**：按 tags 筛选
- **CRUD 操作**：查看详情、手动新增、编辑、删除
- **批量操作**：多选删除、批量打标签
- **统计面板**：记忆总数、按 agent/source 分布、存储占用

**后端 API：**

```
GET    /api/memories?agentId=&q=&tags=&page=&limit=   # 列表+搜索
POST   /api/memories                                    # 新增
GET    /api/memories/:id                                # 详情
PATCH  /api/memories/:id                                # 编辑
DELETE /api/memories/:id                                # 删除
DELETE /api/memories?ids=                                # 批量删除
GET    /api/memories/stats?agentId=                      # 统计
```

**改动范围：** `server/src/routes/memories.ts`（新增）+ `web/src/pages/knowledge.tsx`（新增）
**工作量：** 中

#### R6. 网页内容自动入库

- Agent 使用 `web_fetch` 抓取的内容，可选自动存入知识库
- 通过 plugin hook `afterToolCall` 拦截 `web_fetch` 结果
- 作为内置 skill 加载（默认启用），配置项：

```json5
skills: {
  "web-knowledge": {
    enabled: true,
    config: {
      autoStore: true,           // web_fetch 结果自动入库
      autoStoreTags: ["web"],    // 自动添加的标签
      maxContentLength: 10000,   // 超长截断
      dedup: true                // URL 去重
    }
  }
}
```

**改动范围：** 新增 `~/.yanclaw/skills/web-knowledge/`
**工作量：** 小

#### R7. 文档批量导入

- Knowledge UI 提供"导入"按钮
- 支持拖拽上传 .md / .txt / .pdf / .json 文件
- 后端解析 + 分块 + embedding 入库
- 进度显示（大文件异步处理）

**改动范围：** `server/src/routes/memories.ts` + `web/`
**工作量：** 中

#### R8. ~~上下文压缩前自动记忆保存~~ → 已实现，优化为"召回透明性"

> ⚠️ Review 发现：`compaction.ts` 的 `flushToMemory()` 已实现此功能（LLM 提取最多 10 条事实，打 `["auto-flush"]` 标签存入）。

**替代需求：召回透明性（Recall Transparency）**

OpenClaw 的记忆对用户不透明，YanClaw 可以做得更好：

- 在 chat UI 中展示"本次回复参考了哪些记忆"（类似 RAG 的 citation）
- Memory pre-heat 结果作为 metadata 返回给前端
- 用户可点击查看/编辑被召回的记忆条目
- 如果召回内容有误，用户可直接修正（反馈闭环）

**改动范围：** `agents/runtime.ts`（返回召回元数据）+ `web/`（UI 展示）
**工作量：** 中

---

## 三、记忆系统增强

### 现状

Agent 的三个 memory tool（store/search/delete）功能完整但使用被动——完全依赖 agent 自主决定何时存储。

### 需求方案

#### R9. 主动记忆策略

- **对话摘要**：长对话结束时自动生成摘要存入 memory
- **用户偏好提取**：识别用户表达的偏好/习惯并记忆（如"我喜欢简洁回复"）
- **事实提取**：从对话中提取关键事实（如"项目用 React 框架"）

实现方式：在 agent system prompt 中注入记忆指导（类似 OpenClaw 的 MEMORY.md 策略），不需要额外代码。

**改动范围：** `agents/runtime.ts`（system prompt 增强）
**工作量：** 小

#### R10. 跨 Agent 知识共享

- 当前记忆按 `agentId` 隔离
- 新增"共享知识库"概念：`agentId = "__shared__"` 或新增 scope 字段
- Agent 可选是否访问共享知识

```json5
agents: [{
  id: "dev-agent",
  memory: {
    enabled: true,
    sharedAccess: true   // 可访问共享知识库
  }
}]
```

**改动范围：** `db/memories.ts`（search 扩展 scope）+ `config/schema.ts`
**工作量：** 小

---

## 四、Skill 化封装（默认加载）

将上述能力封装为两个内置 skill，默认启用：

### skill: `web-reader`

- 增强版网页抓取（readability + markdown 转换 + 缓存）
- 多搜索引擎 fallback
- Prompt 指导 agent 合理使用搜索和抓取工具

### skill: `knowledge-manager`

- 网页内容自动入库
- 主动记忆策略 prompt
- 上下文压缩前自动保存

这两个 skill 通过现有 SkillLoader 机制加载，放在 `~/.yanclaw/skills/` 或内置到 `plugins/` 目录。

---

## 优先级排序

| 优先级 | 需求 | 工作量 | 价值 |
|--------|------|--------|------|
| **P0** | R1. 增强 web_fetch 内容提取 | 小 | 高 — 当前抓取质量太差 |
| **P0** | R4. 结果缓存 | 小 | 中 — 减少重复请求 |
| **P0** | R5. 知识库管理 UI | 中 | 高 — 用户无法查看记忆 |
| **P0** | R8. 召回透明性（替代原 R8） | 中 | 高 — 超越 OpenClaw 的差异化功能 |
| **P1** | R2. 多搜索引擎支持 | 中 | 中 — DuckDuckGo 不稳定 |
| **P1** | R6. 网页内容自动入库 | 小 | 中 — 知识自动积累 |
| **P1** | R9. 主动记忆策略 | 小 | 中 — 减少手动干预 |
| **P1** | R10. 跨 Agent 知识共享 | 小 | 中 — 多 agent 场景需要 |
| **P2** | R3. 浏览器扩展 Relay | 大 | 高 — 但依赖较重 |
| **P2** | R7. 文档批量导入 | 中 | 中 — 有 auto-indexer 可替代 |

---

## 实施建议

**第一批（1 周）：** R1 + R4 + R8 — 小改动，立竿见影
**第二批（2 周）：** R5 — 知识库 UI，用户感知最强
**第三批（择机）：** R2 + R6 + R9 + R10 — 中等工作量，逐步完善
**远期：** R3 + R7 — 浏览器扩展和批量导入，按需求驱动
