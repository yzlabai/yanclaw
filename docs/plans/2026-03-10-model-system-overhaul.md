# 模型系统重构 — 开发计划

对应需求文档：`docs/todos/2026-03-10-model-load-balance-analysis.md`

---

## 概览

将现有 ModelManager 从"硬编码供应商 + 单模型绑定"重构为"通用供应商注册 + 二维模型选择（场景 × 偏好）+ 多模态管道"。

**交付物**：
1. 通用供应商注册系统（支持任意 OpenAI 兼容供应商）
2. `systemModels` 二维矩阵配置 + `resolve(scene, preference)` API
3. Agent/渠道偏好配置 + 偏好优先级链
4. STT 语音转文字集成
5. 模态自动检测 + 模型切换
6. Profile round-robin 轮转
7. 旧配置格式兼容迁移

---

## Step 1: 配置 Schema 重构

**修改文件:** `packages/server/src/config/schema.ts`

### 1.1 通用供应商 Schema

替换现有硬编码供应商为通用 provider 注册：

```typescript
const authProfileSchema = z.object({
	id: z.string(),
	apiKey: z.string(),
	baseUrl: z.string().optional(),
});

const providerSchema = z.object({
	type: z.enum(["anthropic", "openai", "google", "ollama", "openai-compatible"]),
	profiles: z.array(authProfileSchema).default([]),
	baseUrl: z.string().optional(),                        // 供应商级别 baseUrl
	models: z.record(z.string(), z.string()).optional(),   // 模型别名映射
});

const modelsSchema = z.object({
	providers: z.record(z.string(), providerSchema).default({}),
});
```

### 1.2 二维 systemModels Schema

```typescript
const preferenceValues = ["default", "fast", "quality", "cheap"] as const;
type Preference = typeof preferenceValues[number];

const sceneModelSchema = z.union([
	z.string(),                                     // 简写：等价于 { default: "model-id" }
	z.object({
		default: z.string(),
		fast: z.string().optional(),
		quality: z.string().optional(),
		cheap: z.string().optional(),
	}),
]);

const systemModelsSchema = z.record(z.string(), sceneModelSchema).default({});
```

### 1.3 Agent 增加 preference 字段

```typescript
const agentSchema = z.object({
	// ... 现有字段不变
	preference: z.enum(preferenceValues).optional(),   // 新增
});
```

### 1.4 Binding 增加 preference 字段

```typescript
const bindingSchema = z.object({
	// ... 现有字段不变
	preference: z.enum(preferenceValues).optional(),   // 新增
});
```

### 1.5 旧配置兼容

在 ConfigStore 加载后、Zod 校验前，插入迁移层：

```typescript
function migrateConfig(raw: unknown): unknown {
	// 检测旧格式：models.anthropic / models.openai / models.google / models.ollama
	// 如果存在且不在 models.providers 下 → 自动迁移到 models.providers
	if (raw.models && !raw.models.providers) {
		const providers: Record<string, any> = {};
		for (const [name, value] of Object.entries(raw.models)) {
			if (name === "ollama") {
				providers[name] = { type: "ollama", ...value };
			} else {
				const type = name; // anthropic/openai/google → 同名 type
				providers[name] = { type, ...value };
			}
		}
		raw.models = { providers };
	}
	return raw;
}
```

同时在 `config/store.ts` 的 `load()` 方法中调用 `migrateConfig()`。首次加载旧格式时输出 warn 日志提示用户更新配置。

**验收标准**：
- [ ] 新旧配置格式均能通过 Zod 校验
- [ ] `bun run check` 通过

---

## Step 2: ModelManager 重构

**修改文件:** `packages/server/src/agents/model-manager.ts`

### 2.1 通用 Provider 解析

替换现有按 model ID 前缀推断供应商的逻辑，改为配置驱动：

```typescript
// 新增：从 providers 配置中查找模型所属供应商
private findProvider(modelId: string, config: AppConfig): {
	providerName: string;
	providerConfig: ProviderConfig;
	resolvedModelId: string;  // 处理别名后的实际 ID
} {
	// 1. 遍历 providers，检查 models 别名映射
	for (const [name, prov] of Object.entries(config.models.providers)) {
		if (prov.models?.[modelId]) {
			return { providerName: name, providerConfig: prov, resolvedModelId: prov.models[modelId] };
		}
	}
	// 2. 按前缀推断（兼容老行为）
	//    claude-* → 找 type=anthropic 的 provider
	//    gpt-*/o1-*/o3-* → 找 type=openai 的 provider
	//    gemini-* → 找 type=google 的 provider
	// 3. 都找不到 → 抛错
}
```

