import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiFetch } from "../lib/api";

const STEPS = ["Model Setup", "Channels", "Ready"] as const;

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
			setStep(1);
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

			setStep(2);
		} catch {
			setError("Failed to save channel configuration.");
		} finally {
			setSaving(false);
		}
	}, [telegramToken, slackBotToken, slackAppToken]);

	const canContinue = providerDef.needsApiKey ? !!apiKey && !!finalModel : !!finalModel;

	return (
		<div className="flex items-center justify-center h-full">
			<div className="w-full max-w-lg p-8">
				{/* Progress */}
				<div className="flex items-center gap-2 mb-8">
					{STEPS.map((label, i) => (
						<div key={label} className="flex items-center gap-2 flex-1">
							<div
								className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium shrink-0 ${
									i < step
										? "bg-green-600 text-foreground"
										: i === step
											? "bg-primary text-foreground"
											: "bg-accent text-muted-foreground"
								}`}
							>
								{i < step ? "\u2713" : i + 1}
							</div>
							<span
								className={`text-sm truncate ${i === step ? "text-foreground" : "text-muted-foreground"}`}
							>
								{label}
							</span>
							{i < STEPS.length - 1 && <div className="flex-1 h-px bg-accent min-w-4" />}
						</div>
					))}
				</div>

				{/* Step 0: Model Setup */}
				{step === 0 && (
					<div className="space-y-6">
						<div>
							<h2 className="text-xl font-semibold text-foreground mb-1">Welcome to YanClaw</h2>
							<p className="text-muted-foreground text-sm">
								Choose your AI model provider and enter your API key.
							</p>
						</div>

						<div>
							<label className="block text-sm text-foreground/80 mb-2">Provider</label>
							<div className="grid grid-cols-4 gap-2">
								{PROVIDERS.map((p) => (
									<button
										key={p.id}
										type="button"
										onClick={() => selectProvider(p)}
										className={`py-2.5 rounded-lg border text-xs font-medium transition-colors ${
											providerId === p.id
												? "border-primary bg-primary/10 text-primary"
												: "border-border text-muted-foreground hover:border-border hover:bg-muted"
										}`}
									>
										{p.label}
									</button>
								))}
							</div>
						</div>

						{providerDef.needsApiKey && (
							<div>
								<label className="block text-sm text-foreground/80 mb-1">API Key</label>
								<input
									type="password"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									placeholder={providerDef.placeholder ?? "API key"}
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
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
								<input
									type="text"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									placeholder={providerDef.defaultBaseUrl ?? "https://api.example.com/v1"}
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
						)}

						<div>
							<label className="block text-sm text-foreground/80 mb-1">Default Model</label>
							{hasPresetModels ? (
								<select
									value={model}
									onChange={(e) => setModel(e.target.value)}
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
								>
									{providerDef.models.map((opt) => (
										<option key={opt.value} value={opt.value}>
											{opt.label}
										</option>
									))}
								</select>
							) : (
								<input
									type="text"
									value={customModel}
									onChange={(e) => setCustomModel(e.target.value)}
									placeholder={
										providerDef.type === "ollama" ? "llama3.3, qwen3:32b, ..." : "model-name"
									}
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
								/>
							)}
						</div>

						{error && <p className="text-red-400 text-sm">{error}</p>}

						<button
							type="button"
							onClick={saveModelConfig}
							disabled={!canContinue || saving}
							className="w-full bg-primary hover:bg-primary/90 disabled:opacity-50 text-foreground py-2.5 rounded-lg transition-colors font-medium"
						>
							{saving ? "Saving..." : "Continue"}
						</button>
					</div>
				)}

				{/* Step 1: Channels (optional) */}
				{step === 1 && (
					<div className="space-y-6">
						<div>
							<h2 className="text-xl font-semibold text-foreground mb-1">Connect Channels</h2>
							<p className="text-muted-foreground text-sm">
								Optionally connect messaging channels. You can always do this later in Settings.
							</p>
						</div>

						<div>
							<h3 className="text-sm font-medium text-foreground/80 mb-2">Telegram Bot</h3>
							<input
								type="password"
								value={telegramToken}
								onChange={(e) => setTelegramToken(e.target.value)}
								placeholder="Bot token from @BotFather"
								className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>

						<div>
							<h3 className="text-sm font-medium text-foreground/80 mb-2">Slack Bot</h3>
							<div className="space-y-3">
								<input
									type="password"
									value={slackBotToken}
									onChange={(e) => setSlackBotToken(e.target.value)}
									placeholder="Bot token (xoxb-...)"
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
								/>
								<input
									type="password"
									value={slackAppToken}
									onChange={(e) => setSlackAppToken(e.target.value)}
									placeholder="App token (xapp-...)"
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>
						</div>

						{error && <p className="text-red-400 text-sm">{error}</p>}

						<div className="flex gap-3">
							<button
								type="button"
								onClick={() => setStep(2)}
								className="flex-1 border border-border text-foreground/80 hover:bg-muted py-2.5 rounded-lg transition-colors font-medium"
							>
								Skip
							</button>
							<button
								type="button"
								onClick={saveChannelConfig}
								disabled={saving || (!telegramToken && !slackBotToken)}
								className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-50 text-foreground py-2.5 rounded-lg transition-colors font-medium"
							>
								{saving ? "Saving..." : "Save & Continue"}
							</button>
						</div>
					</div>
				)}

				{/* Step 2: Ready */}
				{step === 2 && (
					<div className="space-y-6 text-center">
						<div className="text-5xl">&#127881;</div>
						<div>
							<h2 className="text-xl font-semibold text-foreground mb-2">You're All Set!</h2>
							<p className="text-muted-foreground text-sm">
								YanClaw is ready to use. Start a conversation or explore the settings to customize
								further.
							</p>
						</div>

						<button
							type="button"
							onClick={() => navigate("/")}
							className="w-full bg-primary hover:bg-primary/90 text-foreground py-2.5 rounded-lg transition-colors font-medium"
						>
							Start Chatting
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
