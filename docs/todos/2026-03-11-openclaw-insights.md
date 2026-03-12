# OpenClaw 功能借鉴需求分析

## 背景

对比研究了 OpenClaw（同类 AI 助手网关平台）的最新功能更新，筛选出对 YanClaw 有实际价值的改进方向。OpenClaw 与 YanClaw 架构高度相似（Hono gateway + 多 channel + 插件系统），但在生态集成和运行时控制方面更成熟。

## 优先级划分

根据"用户价值 × 实现可行性"排序，分为三档。

---

## P0 — 高价值，建议近期实施

### 1. MCP 协议支持

**现状：** YanClaw 的工具系统是内置的，新增工具需要写代码 + 重新构建。

**OpenClaw 做法：** 通过 `mcporter` 模块接入任意 MCP Server，将外部 MCP 工具自动映射为 agent 可调用的 tool。

**借鉴方案：**

- 在 config.json5 中新增 `mcp` 配置段，声明要连接的 MCP Server：
  ```json5
  mcp: {
    servers: {
      "filesystem": { command: "npx", args: ["-y", "@anthropic/mcp-fs"] },
      "github": { command: "npx", args: ["-y", "@anthropic/mcp-github"], env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" } }
    }
  }
  ```
- 新增 `packages/server/src/mcp/` 模块：
  - `client.ts` — MCP Client，管理与 MCP Server 的 stdio/SSE 连接
  - `bridge.ts` — 将 MCP tool schema 转换为 YanClaw tool 格式，注入 agent runtime
- MCP 工具自动命名空间化：`mcp.serverName.toolName`（与插件工具命名一致）
- 受现有 tool policy 控制（allow/deny 规则同样适用于 MCP 工具）

**影响范围：** 新增模块，不影响现有代码
**工作量：** 中
**价值：** 极高 — 一次实现即可接入整个 MCP 生态（数百个现成工具）

---

### 2. 动态模型切换

**现状：** 模型在 onboarding 或 config.json5 中配置后固定，切换需要改配置文件。

**OpenClaw 做法：** macOS 客户端支持聊天界面内实时切换模型，且保留 thinking 状态。

**借鉴方案：**

- `/api/models` 已有动态模型列表接口（v0.5.0 新增），可复用
- 在 WebChat 界面的 PromptInput 区域添加模型选择器（下拉/Popover）
- 切换粒度：
  - **会话级**：当前 session 使用指定模型，不影响其他 session
  - **全局级**：修改 agent 默认模型（通过 API 更新 config）
- 会话级切换无需重启，只需在 `streamText()` 调用时覆盖 model 参数
- 模型选择器显示：模型名 + provider + 状态（可用/冷却中/不可用）

**影响范围：**
- `packages/server/src/agents/runtime.ts` — 支持 session 级 model override
- `packages/server/src/routes/sessions.ts` — session 创建/更新时接受 model 参数
- `packages/web/` — 新增 ModelSelector 组件

**工作量：** 中
**价值：** 高 — 用户最常见的需求之一

---

### 3. 飞书 Channel 适配器

**现状：** 仅支持 Telegram、Slack、Discord 三个渠道。

**OpenClaw 做法：** 支持 20+ 渠道，包括飞书（Feishu/Lark）。

**借鉴方案：**

- 新增 `packages/server/src/channels/feishu.ts`
- 使用飞书开放平台 API（事件订阅 + 消息发送）
- 支持特性：
  - 接收/发送文本、图片、文件消息
  - 群聊 @机器人 触发
  - 私聊直接响应
  - 富文本（Markdown）回复
- 配置项对齐现有 channel 结构：
  ```json5
  channels: [{
    type: "feishu",
    appId: "${FEISHU_APP_ID}",
    appSecret: "${FEISHU_APP_SECRET}",
    // ...
  }]
  ```
- 复用 ChannelManager、健康监控、自动重连等现有基础设施

**影响范围：** 新增文件，ChannelManager 注册新类型
**工作量：** 中
**价值：** 高 — 国内办公场景主力平台

---

## P1 — 中等价值，择机实施

### 4. Skills 系统

**现状：** YanClaw 有 tool 和 plugin 两层，tool 是原子操作，plugin 可聚合多个 tool 但主要面向开发者。

**OpenClaw 做法：** 独立的 Skills 层（50+ 内置），每个 skill 是面向用户的高级能力包（如 "GitHub skill" 包含 PR 管理、issue 操作等一组相关 tool + prompt）。

**借鉴方案：**

- Skill = 预置 prompt 模板 + 一组关联 tool + 触发条件
- 与现有 plugin 系统整合：skill 本质上是轻量 plugin 的语法糖
- 优先实现几个高频 skill：
  - `github` — PR/Issue 操作（依赖 MCP 或 gh CLI）
  - `knowledge` — 知识库管理（查询/更新 memory）
  - `schedule` — 定时任务管理（操作 cron）
- 暂不需要独立的 skill registry，先作为内置 plugin 实现

**工作量：** 中
**价值：** 中 — 提升用户体验但非必需

### 5. Subagent 控制边界

**现状：** YanClaw 无子代理概念，agent 执行是单层的。

**OpenClaw 做法：** 支持 agent 嵌套调用，子代理权限是父代理的子集，有独立的 session 隔离。

**借鉴方案：**

- 在 AgentRuntime 中支持 `spawnSubagent()`
- 权限继承规则：子代理 capabilities ⊆ 父代理 capabilities
- 子代理有独立的 context window，不污染父代理上下文
- 适用场景：复杂任务拆分（如"调研 + 编码 + 测试"分三个子代理）

**工作量：** 大
**价值：** 中 — 当前单 agent 已够用，多 agent 协作是未来方向