### 2.2 `createModel` 统一方法

```typescript
private createModel(
	providerConfig: ProviderConfig,
	profile: AuthProfile,
	modelId: string,
): LanguageModel {
	const baseUrl = profile.baseUrl ?? providerConfig.baseUrl;

	switch (providerConfig.type) {
		case "anthropic":
			return baseUrl
				? createAnthropic({ apiKey: profile.apiKey, baseURL: baseUrl })(modelId)
				: anthropic(modelId, { headers: { "x-api-key": profile.apiKey } });

		case "openai":
		case "openai-compatible":
			return createOpenAI({ apiKey: profile.apiKey, baseURL: baseUrl })(modelId);

		case "google":
			return baseUrl
				? createGoogleGenerativeAI({ apiKey: profile.apiKey, baseURL: baseUrl })(modelId)
				: google(modelId, { apiKey: profile.apiKey });

		case "ollama":
			return createOpenAI({ apiKey: "ollama", baseURL: baseUrl ?? "http://localhost:11434/v1" })(modelId);
	}
}
```

关键点：`openai-compatible` 和 `openai` 共用同一分支，区别仅在配置层（baseUrl 不同）。

### 2.3 二维 resolve API

```typescript
// 新公共 API
resolve(scene: string, preference?: Preference, config: AppConfig): LanguageModel;
resolveWithMeta(scene: string, preference?: Preference, config: AppConfig): {
	model: LanguageModel;
	provider: string;
	profileId: string;
};

// 内部逻辑
private resolveModelId(scene: string, preference: Preference, config: AppConfig): string {
	const pref = preference ?? "default";
	const sceneConfig = config.systemModels?.[scene];

	// 1. 查 systemModels[scene][preference]
	if (sceneConfig) {
		if (typeof sceneConfig === "string") return sceneConfig;
		if (sceneConfig[pref]) return sceneConfig[pref];
		if (sceneConfig.default) return sceneConfig.default;
	}

	// 2. 场景回退：vision → chat（视觉回退到对话模型）
	if (scene !== "chat" && scene !== "embedding" && scene !== "stt") {
		return this.resolveModelId("chat", pref, config);
	}

	// 3. 最终兜底
	throw new Error(`No model configured for scene="${scene}" preference="${pref}"`);
}
```

### 2.4 保留旧 API 兼容

旧的 `resolve(modelId, config)` 签名仍保留，通过重载区分：

```typescript
// 重载签名
resolve(modelId: string, config: AppConfig): LanguageModel;                          // 旧 API
resolve(scene: string, preference: Preference | undefined, config: AppConfig): LanguageModel;  // 新 API

// 区分逻辑：第二个参数是 string(preference) 还是 object(config)
```

### 2.5 Round-robin Profile 选择

```typescript
private roundRobinIndex = new Map<string, number>();

private selectProfile(providerName: string, profiles: AuthProfile[]): AuthProfile {
	const available = profiles.filter(p => this.isAvailable(providerName, p.id));
	if (available.length === 0) {
		console.warn(`[model] All ${providerName} profiles in cooldown, using first`);
		return profiles[0];
	}
	if (available.length === 1) return available[0];

	const idx = (this.roundRobinIndex.get(providerName) ?? 0) % available.length;
	this.roundRobinIndex.set(providerName, idx + 1);
	return available[idx];
}
```

**验收标准**：
- [ ] 新旧 resolve API 均可正常工作
- [ ] `openai-compatible` 类型的 provider 能正确创建模型
- [ ] 模型别名映射正常（如 `doubao-pro` → `ep-xxx`）
- [ ] round-robin 在多 profile 间均匀分配
- [ ] 现有测试继续通过 + 新测试覆盖新功能

---

## Step 3: AgentRuntime 二维模型选择集成

**修改文件:** `packages/server/src/agents/runtime.ts`

### 3.1 传递偏好参数

`AgentRuntime.run()` 入参增加 `preference` 可选字段：

```typescript
interface RunOptions {
	// ... 现有字段
	preference?: Preference;   // 新增：由 ChannelManager 传入
}
```

### 3.2 模态自动检测 + 偏好链

