# Agent 管理 & 模型配置 交互改进设计

## 现状问题总结

### 核心矛盾

1. **模型列表硬编码 vs 动态 Provider**：Agents 页面的模型下拉框硬编码了 Anthropic/OpenAI/Google 模型列表，但 Settings 支持添加 Ollama、DeepSeek 等自定义 Provider —— 两边完全脱节
2. **配置分散**：Default Agent 在 Agents 页和 Settings 页都能编辑，无同步机制，容易覆盖
3. **无验证反馈**：API Key、模型名、工作目录等都是纯文本输入，错误只在运行时才暴露
4. **概念晦涩**：systemModels 的 scene × preference 矩阵对用户不直观，且 Agent 的 preference 字段未暴露在 UI

---

## 一、Settings 页改进

### 1.1 Provider 管理（重点改进）

**现状**：扁平列表 + 手动填写，无验证

**改进方案**：

```
┌─────────────────────────────────────────────────┐
│  模型服务商                          [+ 添加]    │
├─────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────┐ │
│  │ 🟢 Anthropic │  │ 🟡 Ollama   │  │ + 添加  │ │
│  │ 2 个 Key     │  │ 本地运行     │  │         │ │
│  │ [编辑]       │  │ [编辑]       │  │         │ │
│  └─────────────┘  └─────────────┘  └─────────┘ │
└─────────────────────────────────────────────────┘
```

**交互流程**：

- **卡片式展示**：每个 Provider 一张卡片，显示状态指示灯（连接测试结果）、类型、Key 数量
- **添加流程**：点击 `+ 添加` → 弹出 Dialog
  - Step 1：选择类型（卡片网格：Anthropic / OpenAI / Google / Ollama / OpenAI 兼容）
  - Step 2：根据类型动态表单
    - 需要 API Key 的：输入 Key → 点「验证并获取模型」→ 调用 `/api/models/list` 测试连接
    - Ollama：输入 Base URL → 测试连接 → 获取本地模型列表
    - OpenAI 兼容：输入名称 + Base URL + API Key → 测试
  - Step 3：连接成功后显示可用模型列表，确认保存
- **编辑 Provider**：
  - 展开卡片或 Dialog 编辑
  - 支持多 Profile（多 API Key）管理：列表展示，每个 Key 显示状态（可用/冷却中/失败）
  - 「测试连接」按钮随时可用
- **删除保护**：删除前检查是否有 Agent 正在使用该 Provider，若有则警告并列出

**关键改进点**：
- 复用 Onboarding 的 `fetchModels` 逻辑做连接验证
- Provider 名称自动生成（如 `anthropic`、`ollama`），用户可自定义别名
- 状态指示灯：定期（或手动）检测 Provider 可用性

### 1.2 模型配置（简化概念）

**现状**：scene × preference 矩阵，字段含义不清

**改进方案**：用业务语义替代技术术语

```
┌─────────────────────────────────────────────────────┐
│  模型分配                                            │
├─────────────────────────────────────────────────────┤
│                                                     │
│  对话模型                                            │
│  ┌───────────────────────────────────────────────┐  │
│  │ 默认    [claude-sonnet-4-20250514      ▾]     │  │
│  │ 快速    [claude-haiku-4-5-20251001     ▾]     │  │
│  │ 高质量  [claude-opus-4-20250514        ▾]     │  │
│  │ 经济    [                              ▾]     │  │
│  └───────────────────────────────────────────────┘  │
│  ℹ️ Agent 可设置偏好(快速/高质量/经济)来选用不同模型   │
│                                                     │
│  视觉模型   [                    ▾] 未设置时用对话模型 │
│  嵌入模型   [text-embedding-3-small ▾]               │
│  语音转文字 [whisper-1              ▾]               │
└─────────────────────────────────────────────────────┘
```

**交互改进**：
- **下拉框改为可搜索的 Combobox**：数据源从已配置 Provider 的可用模型列表动态获取（调 `/api/models/available`），同时允许手动输入
- **分组展示**：按 Provider 分组（Anthropic / OpenAI / Ollama 等）
- **偏好说明**：在对话模型区域底部加帮助文案，解释偏好和 Agent 的关联
- **空值提示**：视觉/嵌入/STT 未设置时显示 fallback 说明（如「未设置，使用对话默认模型」）

