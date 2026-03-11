import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { API_BASE, apiFetch } from "../lib/api";

interface ProviderOption {
	id: string;
	label: string;
	type: "anthropic" | "openai" | "google" | "ollama" | "openai-compatible";
	needsApiKey: boolean;
	needsBaseUrl: boolean;
	defaultBaseUrl?: string;
	placeholder?: string;
	models: Array<{ value: string; label: string }>;
}

const PROVIDERS: ProviderOption[] = [
	{
		id: "anthropic",
		label: "Anthropic",
		type: "anthropic",
		needsApiKey: true,
		needsBaseUrl: false,
		placeholder: "sk-ant-...",
		models: [
			{ value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
			{ value: "claude-opus-4-20250514", label: "Claude Opus 4" },
			{ value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
		],
	},
	{
		id: "openai",
		label: "OpenAI",
		type: "openai",
		needsApiKey: true,
		needsBaseUrl: false,
		placeholder: "sk-...",
		models: [
			{ value: "gpt-4o", label: "GPT-4o" },
			{ value: "gpt-4o-mini", label: "GPT-4o Mini" },
			{ value: "o3-mini", label: "o3-mini" },
		],
	},
	{
		id: "google",
		label: "Google",
		type: "google",
		needsApiKey: true,
		needsBaseUrl: false,
		placeholder: "AIza...",
		models: [
			{ value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro" },
			{ value: "gemini-2.5-flash-preview-04-17", label: "Gemini 2.5 Flash" },
			{ value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
		],
	},
	{
		id: "deepseek",
		label: "DeepSeek",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://api.deepseek.com/v1",
		placeholder: "sk-...",
		models: [
			{ value: "deepseek-chat", label: "DeepSeek Chat (V3)" },
			{ value: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
		],
	},
	{
		id: "mistral",
		label: "Mistral",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://api.mistral.ai/v1",
		placeholder: "...",
		models: [
			{ value: "mistral-large-latest", label: "Mistral Large" },
			{ value: "mistral-small-latest", label: "Mistral Small" },
		],
	},
	{
		id: "volcengine",
		label: "\u706B\u5C71\u65B9\u821F",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
		placeholder: "...",
		models: [
			{ value: "doubao-seed-1.6", label: "Doubao Seed 1.6" },
			{ value: "doubao-1.5-pro-256k", label: "Doubao 1.5 Pro 256K" },
			{ value: "deepseek-r1-250120", label: "DeepSeek R1 (\u65B9\u821F)" },
			{ value: "deepseek-v3-241226", label: "DeepSeek V3 (\u65B9\u821F)" },
		],
	},
	{
		id: "ollama",
		label: "Ollama",
		type: "ollama",
		needsApiKey: false,
		needsBaseUrl: true,
		defaultBaseUrl: "http://localhost:11434/v1",
		models: [],
	},
	{
		id: "custom",
		label: "OpenAI Compatible",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: true,
		placeholder: "sk-...",
		models: [],
	},
];

function StepIndicator({ current, total }: { current: number; total: number }) {
	return (
		<div className="flex items-center justify-center gap-2 mb-8">
			{Array.from({ length: total }, (_, i) => (
				<div key={i} className="flex items-center">
					<div
						className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
							i < current
								? "bg-primary text-primary-foreground"
								: i === current
									? "bg-primary text-primary-foreground ring-2 ring-primary/30"
									: "bg-muted text-muted-foreground"
						}`}
					>
						{i < current ? "\u2713" : i + 1}
					</div>
					{i < total - 1 && (
						<div
							className={`w-8 h-0.5 mx-1 transition-colors ${
								i < current ? "bg-primary" : "bg-border"
							}`}
						/>
					)}
				</div>
			))}
		</div>
	);
}

export function Onboarding() {
	const navigate = useNavigate();
	const [step, setStep] = useState(0);
	const [providerId, setProviderId] = useState("anthropic");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [model, setModel] = useState("claude-sonnet-4-20250514");
	const [customModel, setCustomModel] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	// Channel setup (optional)
	const [telegramToken, setTelegramToken] = useState("");
	const [slackBotToken, setSlackBotToken] = useState("");
	const [slackAppToken, setSlackAppToken] = useState("");

	const providerDef = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0];
	const hasPresetModels = providerDef.models.length > 0;
	const finalModel = hasPresetModels ? model : customModel;

	const selectProvider = useCallback((p: ProviderOption) => {
		setProviderId(p.id);
		setApiKey("");
		setBaseUrl(p.defaultBaseUrl ?? "");
		if (p.models.length > 0) {
			setModel(p.models[0].value);
		}
		setCustomModel("");
	}, []);

	const saveModelConfig = useCallback(async () => {
		setSaving(true);
		setError("");
		try {
			const providerConfig: Record<string, unknown> = {
				type: providerDef.type,
				profiles: providerDef.needsApiKey ? [{ id: "default", apiKey }] : [],
			};
			const effectiveBaseUrl = baseUrl || providerDef.defaultBaseUrl;
			if (effectiveBaseUrl) {
				providerConfig.baseUrl = effectiveBaseUrl;
			}

			const patch: Record<string, unknown> = {
				models: {
					providers: { [providerId]: providerConfig },
				},
				systemModels: {
					chat: finalModel,
				},
				agents: [
					{
						id: "main",
						name: "\u9ED8\u8BA4\u52A9\u624B",
						model: finalModel,
						systemPrompt: "You are a helpful assistant.",
					},
				],
			};

			const res = await apiFetch(`${API_BASE}/api/config`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});

			if (!res.ok) throw new Error("Failed to save config");
			setStep(2);
		} catch {
			setError("Failed to save model configuration. Please check the server is running.");
		} finally {
			setSaving(false);
		}
	}, [providerId, providerDef, apiKey, baseUrl, finalModel]);

	const saveChannelConfig = useCallback(async () => {
		setSaving(true);
		setError("");
		try {
			const channels: Record<string, unknown> = {};

			if (telegramToken) {
				channels.telegram = {
					enabled: true,
					accounts: [{ id: "default", token: telegramToken, dmPolicy: "allowlist" }],
				};
			}

			if (slackBotToken && slackAppToken) {
				channels.slack = {
					enabled: true,
					accounts: [
						{
							id: "default",
							botToken: slackBotToken,
							appToken: slackAppToken,
							dmPolicy: "allowlist",
						},
					],
				};
			}

			if (Object.keys(channels).length > 0) {
				const res = await apiFetch(`${API_BASE}/api/config`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ channels }),
				});
				if (!res.ok) throw new Error("Failed to save channels");
			}

			setStep(3);
		} catch {
			setError("Failed to save channel configuration.");
		} finally {
			setSaving(false);
		}
	}, [telegramToken, slackBotToken, slackAppToken]);

	const canContinue = providerDef.needsApiKey ? !!apiKey && !!finalModel : !!finalModel;

	return (
		<div className="min-h-screen flex items-center justify-center bg-background p-4">
			<div className="w-full max-w-lg">
				<StepIndicator current={step} total={4} />
				<div className="bg-card rounded-2xl shadow-warm p-8 border border-border">
					{/* Step 0: Welcome */}
					{step === 0 && (
						<div className="text-center space-y-6 animate-fade-in-up">
							<h2 className="text-3xl font-bold">欢迎使用 YanClaw</h2>
							<p className="text-muted-foreground text-lg">
								AI Agent 网关平台，连接聊天频道与 AI Agent
							</p>
							<Button size="lg" onClick={() => setStep(1)} className="rounded-xl">
								开始配置
							</Button>
						</div>
					)}

					{/* Step 1: Model Setup */}
					{step === 1 && (
						<div className="space-y-6 animate-fade-in-up">
							<div>
								<h2 className="text-xl font-bold mb-1">模型配置</h2>
								<p className="text-muted-foreground text-sm">
									Choose your AI model provider and enter your API key.
								</p>
							</div>

							<div>
								<label className="block text-sm text-foreground/80 mb-2">Provider</label>
								<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
									{PROVIDERS.map((p) => (
										<button
											key={p.id}
											type="button"
											onClick={() => selectProvider(p)}
											className={`flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all card-hover ${
												providerId === p.id
													? "border-primary bg-primary/10"
													: "border-border hover:border-primary/50"
											}`}
										>
											<span className="text-sm font-medium">{p.label}</span>
										</button>
									))}
								</div>
							</div>

							{providerDef.needsApiKey && (
								<div>
									<label className="block text-sm text-foreground/80 mb-1">API Key</label>
									<Input
										type="password"
										value={apiKey}
										onChange={(e) => setApiKey(e.target.value)}
										placeholder={providerDef.placeholder ?? "API key"}
										className="rounded-xl"
									/>
								</div>
							)}

							{(providerDef.needsBaseUrl || providerDef.defaultBaseUrl) && (
								<div>
									<label className="block text-sm text-foreground/80 mb-1">
										API Base URL
										{providerDef.defaultBaseUrl && !providerDef.needsBaseUrl && (
											<span className="text-muted-foreground font-normal ml-1">(optional)</span>
										)}
									</label>
									<Input
										type="text"
										value={baseUrl}
										onChange={(e) => setBaseUrl(e.target.value)}
										placeholder={providerDef.defaultBaseUrl ?? "https://api.example.com/v1"}
										className="rounded-xl"
									/>
								</div>
							)}

							<div>
								<label className="block text-sm text-foreground/80 mb-1">Default Model</label>
								{hasPresetModels ? (
									<select
										value={model}
										onChange={(e) => setModel(e.target.value)}
										className="w-full bg-muted rounded-xl px-4 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
									>
										{providerDef.models.map((opt) => (
											<option key={opt.value} value={opt.value}>
												{opt.label}
											</option>
										))}
									</select>
								) : (
									<Input
										type="text"
										value={customModel}
										onChange={(e) => setCustomModel(e.target.value)}
										placeholder={
											providerDef.type === "ollama" ? "llama3.3, qwen3:32b, ..." : "model-name"
										}
										className="rounded-xl"
									/>
								)}
							</div>

							{error && <p className="text-red-400 text-sm">{error}</p>}

							<Button
								onClick={saveModelConfig}
								disabled={!canContinue || saving}
								className="w-full rounded-xl"
							>
								{saving ? "Saving..." : "Continue"}
							</Button>

							<div className="flex justify-between mt-8">
								<Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl">
									上一步
								</Button>
							</div>
						</div>
					)}

					{/* Step 2: Channels (optional) */}
					{step === 2 && (
						<div className="space-y-6 animate-fade-in-up">
							<div className="flex items-center justify-between">
								<h2 className="text-xl font-bold">频道配置</h2>
								<button
									type="button"
									onClick={() => setStep(3)}
									className="text-sm text-muted-foreground hover:text-foreground transition-colors"
								>
									跳过
								</button>
							</div>
							<p className="text-muted-foreground text-sm">
								Optionally connect messaging channels. You can always do this later in Settings.
							</p>

							<div>
								<h3 className="text-sm font-medium text-foreground/80 mb-2">Telegram Bot</h3>
								<Input
									type="password"
									value={telegramToken}
									onChange={(e) => setTelegramToken(e.target.value)}
									placeholder="Bot token from @BotFather"
									className="rounded-xl"
								/>
							</div>

							<div>
								<h3 className="text-sm font-medium text-foreground/80 mb-2">Slack Bot</h3>
								<div className="space-y-3">
									<Input
										type="password"
										value={slackBotToken}
										onChange={(e) => setSlackBotToken(e.target.value)}
										placeholder="Bot token (xoxb-...)"
										className="rounded-xl"
									/>
									<Input
										type="password"
										value={slackAppToken}
										onChange={(e) => setSlackAppToken(e.target.value)}
										placeholder="App token (xapp-...)"
										className="rounded-xl"
									/>
								</div>
							</div>

							{error && <p className="text-red-400 text-sm">{error}</p>}

							<Button
								onClick={saveChannelConfig}
								disabled={saving || (!telegramToken && !slackBotToken)}
								className="w-full rounded-xl"
							>
								{saving ? "Saving..." : "Save & Continue"}
							</Button>

							<div className="flex justify-between mt-8">
								<Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl">
									上一步
								</Button>
							</div>
						</div>
					)}

					{/* Step 3: Ready */}
					{step === 3 && (
						<div className="text-center space-y-6 animate-fade-in-up">
							<div className="text-5xl">🎉</div>
							<h2 className="text-2xl font-bold">配置完成！</h2>
							<p className="text-muted-foreground">一切就绪，开始使用 YanClaw</p>
							<Button size="lg" onClick={() => navigate("/")} className="rounded-xl">
								进入应用
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