替换现有的硬编码 `resolveWithMeta(agentConfig.model, config)`：

```typescript
// 1. 场景检测（由输入模态决定）
let scene = "chat";
if (opts.imageUrls && opts.imageUrls.length > 0) scene = "vision";

// 2. 偏好优先级链
const preference = opts.preference ?? agentConfig.preference ?? "default";

// 3. 二维解析
const { model, provider, profileId } = this.modelManager.resolveWithMeta(scene, preference, config);
```

### 3.3 ChannelManager 偏好传递

**修改文件:** `packages/server/src/channels/manager.ts`

在 `handleInbound()` 中读取 binding 的 preference 并传给 agentRunner：

```typescript
const events = this.agentRunner({
	// ... 现有字段
	preference: route.preference,   // 新增：从 binding 配置读取
});
```

### 3.4 Chat 路由偏好传递

**修改文件:** `packages/server/src/routes/chat.ts`

chatSendSchema 增加可选 preference 字段：

```typescript
const chatSendSchema = z.object({
	// ... 现有字段
	preference: z.enum(["default", "fast", "quality", "cheap"]).optional(),
});
```

**验收标准**：
- [ ] 发送图片时自动使用 vision 场景模型
- [ ] Agent preference 配置生效
- [ ] Binding preference 覆盖 Agent preference
- [ ] WebChat 前端可传 preference 参数

---

## Step 4: STT 语音转文字集成

### 4.1 STT 服务

**新建文件:** `packages/server/src/media/stt.ts`

```typescript
import type { AppConfig } from "../config/schema";
import type { ModelManager } from "../agents/model-manager";

export class SttService {
	constructor(
		private modelManager: ModelManager,
	) {}

	async transcribe(audioUrl: string, config: AppConfig): Promise<string> {
		// 1. 从 systemModels 获取 stt 模型配置
		const modelId = this.resolveModelId(config);
		// 2. 查找对应 provider 和 profile
		const { providerConfig, profile } = this.modelManager.findProviderForModel(modelId, config);
		// 3. 调用 OpenAI 兼容的 /audio/transcriptions 端点
		const baseUrl = profile.baseUrl ?? providerConfig.baseUrl ?? "https://api.openai.com/v1";
		// 4. 下载音频 → FormData → POST /audio/transcriptions
		const audioResp = await fetch(audioUrl);
		const audioBlob = await audioResp.blob();

		const form = new FormData();
		form.append("file", audioBlob, "audio.ogg");
		form.append("model", modelId);

		const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
			method: "POST",
			headers: { Authorization: `Bearer ${profile.apiKey}` },
			body: form,
		});
		const result = await resp.json();
		return result.text;
	}

	private resolveModelId(config: AppConfig): string {
		const sttConfig = config.systemModels?.stt;
		if (!sttConfig) throw new Error("systemModels.stt not configured");
		return typeof sttConfig === "string" ? sttConfig : sttConfig.default;
	}
}
```

### 4.2 ChannelManager 集成

**修改文件:** `packages/server/src/channels/manager.ts`

在 `handleInbound()` 中 imageUrls 提取之后，增加音频转录：

```typescript
// 提取图片（已有逻辑）
const imageUrls = msg.attachments
	.filter((a) => a.type === "image" && a.url)
	.map((a) => a.url as string);

// 新增：音频转录
const audioAttachments = msg.attachments.filter((a) => a.type === "audio" && a.url);
let transcribedText = "";
if (audioAttachments.length > 0 && this.sttService) {
	const transcripts = await Promise.all(
		audioAttachments.map((a) => this.sttService!.transcribe(a.url!, config)),
	);
	transcribedText = transcripts.join("\n");
}

// 合并消息文本
const finalText = [msg.text, transcribedText].filter(Boolean).join("\n");
```

### 4.3 GatewayContext 注入

**修改文件:** `packages/server/src/gateway.ts`

```typescript
import { SttService } from "./media/stt";

export function initGateway(config: ConfigStore): GatewayContext {
	const modelManager = new ModelManager();
	const sttService = new SttService(modelManager);
	// ... 传入 ChannelManager
}
```

**验收标准**：
- [ ] 配置 `systemModels.stt: "whisper-1"` 后，Telegram 语音消息能正确转录
- [ ] 未配置 stt 时，音频附件仍静默跳过（不报错）
- [ ] 转录文本正确拼接到消息中送给 Agent

