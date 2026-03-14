# OpenClaw 最新功能借鉴（2026-03-14）

基于 OpenClaw v2026.3.7–3.12 的新变化，补充 `2026-03-11-openclaw-insights.md` 未覆盖的功能点。

---

## ~~P0 — 架构级改进~~ — 取消

> **2026-03-14 决策：** ContextEngine 插件化和 Provider 插件化均属于过度工程化，现有实现已满足需求。详见 `docs/plans/2026-03-14-openclaw-inspired-improvements.md`。

### ~~1. ContextEngine 插件化~~ — 不做

**现状：** YanClaw 的上下文压缩方案（`openclaw-comparison-and-roadmap.md` §4）是硬编码在 runtime 中的单一策略。

**OpenClaw 变化（v2026.3.7）：** 上下文管理抽象为可插拔接口，已有第三方插件 `lossless-claw` 在 OOLONG 基准上得分 74.8（超过 Claude Code 的 70.3）。

**生命周期钩子：**

| 钩子 | 时机 | 职责 |
|------|------|------|
| `bootstrap` | 会话创建 | 初始化上下文状态 |
| `ingest` | 收到新消息 | 预处理、分类、缓存 |
| `assemble` | 调用 LLM 前 | 组装系统提示 + 历史 + 记忆 |
| `compact` | token 超阈值 | 压缩/摘要/裁剪 |
| `afterTurn` | LLM 响应完成 | 后处理、记忆冲刷 |
| `prepareSubagentSpawn` | 创建子代理 | 裁剪父上下文给子代理 |
| `onSubagentEnded` | 子代理结束 | 合并子代理结果回父上下文 |

**借鉴方案：**

```
packages/server/src/agents/context/
├── engine.ts          ← ContextEngine 接口定义
├── default-engine.ts  ← 内置默认实现（当前硬编码逻辑迁移至此）
├── registry.ts        ← slot-based 注册，config 驱动解析
└── types.ts           ← 共享类型
```

配置：
```json5
{
  agents: {
    defaults: {
      contextEngine: "default",  // 或 "lossless" 等第三方
      contextEngineConfig: { /* 引擎专属配置 */ }
    }
  }
}
```

**价值：** 一次设计同时解决压缩、记忆冲刷、子代理上下文三个问题。用户可按场景选引擎（长对话用 lossless、快问快答用 aggressive-compact）。

**比 OpenClaw 更好：**
- OpenClaw 的 slot 注册靠运行时扫描 npm 包；YanClaw 可复用现有 PluginRegistry 统一管理
- OpenClaw 的 LegacyContextEngine 包装器是过渡方案；YanClaw 直接按新接口设计，无历史包袱

**工作量：** 中（3-4 天）— 接口设计 1 天 + 迁移现有逻辑 1-2 天 + 测试 1 天

---

### ~~2. Provider 插件化~~ — 不做

**现状：** `ModelManager` 硬编码 Anthropic/OpenAI provider 逻辑，新增 provider 需改核心代码。

**OpenClaw 变化（v2026.3.7）：** Ollama、vLLM、SGLang 从内置移至 provider-plugin 架构，每个 provider 自带：
- onboarding 流程（API key 验证、连接测试）
- 模型发现（自动拉取可用模型列表）
- model-picker UI 组件

**借鉴方案：**

```typescript
// packages/server/src/models/provider.ts
interface ModelProvider {
  id: string;
  name: string;
  /** 验证连接配置 */
  validateConfig(config: Record<string, unknown>): Promise<boolean>;
  /** 拉取可用模型列表 */
  listModels(): Promise<ModelInfo[]>;
  /** 创建 AI SDK LanguageModel 实例 */
  createModel(modelId: string): LanguageModel;
  /** 定价信息（用于成本估算） */
  pricing?: Record<string, { input: number; output: number }>;
}
```

内置 provider（Anthropic/OpenAI/DeepSeek）作为默认注册，第三方 provider 通过 plugin 注册。

**工作量：** 中（2-3 天）

---

## P1 — 体验提升

### 3. 渠道 Slash Commands

**现状：** 用户与 agent 的所有交互都经过 LLM 处理，无法执行即时操作。

**OpenClaw 做法：** `:think`、`:model`、`:fast`、`:verbose`、`:send`、`:reasoning` 等命令在 gateway 层拦截处理，零 token 消耗。

**借鉴方案：**

在 `ChannelManager.handleInbound()` 中添加命令拦截层：

