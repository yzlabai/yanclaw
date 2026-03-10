# 模型负载均衡 — 需求分析

## 1. 现状分析

### 1.1 当前 ModelManager 架构

| 维度 | 现状 |
|------|------|
| **Profile 选择策略** | 顺序遍历，选第一个可用的（first-available） |
| **故障处理** | 失败计数 → 冷却期（默认 3 次失败，冷却 60s） → 自动恢复 |
| **回退机制** | 所有 profile 冷却时，降级使用第一个 profile |
| **负载均衡** | **无** |
| **支持供应商** | Anthropic、OpenAI、Google、Ollama（4 家） |
| **模型选择** | Agent 配置直接写死 model ID（如 `claude-sonnet-4-20250514`） |
| **状态持久化** | 纯内存，重启丢失 |

### 1.2 多模态支持现状

| 模态 | 状态 | 说明 |
|------|------|------|
| **图片 → 模型（Vision）** | ✅ 已支持 | 通过 Vercel AI SDK 原生传图，Claude/GPT/Gemini 均可 |
| **图片处理** | ✅ 已支持 | sharp 做缩略图、格式转换、质量压缩 |
| **PDF 文本提取** | ✅ 已支持 | pdf-parse 提取文本 |
| **音频提取存储** | ⚠️ 半成品 | Telegram 提取了 audio/voice，但 **未送模型**，仅存盘 |
| **视频提取存储** | ⚠️ 半成品 | Telegram 提取了 video，但 **未送模型**，仅存盘 |
| **STT（语音转文字）** | ❌ 缺失 | 无音频转录，用户发语音消息 Agent 收不到内容 |
| **TTS（文字转语音）** | ❌ 缺失 | Agent 只能输出文本，无语音回复能力 |
| **视频理解** | ❌ 缺失 | 无抽帧/转码，视频无法送视觉模型 |
| **模型按模态自动切换** | ❌ 缺失 | 收到图片仍用 agent 配的文本模型，不会自动换 vision 模型 |

**关键断层**：渠道侧已能提取 image/audio/video 四种附件类型（`Attachment.type`），但 `ChannelManager.handleInbound()` 只过滤 `type === "image"` 的 URL 传给 Agent，**音频和视频被静默丢弃**。

### 1.3 配置结构

```
models.anthropic.profiles[] → { id, apiKey, baseUrl? }
agents[].model → "claude-sonnet-4-20250514"  // 硬编码模型ID
```

Agent 与模型是 **1:1 硬绑定**关系，无法根据场景/偏好动态选择。

---

## 2. 需求拆解与必要性评估

原始需求提出三个层次，加上多模态支持不足的问题：

### 2.1 多供应商支持（必要性：⭐⭐⭐⭐ 高）

**需求**：增加火山方舟、Mistral、DeepSeek 等供应商。

**评估**：
- 当前仅 4 家供应商，国内用户常用的火山方舟（豆包）、DeepSeek 未覆盖
- Vercel AI SDK 已有社区 provider 支持这些供应商，接入成本低
- 这是**独立于负载均衡**的功能，可单独实现
- **建议**：优先做，投入小收益大

### 2.2 模型选择的二维模型（必要性：⭐⭐⭐⭐ 高）

**需求**：模型选择应有两个正交维度：

1. **场景类型（Scene）**：由输入/输出模态决定——文本对话、图片理解、语音转文字、文本转语音、向量化等
2. **偏好（Preference）**：速度、质量、价格的权衡——同一场景下可选择不同特性的模型

**核心设计：二维矩阵**

```
               ┌──────────┬──────────────────┬──────────────────┬──────────────────┐
               │ default  │ fast（速度优先） │ quality（质量优先）│ cheap（成本优先）│
  ┌────────────┼──────────┼──────────────────┼──────────────────┼──────────────────┤
  │ chat       │ sonnet   │ gemini-flash     │ opus             │ deepseek-chat    │
  │ vision     │ sonnet   │ gemini-flash     │ opus             │ gemini-flash     │
  │ embedding  │ ada-3-sm │ ada-3-sm         │ ada-3-lg         │ ada-3-sm         │
  │ stt        │ whisper  │ whisper          │ whisper          │ whisper          │
  │ tts        │ tts-1    │ tts-1            │ tts-1-hd         │ tts-1            │
  │ summary    │ deepseek │ gemini-flash     │ sonnet           │ deepseek         │
  └────────────┴──────────┴──────────────────┴──────────────────┴──────────────────┘
```