### 1.3 移除 Default Agent Tab

**原因**：与 Agents 页面的 `main` Agent 完全重复，是混乱根源

**方案**：
- Settings 中移除「默认 Agent」标签页
- 在 Agents 页面的 `main` Agent 卡片上标注「默认」徽标
- 若用户在 Settings 点过 Default Agent tab，可改为提示「请在 Agent 管理页面编辑默认 Agent」并提供跳转链接

### 1.4 网关设置（保留但增强）

- 端口输入增加范围验证（1024-65535）
- 增加提示：「修改端口需要重启服务才能生效」
- 后续可增加：绑定地址、CORS 设置等

---

## 二、Agents 页改进

### 2.1 模型选择器（核心改进）

**现状**：硬编码的 `MODEL_OPTIONS` 数组，与实际 Provider 配置脱节

**改进方案**：

```
┌──────────────────────────────────────┐
│  模型                                │
│  ┌──────────────────────────────┐   │
│  │ 🔍 搜索模型...               │   │
│  ├──────────────────────────────┤   │
│  │ Anthropic                    │   │
│  │   claude-sonnet-4-20250514   │   │
│  │   claude-haiku-4-5-20251001  │   │
│  │ Ollama (本地)                │   │
│  │   llama3.3                   │   │
│  │   qwen2.5                   │   │
│  │ ──────────────────           │   │
│  │ 使用系统模型配置  ℹ️          │   │
│  └──────────────────────────────┘   │
└──────────────────────────────────────┘
```

**实现**：
- 页面加载时调 `/api/models/available` 获取所有已配置 Provider 的可用模型
- 按 Provider 分组展示
- 支持搜索过滤
- 增加「使用系统模型配置」选项 —— 选中时不指定 modelId，Agent 使用 systemModels 的 scene × preference 路由
- 若没有配置任何 Provider，显示空状态引导跳转 Settings

### 2.2 Agent 偏好字段（新增）

**现状**：schema 支持 `preference` 但 UI 未暴露

**改进**：在 Agent 编辑 Dialog 中增加「模型偏好」选择器

```
模型偏好   [默认 ▾]
           ├ 默认 — 使用 systemModels.chat.default
           ├ 快速 — 使用 systemModels.chat.fast（低延迟）
           ├ 高质量 — 使用 systemModels.chat.quality（最强模型）
           └ 经济 — 使用 systemModels.chat.cheap（低成本）
```

- 仅在模型选择「使用系统模型配置」时显示
- 若 Agent 指定了具体 modelId，偏好字段隐藏（具体模型优先于偏好路由）

### 2.3 Agent 卡片信息增强

**现状**：名称 + 截断 prompt + model badge + runtime badge

**改进**：

```
┌───────────────────────────────────────┐
│  main                        默认 🏷  │
│  主 Agent                             │
│                                       │
│  claude-sonnet-4  ·  默认偏好         │
│  12 个会话  ·  最近活跃 2 小时前       │
│                                       │
│  "你是一个有帮助的 AI 助手..."         │
│                                       │
│            [编辑]  [复制]  [删除]      │
└───────────────────────────────────────┘
```

- 增加会话数和最后活跃时间（需后端 API 支持）
- `main` Agent 标注「默认」徽标，删除按钮置灰并 tooltip 说明
- 增加「复制」按钮：以当前 Agent 为模板创建新 Agent
- System Prompt 预览固定 2 行，超出省略号

### 2.4 Agent 编辑 Dialog 改进

```
┌──────────────────────────────────────────────┐
│  编辑 Agent                           [×]    │
├──────────────────────────────────────────────┤
│                                              │
│  基本信息                                     │
│  ID      [main          ] 🔒 创建后不可修改   │
│  名称    [主 Agent       ]                    │
│                                              │
│  ─────────────────────────────────────────   │
│  模型配置                                     │
│  运行时   ○ 默认    ○ Claude Code             │
│                                              │
│  模型选择 [claude-sonnet-4-20250514    ▾]     │
│  模型偏好 [默认                        ▾]     │
│                                              │
│  ─────────────────────────────────────────   │
│  Claude Code 设置（仅 Claude Code 运行时）     │
│  工作目录 [/path/to/project            ]     │
│                                              │
│  ─────────────────────────────────────────   │
│  系统提示词                                   │
│  ┌────────────────────────────────────────┐  │
│  │ 你是一个有帮助的 AI 助手...             │  │
│  │                                        │  │
│  │                                        │  │
│  └────────────────────────────────────────┘  │
│                                              │
│               [取消]    [保存]                │
└──────────────────────────────────────────────┘
```