```typescript
// packages/server/src/channels/slash-commands.ts
const SLASH_COMMANDS: Record<string, SlashCommandHandler> = {
  "/model":   (args, session) => { /* 切换当前会话模型 */ },
  "/fast":    (_, session)    => { /* 切换到快速模型 */ },
  "/reset":   (_, session)    => { /* 重置会话上下文 */ },
  "/status":  (_, session)    => { /* 返回会话状态、token 用量 */ },
  "/verbose": (_, session)    => { /* 切换详细/简洁模式 */ },
  "/help":    ()              => { /* 列出可用命令 */ },
};
```

**价值：** 实现成本极低（1 天），日常使用频率高
**工作量：** 小

---

### 4. Typing Indicators

**现状：** agent 处理消息时，用户在聊天渠道看不到任何反馈。

**OpenClaw 做法：** 按场景区分：

| 场景 | 行为 |
|------|------|
| DM | 收到消息立即显示 typing |
| 群聊被 @ | 显示 typing |
| 群聊未被 @ | 不显示 |
| 可配 interval | 默认每 5s 刷新一次 |

**借鉴方案：**

各 channel adapter 已有发送消息能力，只需在 agent 处理期间定时调用平台的 typing API：

- Telegram: `sendChatAction("typing")`（每 5s 需刷新）
- Discord: `channel.sendTyping()`（持续 10s）
- Slack: 无原生 typing，可跳过或用 emoji reaction 替代

在 `AgentRuntime.run()` 开始时启动 typing 定时器，结束时清除。

**工作量：** 小（半天）

---

### 5. Resumable Sessions

**现状：** 会话中断后（服务重启、网络断开）无法恢复正在进行的 agent 执行。

**OpenClaw 变化（v2026.3.12）：** `resumeSessionId` 机制允许中断后恢复会话上下文，继续执行未完成的工具调用链。

**借鉴方案：**

- 在 `SessionStore` 中持久化 agent 执行状态（当前 step、pending tool calls、partial response）
- 服务重启后检查未完成的 session，向用户发送恢复提示
- 用户确认后从断点继续

**工作量：** 中（2-3 天）— 需设计状态序列化格式

---

## P2 — 记录备忘

### 6. Dashboard Command Palette

OpenClaw Dashboard-v2 新增命令面板（类 VS Code `Cmd+K`），快速访问常用操作。YanClaw Web UI 可参考，但当前功能还不够多，先积累更多操作入口后再做。

### 7. 更多渠道适配器优先级

根据 OpenClaw 社区活跃度，用户需求最大的几个：

| 渠道 | 需求强度 | 实现难度 | 备注 |
|------|---------|---------|------|
| WhatsApp | 极高 | 高 | 需 WhatsApp Business API 或第三方桥接 |
| Matrix | 高 | 中 | 开源协议，适合技术用户 |
| Microsoft Teams | 中 | 高 | 企业场景 |
| Signal | 中 | 高 | 需 signal-cli 桥接 |
| LINE | 中 | 低 | 亚洲市场 |

按用户反馈逐个添加，不追求数量。

### 8. 移动端 Node 配对

OpenClaw 的 iOS/Android 作为"节点"通过 WebSocket 配对，提供摄像头、位置、通知等设备能力。YanClaw 的 Tauri 可通过 `tauri-plugin-mobile` 探索类似方案，但优先级很低。

---

## 安全加固补充

从 OpenClaw 近期安全修复中提炼：

| 项目 | 说明 | 对应模块 | 工作量 |
|------|------|---------|--------|
| CVE-2026-25253 WebSocket token 泄露 | Control UI 的 WS 连接可被跨站劫持窃取 token | 确认 YanClaw 的 WS 鉴权是否有同类风险 | 审计 0.5 天 |
| query-string gatewayUrl 注入 | 控制台 URL 参数未做清洗，可注入恶意 gateway 地址 | `packages/web/src/lib/api.ts` | 小 |
| 沙箱 env 清洗 | Docker 执行前移除 `YANCLAW_*` 敏感环境变量 | `agents/tools/shell.ts` | 小 |

---

## 与现有文档的关系

| 文档 | 本文补充内容 |
|------|-------------|
| `openclaw-comparison-and-roadmap.md` §4 上下文压缩 | 升级为 ContextEngine 插件化（本文 §1） |
| `openclaw-comparison-and-roadmap.md` §9 优先级 | 新增 ContextEngine/Provider 插件化为 P0 |
| `2026-03-11-openclaw-insights.md` §P0 | 本文 §3-4 为新增的 P1 功能 |
| `2026-03-11-openclaw-insights.md` §安全 | 本文补充 CVE-2026-25253 风险审计 |
