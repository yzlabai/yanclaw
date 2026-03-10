# Phase 1 — P0 MVP + 基础 P1

## 数据库 ORM 迁移

- 从 raw bun:sqlite 查询迁移到 Drizzle ORM
- 保留 raw SQL 做初始表创建，Drizzle 负责所有查询操作
- 表定义：sessions、messages、approvals、media_files
- SessionStore 全面使用 Drizzle 类型安全查询

## 前端 Chat UI（prompt-kit）

- 从 `tmp/prompt-kit/` 提取核心组件，适配项目 React/Vite 环境
- ChatContainer（自动滚动）、Message（头像+Markdown）、PromptInput（自适应输入框）
- ToolCall（可折叠工具调用展示）、Loader（打字动画）、ScrollButton
- 基础 UI 组件：Button (CVA)、Tooltip、Avatar、Collapsible、Textarea

## 消息路由引擎

- 8 级绑定优先级：peer → group → guild+roles → guild → team → account → channel → default
- dmScope 会话隔离：main / per-peer / per-channel-peer / per-account-peer
- 跨平台身份链接（identityLinks）

## 上下文窗口管理

- 自动压缩：超出 contextBudget 时裁剪早期消息（保留系统消息）
- 会话标题自动生成：首次对话后 fire-and-forget 调用 LLM 生成短标题

## Web 工具

- web_search：DuckDuckGo HTML 抓取 + 正则解析结果
- web_fetch：URL 内容抓取，支持 content-type 感知

## 多 Agent 管理

- Agents 页面：CRUD 操作、模型选择、系统提示词编辑
- main Agent 不可删除