调用时只需传两个参数：`resolve(scene, preference?)`

```typescript
modelManager.resolve("chat");                 // → sonnet（默认偏好）
modelManager.resolve("chat", "fast");          // → gemini-flash
modelManager.resolve("chat", "quality");       // → opus
modelManager.resolve("vision", "fast");        // → gemini-flash
modelManager.resolve("stt");                   // → whisper（STT 目前只有一个选择）
```

**为什么是静态矩阵而非动态指标**：

| 维度 | 静态矩阵（推荐） | 实时指标采集 |
|------|------------------|----------|
| 实现复杂度 | 低（配置映射） | 高（采集+计算+排序） |
| 用户理解成本 | 低（"快/慢/省钱"直觉） | 高（不透明的自动选择） |
| 可预测性 | 高（用户知道选了什么） | 低（同一偏好可能选不同模型） |

核心观察：用户清楚哪个模型快、哪个聪明、哪个便宜。系统不需要自动判断，只需提供**声明式的二维映射表**。

**谁来设置这两个维度**：

| 设置方 | 场景（Scene） | 偏好（Preference） |
|--------|--------------|-------------------|
| **系统自动** | 检测输入模态：有图 → vision，有音频 → stt | — |
| **Agent 配置** | 固定场景（embedding agent 永远用 embedding） | 可设默认偏好（coder agent 默认 quality） |
| **渠道/绑定** | — | 可设偏好覆盖（Telegram 频道偏好 fast） |
| **用户运行时** | — | `/mode fast` 切换当前会话偏好 |

**建议**：随 Phase 1 一起做。`systemModels` 改为二维配置 + `resolveByScene` 接受 preference 参数。增量代码不大。

### 2.3 多模态支持（必要性：⭐⭐⭐⭐ 高）

**需求**：完善图片/音频/视频/语音等多模态能力。

**评估**：

**2.3.1 STT 语音转文字（必要性：⭐⭐⭐⭐⭐ 极高）**
- Telegram 用户大量使用语音消息，当前发语音 Agent 完全收不到内容，**体验断裂**
- 实现方案：收到 audio/voice 附件 → 调用 STT API 转文字 → 拼到 message 中送 Agent
- 可选 STT 供应商：OpenAI Whisper API、Google Speech-to-Text、火山方舟 ASR、本地 whisper.cpp
- 与 `systemModels` 场景映射天然契合：`systemModels.stt: "whisper-1"`
- **建议**：随 Phase 1 一起做

**2.3.2 音频/视频送模型（必要性：⭐⭐⭐ 中）**
- Gemini 2.0 已原生支持音频和视频输入（Vercel AI SDK 支持 `{ type: "file", data, mimeType }` 格式）
- 但多数模型（Claude、GPT）不支持原生音视频，需要预处理：
  - 音频 → STT 转文字（已有方案）
  - 视频 → 抽关键帧为图片序列 → 送 vision 模型（需 ffmpeg）
- **建议**：STT 先行，视频抽帧作为后续迭代

**2.3.3 TTS 文字转语音（必要性：⭐⭐ 低）**
- 需求场景：Agent 回复语音消息 / 语音播报
- 实现需要：TTS API 调用 + 音频文件生成 + 渠道回发音频消息
- 各渠道（Telegram/Discord/Slack）均支持发送语音消息
- 但 Agent 对话以文本为主，TTS 是锦上添花
- **建议**：暂缓，等有明确场景

**2.3.4 模型按模态自动切换（必要性：⭐⭐⭐ 中）**
- 当前：收到图片仍用 agent 绑定的模型，如果该模型不支持 vision 就会报错或忽略图片
- 期望：检测到图片 → 自动使用 `systemModels.vision` 指定的模型
- 与 Phase 1 的 `systemModels` + `resolveByScene` 方案天然匹配
- **建议**：随 Phase 1 一起做，在 AgentRuntime 中检测 imageUrls 非空时切换模型

