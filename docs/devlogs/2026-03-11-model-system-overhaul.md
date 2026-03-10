# 2026-03-11 模型系统重构

## 概述

将 ModelManager 从"硬编码供应商 + 单模型绑定"重构为"通用供应商注册 + 二维模型选择（场景 × 偏好）+ 多模态管道"。

对应计划文档：`docs/plans/2026-03-10-model-system-overhaul.md`

## 改动摘要

### 1. 配置 Schema 重构

**文件：** `packages/server/src/config/schema.ts`

- `modelsSchema` 从硬编码 `anthropic/openai/google/ollama` 改为通用 `providers: Record<string, providerSchema>`
- `providerSchema` 新增 `type` 字段（`anthropic | openai | google | ollama | openai-compatible`）和 `models` 别名映射
- 新增 `systemModelsSchema`：二维矩阵 `Record<scene, string | { default, fast?, quality?, cheap? }>`
- `agentSchema` 和 `bindingSchema` 新增可选 `preference` 字段
- 导出 `ProviderConfig`、`AuthProfile`、`Preference`、`SystemModels` 等新类型

### 2. 旧配置迁移

**文件：** `packages/server/src/config/store.ts`

- 新增 `migrateConfig()` 函数，在 Zod 校验前自动检测旧格式并迁移
- 在 `load()` 和热重载 `startWatcher()` 中均调用迁移
- 旧格式用户会看到 warn 日志提示更新配置文件

### 3. ModelManager 重写

**文件：** `packages/server/src/agents/model-manager.ts`

- **通用供应商查找**：`findProvider()` 先查别名映射，再按前缀推断，最后单供应商回退
- **统一模型创建**：`createModel()` 根据 `providerConfig.type` 走不同 SDK 分支，`openai-compatible` 与 `openai` 共用逻辑
- **二维解析 API**：`resolve(scene, preference, config)` / `resolveWithMeta(scene, preference, config)`
  - 查找链：`systemModels[scene][preference]` → `systemModels[scene].default` → 场景回退（vision→chat）
- **旧 API 保留**：`resolveById()` / `resolveByIdWithMeta()` 供迁移期使用
- **Round-robin**：多 Profile 间轮转分配请求，替代原来的 first-available
- **Embedding 解析**：新增 `resolveEmbedding()` 方法
- **STT 辅助**：新增 `findProviderForModel()` 暴露给 SttService

### 4. AgentRuntime 集成

**文件：** `packages/server/src/agents/runtime.ts`

- `run()` 参数新增可选 `preference`
- 模型解析改为：先尝试 2D `resolveWithMeta(scene, preference, config)`，失败时回退到 `resolveByIdWithMeta(agentConfig.model)`
- 场景自动检测：有图片附件时 scene="vision"，否则 scene="chat"
- 偏好优先级链：`runtime preference > agent preference > "default"`

### 5. ChannelManager 集成

**文件：** `packages/server/src/channels/manager.ts`

- agentRunner 类型签名新增 `preference` 参数
- `handleInbound()` 从 `route.binding?.preference` 读取偏好传递给 agentRunner
- 新增 STT 音频转录：提取 audio/voice 附件 → `sttService.transcribe()` → 拼接到消息文本

### 6. STT 语音转文字服务

**新建文件：** `packages/server/src/media/stt.ts`

- `SttService` 类，通过 OpenAI 兼容 `/audio/transcriptions` 端点转录语音
- 从 `systemModels.stt` 读取模型配置，通过 ModelManager 查找供应商和 Profile
- `isAvailable()` 方法供 ChannelManager 判断是否跳过转录
- 在 `gateway.ts` 中初始化并注入 ChannelManager

### 7. Embedding 迁移

**文件：** `packages/server/src/memory/embeddings.ts`

- 移除硬编码 OpenAI embedding，改为通过 `ModelManager.resolveEmbedding()` 解析
- 新增 `setEmbeddingModelManager()` 在 gateway 初始化时注入共享实例
- 仍保留 `config.memory.embeddingModel` 作为模型 ID 来源（向后兼容）

### 8. 其他文件适配

- `routes/system.ts`：`needsSetup` 检查改为遍历 `config.models.providers`
- `routes/chat.ts`：`chatSendSchema` 新增可选 `preference` 字段，传递给 agentRuntime
- `security/leak-detector.ts`：`registerFromConfig` 适配新 providers 结构
- `pages/Settings.tsx`、`pages/Onboarding.tsx`：前端配置保存改为新 providers 格式
- `gateway.ts`：初始化 SttService，设置 embedding ModelManager

### 9. 测试

**文件：** `packages/server/src/agents/model-manager.test.ts`

全量重写测试，从 9 个测试扩展到 21 个：
- 旧 API 兼容（resolveByIdWithMeta 前缀推断）
- 通用供应商注册（openai-compatible、别名映射、单供应商回退）
- 二维 resolve（scene×preference、偏好回退、场景回退、字符串简写）
- Round-robin（多 Profile 分配、冷却跳过）
- 失败恢复和冷却（原有用例适配新 API）

## 配置示例

```json5
{
  models: {
    providers: {
      anthropic: {
        type: "anthropic",
        profiles: [{ id: "default", apiKey: "${ANTHROPIC_API_KEY}" }],
      },
      deepseek: {
        type: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        profiles: [{ id: "default", apiKey: "${DEEPSEEK_API_KEY}" }],
      },
    },
  },
  systemModels: {
    chat: {
      default: "claude-sonnet-4-20250514",
      fast: "deepseek-chat",
      quality: "claude-opus-4-20250514",
    },
    vision: "claude-sonnet-4-20250514",
    embedding: "text-embedding-3-small",
    stt: "whisper-1",
  },
}
```

## 验证结果

- `bun run check`：通过（0 errors）
- `bun run build`：server + web 均通过
- `bun run test`：91 tests 全部通过（原 80 个 + 新增 11 个）