### 6. 对话重置粒度化

**现状：** 会话重置是一刀切，清除所有上下文。

**OpenClaw 做法：** 区分"对话重置"（清空消息历史但保留 session 元数据）和"管理员重置"（完全重置包括配置）。

**借鉴方案：**

- 对话重置：清空 messages，保留 session 配置（model override、绑定关系等）
- 完全重置：清空一切，回到初始状态
- 在 WebChat 中通过不同按钮/菜单项区分

**工作量：** 小
**价值：** 中低 — 细节体验优化

---

## P2 — 低优先级，记录备忘

### 7. CLI 模式

OpenClaw 提供 CLI 入口（`openclaw` 命令），可不启动 UI 直接在终端使用。YanClaw 目前仅通过 Tauri/Web 交互。CLI 模式对开发者/运维场景有价值，但与 YanClaw 定位（桌面应用）不完全匹配，暂不考虑。

### 8. 更多 Channel 适配器

WhatsApp、Signal、iMessage、Matrix、IRC 等。按用户需求逐个添加，无需一次性全做。优先级取决于实际用户反馈。

### 9. npm/Docker 分发

OpenClaw 支持 `npm i -g openclaw` 和 Docker 镜像部署。YanClaw 以 Tauri 桌面应用为主，Docker 部署可作为 headless server 模式的补充，但优先级不高。

---

## 安全加固补充（来自 OpenClaw 近期 commit）

以下几点可纳入现有安全体系的增强：

| 改进项 | 说明 | 对应 YanClaw 模块 |
|--------|------|-------------------|
| Docker 环境变量清洗 | 沙箱执行前移除 `YANCLAW_*` 等敏感 env | `agents/tools/shell.ts` |
| Interpreter 审批 fail-closed | 未绑定审批上下文时默认拒绝 | `approvals/manager.ts` |
| Token 轮换作用域约束 | 设备 token 只能在 caller 权限子集内轮换 | `security/token-rotation.ts` |
| 上下文裁剪处理图片 | 裁剪含图片的 tool result 时保留图片引用 | `agents/runtime.ts` |

**工作量：** 均为小改动
**建议：** 随日常迭代逐步补齐

---

## 实施建议

**近期冲刺（1-2 周）：**
1. MCP 协议支持（P0-1）— 生态价值最大
2. 动态模型切换 UI（P0-2）— 用户体感最直接

**中期规划（1 月内）：**
3. 飞书适配器（P0-3）
4. 安全加固补充项

**远期储备：**
5. Skills 系统（P1-4）
6. Subagent 控制（P1-5）

---

## 不采纳的

- **OpenClaw 的单体架构** — YanClaw 的 monorepo 多包结构更清晰，不需要合并
- **原生 macOS/iOS 客户端** — Tauri 跨平台方案已满足需求
- **pnpm 替代 bun** — bun 生态已稳定，无迁移理由

---

## 附录：Agent 工具/Skill 市场调研

### MCP Server 注册中心

| 平台 | 规模 | 安全模型 | 程序化 API | 云端托管 | 推荐指数 |
|------|------|----------|-----------|---------|---------|
| **Official MCP Registry** | 规范源 | 命名空间认证（反向 DNS + GitHub 身份绑定） | OpenAPI v0.1 | 否 | ★★★★★ |
| **Smithery.ai** | 7,300+ | API Key 本地注入，不传输到服务端 | MCP-over-MCP 元服务器 + CLI (170K/周下载) | 是 | ★★★★★ |
| **Glama.ai** | 18,967 | 社区审核 | MCP Server（Agent 可自主搜索） | 否 | ★★★★ |
| **MCP.so** | 18,400+ | 协议层安全 | 无公开 API | 否 | ★★★ |
| **PulseMCP** | 8,610+ | 安全分析报告 | OpenAPI v0.1（含安全元数据） | 否 | ★★★★ |
| **Composio** | 500+ | **SOC 2 Type II 认证** | SDK (Python/JS) + CLI | 是 | ★★★★ |

### Skills 市场

| 平台 | 规模 | 格式 | 安装方式 | 推荐指数 |
|------|------|------|---------|---------|
| **Skills.sh**（Vercel 官方） | 快速增长 | SKILL.md + 资源文件 | `npx skills add <pkg>` | ★★★★★ |
| **SkillsMP** | 351,349 | SKILL.md | REST API 发现 | ★★★★ |

### 安全风险提示

MCP 生态已披露 14 个 CVE，主要风险：prompt 注入/工具投毒、npm 供应链攻击、未沙箱化权限逃逸。OWASP 推荐：隔离运行环境 + 白名单信任源 + 版本锁定 + 命名空间认证。

### 对 YanClaw 的接入建议

1. **MCP Registry 对接**：优先接入 Official MCP Registry（OpenAPI v0.1 标准），同时支持 Smithery 作为补充源。两者均有程序化发现 API，可在 YanClaw 设置页实现"浏览 → 安装 → 配置"一站式体验。
2. **Skills 生态**：支持 SKILL.md 格式（Vercel 推动的事实标准），可复用 Skills.sh / SkillsMP 的 35 万+ 现有 skill。在 Plugin 体系中增加 skill loader，无需大改架构。
3. **安全分层**：三层信任模型 — 官方审核（Official Registry）> 命名空间验证（GitHub 身份）> 社区未审核。MCP Server 默认在沙箱中运行，敏感操作需用户审批。
4. **远程 MCP 支持**：Smithery/Composio 均支持云端托管 MCP Server（Streamable HTTP 传输），YanClaw 应同时支持 stdio（本地）和 HTTP（远程）两种连接模式。