### 2.4 负载均衡（必要性：⭐⭐ 低~中）

**需求**：多个模型实例之间分配请求，提高吞吐量。

**评估**：
- **关键问题**：YanClaw 是 Agent 网关，不是高并发 API 代理
  - 单 Agent 对话是长连接流式响应，一个请求占用数十秒
  - 并发量取决于同时活跃的 Agent 会话数，通常不高
  - 瓶颈在模型供应商侧的 rate limit，不在本地网关
- 现有 failover 已能应对**可用性**问题（某个 key 被限速 → 切下一个）
- 真正有用的场景：**同一供应商配多个 API key 做请求分散**，避免单 key 撞限速
  - 这只需要把 first-available 改为 round-robin，改动极小
- **建议**：仅实现 round-robin profile 轮转即可，无需复杂的加权/最少连接算法

---

## 3. 推荐方案

分三期实施，每期独立可交付：

### Phase 1：供应商扩展 + 模型注册（推荐优先做）

**目标**：`配置供应商 → 注册模型 → 按场景指定系统模型`

#### 3.1.1 扩展供应商

在 `modelsSchema` 中增加供应商：

```typescript
const modelsSchema = z.object({
  anthropic: providerSchema.optional(),
  openai: providerSchema.optional(),     // 兼容 OpenAI 兼容接口
  google: providerSchema.optional(),
  ollama: ollamaSchema.optional(),
  // 新增
  deepseek: providerSchema.optional(),   // DeepSeek 官方 API
  mistral: providerSchema.optional(),
  volcengine: providerSchema.optional(), // 火山方舟
});
```

对于使用 OpenAI 兼容 API 的供应商（火山方舟、DeepSeek、Mistral 等），可复用 `createOpenAI({ baseURL })` 只需不同的 baseUrl，无需单独适配。

**更优方案**：改为通用供应商注册，不再硬编码供应商名：

```typescript
const providerSchema = z.object({
  type: z.enum(["anthropic", "openai", "google", "ollama", "openai-compatible"]),
  profiles: z.array(authProfileSchema).default([]),
  baseUrl: z.string().optional(),
  models: z.record(z.string(), modelAliasSchema).optional(), // 模型别名映射
});

const modelsSchema = z.object({
  providers: z.record(z.string(), providerSchema).default({}),
});
```

配置示例：

```json5
{
  models: {
    providers: {
      anthropic: {
        type: "anthropic",
        profiles: [{ id: "main", apiKey: "${ANTHROPIC_API_KEY}" }]
      },
      deepseek: {
        type: "openai-compatible",
        baseUrl: "https://api.deepseek.com/v1",
        profiles: [{ id: "main", apiKey: "${DEEPSEEK_API_KEY}" }]
      },
      volcengine: {
        type: "openai-compatible",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        profiles: [{ id: "main", apiKey: "${ARK_API_KEY}" }],
        models: {
          "doubao-pro": "ep-xxx-yyy"  // 别名 → 方舟端点ID
        }
      }
    }
  }
}
```

#### 3.1.2 场景模型映射

引入 `systemModels` 二维矩阵，业务代码按 **场景 + 偏好** 获取模型：

```typescript
// 偏好枚举
const preferenceEnum = z.enum(["default", "fast", "quality", "cheap"]).default("default");

// 场景模型配置：每个场景可配一个默认模型 + 按偏好的覆盖
const sceneModelSchema = z.union([
  z.string(),                                    // 简写：直接写模型ID（等价于只配 default）
  z.object({
    default: z.string(),                          // 默认模型
    fast: z.string().optional(),                  // 速度优先
    quality: z.string().optional(),               // 质量优先
    cheap: z.string().optional(),                 // 成本优先
  }),
]);

const systemModelsSchema = z.record(z.string(), sceneModelSchema).default({});
```

配置示例：