**改进点**：
- **分区布局**：基本信息、模型配置、运行时设置、系统提示词分区，用分隔线隔开
- **ID 锁定提示**：编辑模式下 ID 字段旁显示锁图标 + tooltip「创建后不可修改」
- **运行时切换**：用 Radio Group 替代 Select，更直观
- **条件显示**：
  - 选「默认」运行时 → 显示模型选择 + 模型偏好
  - 选「Claude Code」运行时 → 显示工作目录 + Claude Code 专属配置
  - 模型选择设为具体模型 → 隐藏模型偏好
  - 模型选择设为「使用系统配置」→ 显示模型偏好
- **表单验证**：实时校验，错误提示在字段下方

### 2.5 空状态引导

无 Agent 时（不太可能，因为 main 始终存在），或无 Provider 配置时：

```
┌──────────────────────────────────────┐
│  ⚠️ 尚未配置模型服务商                │
│  请先在设置中添加至少一个服务商       │
│  [前往设置 →]                        │
└──────────────────────────────────────┘
```

---

## 三、关键数据流改进

### 3.1 模型列表动态化

**当前**：Agents.tsx 硬编码 `MODEL_OPTIONS`
**改进**：

```
前端启动 → GET /api/models/available
        → 返回 { [providerName]: { type, models: string[] } }
        → 按 provider 分组渲染 Combobox
```

后端 `/api/models/available` 已存在，需确保：
- Ollama Provider 调用 Ollama API 获取本地模型列表
- 其他 Provider 返回已知模型列表 + 用户自定义 alias
- 缓存结果，避免频繁请求

### 3.2 连接测试 API

新增或完善端点：

```
POST /api/models/test-connection
Body: { provider: string, type: string, apiKey?: string, baseUrl?: string }
Response: { ok: boolean, models?: string[], error?: string }
```

用于 Settings 中 Provider 编辑时实时验证。

### 3.3 Agent 统计 API（可选增强）

```
GET /api/agents/:id/stats
Response: { sessionCount: number, lastActive: string | null }
```

用于 Agent 卡片展示使用情况。

---

## 四、实施优先级

### P0（必须修复 — 功能性问题）

| 项目 | 改动范围 | 说明 |
|------|---------|------|
| 模型列表动态化 | Agents.tsx, models route | 移除硬编码 MODEL_OPTIONS，从后端获取 |
| 移除 Default Agent Tab | Settings.tsx | 消除重复编辑入口 |
| Provider 连接测试 | Settings.tsx, models route | 添加「测试连接」按钮 |

### P1（重要改进 — 易用性）

| 项目 | 改动范围 | 说明 |
|------|---------|------|
| Agent preference 字段 | Agents.tsx, agents route | 暴露偏好选择器 |
| Provider 卡片化 + 状态指示 | Settings.tsx | 卡片布局替代列表 |
| 模型 Combobox 搜索 | Agents.tsx, Settings.tsx | 可搜索下拉，按 Provider 分组 |
| Agent 复制功能 | Agents.tsx | 「复制」按钮 |

### P2（体验优化）

| 项目 | 改动范围 | 说明 |
|------|---------|------|
| Agent 统计信息 | Agents.tsx, agents route | 会话数、最近活跃 |
| 多 Profile 管理 | Settings.tsx | 多 API Key 展示与管理 |
| 表单实时验证 | Agents.tsx, Settings.tsx | 字段级错误提示 |
| 模型配置帮助文案 | Settings.tsx | 偏好含义解释 |
| 删除保护 | Settings.tsx | Provider 删除前检查引用 |

---

## 五、技术要点

1. **模型列表共享**：创建 `useAvailableModels()` hook，Agents 和 Settings 共用，带缓存
2. **Combobox 组件**：基于 shadcn/ui 的 Command + Popover 组合实现可搜索下拉
3. **Provider 状态**：后端已有 ModelManager 的 profileStates，可暴露为 API
4. **向后兼容**：Agent 的 `modelId` 字段保留，新增空值表示「使用系统配置」