---

## Step 5: Embedding 调用迁移

**修改文件:** `packages/server/src/db/memories.ts`

将现有的硬编码 embedding 模型调用改为通过 `resolve("embedding")` 获取：

```typescript
// 之前
const { embedding } = await embed({
	model: openai.embedding("text-embedding-3-small"),
	value: text,
});

// 之后
const embeddingModel = this.modelManager.resolve("embedding", undefined, config);
const { embedding } = await embed({ model: embeddingModel, value: text });
```

需要确认 Vercel AI SDK 的 `embed()` 函数对不同供应商 embedding 模型的兼容性。OpenAI 和兼容接口（如 Ollama embedding）走 `createOpenAI` 即可。

**验收标准**：
- [ ] 向量化使用 systemModels.embedding 配置的模型
- [ ] 未配置时有合理报错

---

## Step 6: 测试

**修改文件:** `packages/server/src/agents/model-manager.test.ts`

### 6.1 新增测试用例

```typescript
describe("通用供应商注册", () => {
	it("openai-compatible 类型使用自定义 baseUrl");
	it("模型别名映射正确解析");
	it("未知模型 ID 按前缀推断供应商（兼容旧行为）");
});

describe("二维 resolve", () => {
	it("resolve(scene, preference) 返回正确模型");
	it("preference 缺失时回退到 default");
	it("场景缺失时 vision 回退到 chat");
	it("简写格式（字符串）与完整格式（对象）均正常");
});

describe("round-robin", () => {
	it("多 profile 均匀分配请求");
	it("冷却中的 profile 被跳过后仍 round-robin");
});

describe("旧 API 兼容", () => {
	it("旧签名 resolve(modelId, config) 仍可用");
});
```

### 6.2 STT 测试

**新建文件:** `packages/server/src/media/stt.test.ts`

```typescript
describe("SttService", () => {
	it("调用 OpenAI 兼容 transcription 端点");
	it("未配置 stt 时抛出明确错误");
});
```

**验收标准**：
- [ ] 所有现有测试继续通过
- [ ] 新增测试覆盖核心路径
- [ ] `bun run test` 全绿
- [ ] `bun run check` 通过

---

## Step 7: 配置文档更新

**修改文件:** 示例配置文件 / onboarding

更新 onboarding 流程，在模型配置步骤支持新格式：

- 供应商选择增加 DeepSeek、火山方舟、Mistral 等选项
- type 为 `openai-compatible` 时显示 baseUrl 输入框
- systemModels 基础配置引导（至少配 chat + embedding）

---

## 实施顺序与依赖

```
Step 1 (Schema)
    ↓
Step 2 (ModelManager) ← 依赖 Step 1 的新类型
    ↓
Step 3 (Runtime集成) + Step 5 (Embedding迁移)  ← 并行，均依赖 Step 2
    ↓
Step 4 (STT)  ← 依赖 Step 2 + Step 3
    ↓
Step 6 (测试)  ← 贯穿全程，每步完成后补测试
    ↓
Step 7 (文档)
```

**关键路径**：Step 1 → Step 2 → Step 3 → Step 4

---

## 风险与注意事项

| 风险 | 应对 |
|------|------|
| **旧配置迁移遗漏** | migrateConfig 加充分日志；首次加载旧格式时 warn 提示用户 |
| **Vercel AI SDK embed() 兼容性** | 部分供应商的 embedding 接口与 OpenAI 不完全兼容，需测试确认 |
| **STT 音频格式** | Telegram voice 是 OGG Opus，Whisper API 支持，但其他 STT 供应商可能不支持 → 可能需要 ffmpeg 转码 |
| **resolve 签名重载歧义** | 通过第二参数类型区分（string vs object），需在 TS 层面严格定义重载 |
| **供应商 API 差异** | openai-compatible 不一定 100% 兼容（如流式响应格式），需逐个测试验证 |

---

## 暂不实施（后续迭代）

| 功能 | 原因 |
|------|------|
| **运行时偏好切换（Phase 3）** | 依赖本次 Phase 1 完成，作为后续独立迭代 |
| **TTS 文字转语音** | 需求优先级低，等有明确场景 |
| **视频理解（抽帧）** | 需要 ffmpeg 依赖，复杂度高，等有明确场景 |
| **动态指标采集** | 静态矩阵已覆盖 90% 场景，不做实时指标 |