```json5
{
  systemModels: {
    // 完整配置：每个场景按偏好分别指定模型
    chat: {
      default: "claude-sonnet-4-20250514",
      fast: "gemini-2.0-flash",
      quality: "claude-opus-4-20250514",
      cheap: "deepseek-chat",
    },
    vision: {
      default: "claude-sonnet-4-20250514",
      fast: "gemini-2.0-flash",
      quality: "claude-opus-4-20250514",
    },
    summary: {
      default: "deepseek-chat",
      quality: "claude-sonnet-4-20250514",
    },

    // 简写：只有一个模型的场景直接写字符串
    embedding: "text-embedding-3-small",
    stt: "whisper-1",
  }
}
```

业务代码调用方式：

```typescript
// 之前：硬编码模型
const model = modelManager.resolve("claude-sonnet-4-20250514", config);

// 之后：二维查询（场景 + 偏好）
const model = modelManager.resolve("chat");                // 默认偏好 → sonnet
const fast  = modelManager.resolve("chat", "fast");        // 速度优先 → gemini-flash
const think = modelManager.resolve("chat", "quality");     // 质量优先 → opus
const embed = modelManager.resolve("embedding");           // 只有一个 → ada-3-sm
const stt   = modelManager.resolve("stt");                 // 只有一个 → whisper

// resolve 逻辑（三级回退）：
// 1. 查 systemModels[scene][preference]，找到 → 用它
// 2. 找不到 → 回退查 systemModels[scene].default
// 3. 还找不到 → 使用 agent 配置的 model 字段作为最终兜底
```

Agent 和渠道配置分别指定偏好：

```json5
{
  agents: [
    { id: "coder", preference: "quality" },    // 编程 agent 默认用质量优先
    { id: "helper", preference: "fast" },       // 问答 agent 默认用速度优先
    { id: "main" },                             // 未指定 → default 偏好
  ],
  // 渠道绑定也可指定偏好覆盖
  bindings: [
    { channel: "tg-group", agentId: "main", preference: "cheap" },
  ]
}
```

偏好优先级（高→低）：**运行时切换 > 渠道绑定 > Agent 配置 > default**

#### 3.1.3 STT 语音转文字集成

在 `ChannelManager.handleInbound()` 中补上音频处理链路：

```typescript
// 伪代码：补全音频 → 文本的断链
const audioAttachments = msg.attachments.filter(a => a.type === "audio");
if (audioAttachments.length > 0) {
  const sttModel = modelManager.resolveByScene("stt", config);
  for (const audio of audioAttachments) {
    const transcript = await transcribe(sttModel, audio.url);
    // 将转录文本追加到消息
    msg.text = [msg.text, `[语音消息] ${transcript}`].filter(Boolean).join("\n");
  }
}
```

STT 实现方案选型：

| 方案 | 优点 | 缺点 |
|------|------|------|
| OpenAI Whisper API | 质量高、多语言、接入简单 | 需 OpenAI key，有成本 |
| 火山方舟 ASR | 中文优化好 | 接口不兼容 OpenAI |
| 本地 whisper.cpp | 免费、隐私 | 需编译原生依赖，转录慢 |
| Groq Whisper | 免费额度大、速度极快 | OpenAI 兼容接口 |

**建议**：优先支持 OpenAI Whisper API（兼容 Groq），用 `systemModels.stt` 指定。非 OpenAI 兼容的 ASR 服务作为后续扩展。

#### 3.1.4 模型按模态自动切换

在 `AgentRuntime.run()` 中增加模态感知 + 偏好传递：

```typescript
// 1. 根据输入模态确定场景
let scene = "chat";
if (imageUrls && imageUrls.length > 0) scene = "vision";

// 2. 偏好优先级链：运行时 > 渠道绑定 > Agent 配置 > "default"
const preference = sessionOverride ?? bindingPreference ?? agentConfig.preference ?? "default";

// 3. 二维解析
const { model, provider, profileId } = this.modelManager.resolve(scene, preference, config);
// 回退链：vision+fast → vision+default → chat+default → agent.model
```

#### 3.1.5 改动范围

| 文件 | 改动 |
|------|------|
| `config/schema.ts` | 重构 modelsSchema，新增 systemModelsSchema（含 stt/tts） |
| `agents/model-manager.ts` | 通用 provider 解析、`resolveByScene()`、provider 自动检测改为配置驱动 |
| `agents/runtime.ts` | 使用 `resolveByScene` + 模态自动切换 |
| `channels/manager.ts` | 音频附件 → STT 转录 → 拼入消息文本 |
| `db/memories.ts` | embedding 调用改用 `resolveByScene("embedding")` |
| `agents/model-manager.test.ts` | 补充测试 |
| 配置迁移 | 旧 `models.anthropic` 格式兼容处理 |

**预估工作量**：中等偏大（config schema 重构 + 兼容性 + STT 集成 + 模态切换）

---

### Phase 2：Profile 轮转（可选，小改动）

**目标**：同供应商多 key 均匀分散请求

#### 改动

在 ModelManager 中将 first-available 改为 round-robin：

```typescript
class ModelManager {
  private roundRobinIndex = new Map<string, number>(); // provider → index

  private selectProfile(provider: string, profiles: AuthProfile[]): AuthProfile {
    const available = profiles.filter(p => this.isAvailable(provider, p.id));
    if (available.length === 0) return profiles[0]; // fallback

    const key = provider;
    const idx = (this.roundRobinIndex.get(key) ?? 0) % available.length;
    this.roundRobinIndex.set(key, idx + 1);
    return available[idx];
  }
}
```

**改动范围**：仅 `model-manager.ts` 内部逻辑 + 测试，**不影响外部接口**。

**预估工作量**：小（半小时内）

---

### Phase 3：运行时偏好切换（可选，依赖 Phase 1）

Phase 1 已在配置层解决了二维模型选择，Phase 3 进一步支持**运行时动态切换偏好维度**：

- 用户在对话中发 `/mode fast` 或 `/mode quality` → 当前会话的偏好覆盖为 fast/quality
- 实现方式：Session 上记录 `preferenceOverride`，AgentRuntime 读取时作为最高优先级
- 也可做成 Agent 工具：Agent 自己判断问题复杂度，调用 `switch_preference("quality")` 升级到推理模型
- 场景维度（scene）始终由系统自动检测，用户只需切换偏好维度

这是锦上添花功能，Phase 1 的配置级偏好已覆盖绝大多数场景。

---

## 4. 总结

| 方案 | 必要性 | 复杂度 | 建议 |
|------|--------|--------|------|
| Phase 1: 供应商扩展 + 场景/偏好映射 + STT + 模态切换 | 高 | 中偏大 | ✅ 推荐立即实施 |
| Phase 2: Profile 轮转 | 低~中 | 小 | ✅ 顺手做，改动极小 |
| Phase 3: 运行时偏好切换 | 中 | 小 | ⏳ Phase 1 之后按需 |
| Phase 4: TTS + 视频理解 | 低 | 大 | ❌ 暂缓，锦上添花 |

**核心结论**：

1. **"负载均衡"的表述偏重**，实际痛点是**供应商不够多**、**模型选择不灵活**、**多模态管道断裂**。
2. **Phase 1 一次性解决三大问题**：
   - **供应商少** → 通用 provider 注册（`openai-compatible` 统一接入 DeepSeek/火山方舟/Mistral 等）
   - **选择不灵活** → `systemModels` 二维矩阵（场景 × 偏好），调用时传 `resolve(scene, preference)` 即可，场景由模态自动检测，偏好由 Agent/渠道/用户分层指定
   - **多模态断裂** → STT 语音转文字 + 模态自动切换（有图自动用 vision 模型）
3. **偏好路由不需要复杂实现**：静态二维矩阵 + 三级回退就够了。用户清楚哪个模型快/聪明/便宜，系统只需提供**声明式配置 + 分层覆盖机制**，不需要自动指标评估。
4. Profile 轮转（Phase 2）改动极小可以捎带做。
5. 运行时切换（Phase 3）等有需求再做。TTS/视频理解（Phase 4）暂缓。
