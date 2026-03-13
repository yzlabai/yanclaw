import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LanguageToggle } from "../components/language-toggle";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Skeleton } from "../components/ui/skeleton";
import { useI18n } from "../i18n";
import { API_BASE, apiFetch } from "../lib/api";

interface ProviderOption {
	id: string;
	type: "anthropic" | "openai" | "google" | "ollama" | "openai-compatible";
	needsApiKey: boolean;
	needsBaseUrl: boolean;
	defaultBaseUrl?: string;
	placeholder?: string;
}

const PROVIDERS: ProviderOption[] = [
	{
		id: "anthropic",
		type: "anthropic",
		needsApiKey: true,
		needsBaseUrl: false,
		placeholder: "sk-ant-...",
	},
	{
		id: "openai",
		type: "openai",
		needsApiKey: true,
		needsBaseUrl: false,
		placeholder: "sk-...",
	},
	{
		id: "google",
		type: "google",
		needsApiKey: true,
		needsBaseUrl: false,
		placeholder: "AIza...",
	},
	{
		id: "deepseek",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://api.deepseek.com/v1",
		placeholder: "sk-...",
	},
	{
		id: "mistral",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://api.mistral.ai/v1",
		placeholder: "...",
	},
	{
		id: "volcengine",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: false,
		defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
		placeholder: "...",
	},
	{
		id: "ollama",
		type: "ollama",
		needsApiKey: false,
		needsBaseUrl: true,
		defaultBaseUrl: "http://localhost:11434/v1",
	},
	{
		id: "custom",
		type: "openai-compatible",
		needsApiKey: true,
		needsBaseUrl: true,
		placeholder: "sk-...",
	},
];

// Provider brand colors for the card accents
const PROVIDER_COLORS: Record<string, string> = {
	anthropic: "#D4A27F",
	openai: "#10A37F",
	google: "#4285F4",
	deepseek: "#4D6BFE",
	mistral: "#F7D046",
	volcengine: "#3370FF",
	ollama: "#FFFFFF",
	custom: "#9CA3AF",
};

const PROVIDER_PATHS: Record<string, string> = {
	anthropic:
		"M13.827 3.52h3.603L24 20.48h-3.603l-6.57-16.96zm-7.258 0h3.767L16.906 20.48h-3.674l-1.636-4.247H5.036l-1.631 4.247H0L6.569 3.52zm1.901 5.476-2.412 6.251h4.834l-2.422-6.251z",
	openai:
		"M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.992 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.612-1.5z",
	google:
		"M12 24c6.627 0 12-5.373 12-12S18.627 0 12 0 0 5.373 0 12s5.373 12 12 12zm-1.243-5.217L8.3 14.626l-2.449 4.157H3.934l3.6-5.985-3.4-5.664h1.917l2.249 3.907 2.419-3.907h1.873l-3.37 5.478 3.6 6.171h-1.965zm4.476 0h-1.66V7.134h1.66v11.649zm3.76 0h-1.66V7.134h1.66v11.649z",
	deepseek:
		"M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm3.2 7.2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8zM8.8 7.2a2.4 2.4 0 1 1 0 4.8 2.4 2.4 0 0 1 0-4.8zm3.2 12a6 6 0 0 1-5.196-3h10.392A6 6 0 0 1 12 19.2z",
	mistral:
		"M3 3h4.5v4.5H3V3zm13.5 0H21v4.5h-4.5V3zM3 7.5h4.5V12H3V7.5zm4.5 0h4.5V12H7.5V7.5zm4.5 0h4.5V12H12V7.5zm4.5 0H21V12h-4.5V7.5zM3 12h4.5v4.5H3V12zm9 0h4.5v4.5H12V12zm4.5 0H21v4.5h-4.5V12zM3 16.5h4.5V21H3v-4.5zm4.5 0h4.5V21H7.5v-4.5zm9 0H21V21h-4.5v-4.5z",
	volcengine: "M5 4l7 16L19 4H5zm7 3.5L15.5 16h-7L12 7.5z",
	ollama:
		"M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 3a3.5 3.5 0 0 1 3.5 3.5c0 1.12-.527 2.117-1.347 2.757.5.308.847.856.847 1.493v2.5a1.75 1.75 0 0 1-3.5 0v-2.5c0-.637.347-1.185.847-1.493A3.498 3.498 0 0 1 8.5 8.5 3.5 3.5 0 0 1 12 5z",
	custom:
		"M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm0 14a8 8 0 0 1-6.93-4c.036-2.3 4.62-3.56 6.93-3.56S18.964 12.7 19 15a8 8 0 0 1-7 4z",
};

function ProviderIcon({ id, className }: { id: string; className?: string }) {
	const size = className ?? "h-8 w-8";
	const d = PROVIDER_PATHS[id] ?? PROVIDER_PATHS.custom;
	return (
		<svg viewBox="0 0 24 24" className={size} fill="currentColor" role="img" aria-label={id}>
			<title>{id}</title>
			<path d={d} />
		</svg>
	);
}

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
	const { t } = useI18n();
	const [step, setStep] = useState(0);
	const [providerId, setProviderId] = useState("anthropic");
	const [apiKey, setApiKey] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [model, setModel] = useState("");
	const [customModel, setCustomModel] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	// Model fetching state
	const [availableModels, setAvailableModels] = useState<Array<{ id: string; name: string }>>([]);
	const [loadingModels, setLoadingModels] = useState(false);
	const [modelError, setModelError] = useState("");
	const [manualInput, setManualInput] = useState(false);

	// Channel setup (optional)
	const [telegramToken, setTelegramToken] = useState("");
	const [slackBotToken, setSlackBotToken] = useState("");
	const [slackAppToken, setSlackAppToken] = useState("");

	const providerDef = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0];
	const finalModel = manualInput || availableModels.length === 0 ? customModel : model;

	const fetchModels = useCallback(async () => {
		setLoadingModels(true);
		setModelError("");
		try {
			const provider = PROVIDERS.find((p) => p.id === providerId) ?? PROVIDERS[0];
			const res = await apiFetch(`${API_BASE}/api/models/list`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					providerType: provider.type,
					apiKey: apiKey,
					baseUrl: baseUrl || provider.defaultBaseUrl,
				}),
			});
			const data = (await res.json()) as {
				models: Array<{ id: string; name: string }>;
				error?: string;
			};
			if (data.error) {
				setModelError(data.error);
				setAvailableModels([]);
			} else {
				setAvailableModels(data.models);
				if (data.models.length > 0) {
					setModel(data.models[0].id);
				}
			}
		} catch {
			setModelError(t("onboarding.model.fetchFailed"));
			setAvailableModels([]);
		} finally {
			setLoadingModels(false);
		}
	}, [providerId, apiKey, baseUrl, t]);

	const selectProvider = useCallback((p: ProviderOption) => {
		setProviderId(p.id);
		setApiKey("");
		setBaseUrl(p.defaultBaseUrl ?? "");
		setModel("");
		setCustomModel("");
		setAvailableModels([]);
		setModelError("");
		setManualInput(false);
	}, []);

	// Auto-fetch models for Ollama (no API key needed)
	useEffect(() => {
		if (providerDef.type === "ollama" && !providerDef.needsApiKey) {
			fetchModels();
		}
	}, [providerDef.type, providerDef.needsApiKey, fetchModels]);

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
						name: "默认助手",
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
			const channels: unknown[] = [];

			if (telegramToken) {
				channels.push({
					type: "telegram",
					enabled: true,
					accounts: [{ id: "default", token: telegramToken, dmPolicy: "allowlist" }],
				});
			}

			if (slackBotToken && slackAppToken) {
				channels.push({
					type: "slack",
					enabled: true,
					accounts: [
						{
							id: "default",
							botToken: slackBotToken,
							appToken: slackAppToken,
							dmPolicy: "allowlist",
						},
					],
				});
			}

			if (channels.length > 0) {
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
	const showFetchButton =
		availableModels.length === 0 && !loadingModels && !manualInput && !modelError;

	return (
		<div className="min-h-screen flex items-center justify-center bg-background p-4">
			<div className="w-full max-w-lg">
				{/* Language toggle in top-right corner */}
				<div className="flex justify-end mb-2">
					<LanguageToggle />
				</div>

				<StepIndicator current={step} total={4} />
				<div className="bg-card rounded-2xl shadow-warm p-8 border border-border">
					{/* Step 0: Welcome */}
					{step === 0 && (
						<div className="text-center space-y-6 animate-fade-in-up">
							<h2 className="text-3xl font-bold">{t("onboarding.welcome.title")}</h2>
							<p className="text-muted-foreground text-lg">{t("onboarding.welcome.subtitle")}</p>
							<Button size="lg" onClick={() => setStep(1)} className="rounded-xl">
								{t("onboarding.welcome.start")}
							</Button>
						</div>
					)}

					{/* Step 1: Model Setup */}
					{step === 1 && (
						<div className="space-y-6 animate-fade-in-up">
							<div>
								<h2 className="text-xl font-bold mb-1">{t("onboarding.model.title")}</h2>
								<p className="text-muted-foreground text-sm">{t("onboarding.model.subtitle")}</p>
							</div>

							<div>
								<label className="block text-sm text-foreground/80 mb-2">
									{t("onboarding.model.providerLabel")}
								</label>
								<div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
									{PROVIDERS.map((p) => {
										const isSelected = providerId === p.id;
										const color = PROVIDER_COLORS[p.id] ?? "#9CA3AF";
										return (
											<button
												key={p.id}
												type="button"
												onClick={() => selectProvider(p)}
												className={`group relative flex flex-col items-center gap-2.5 p-4 rounded-2xl border-2 transition-all duration-200 ${
													isSelected
														? "border-primary bg-primary/10 shadow-warm"
														: "border-border hover:border-primary/50 hover:bg-muted/30"
												}`}
												style={
													isSelected
														? {
																borderColor: color,
																backgroundColor: `${color}10`,
															}
														: undefined
												}
											>
												<div
													className={`flex items-center justify-center w-10 h-10 rounded-xl transition-colors ${
														isSelected
															? "text-foreground"
															: "text-muted-foreground group-hover:text-foreground"
													}`}
													style={isSelected ? { color } : undefined}
												>
													<ProviderIcon id={p.id} />
												</div>
												<div className="text-center">
													<span className="text-sm font-medium block">
														{t(`providers.${p.id}.name`)}
													</span>
													<span className="text-[11px] text-muted-foreground leading-tight block mt-0.5">
														{t(`providers.${p.id}.description`)}
													</span>
												</div>
												{isSelected && (
													<div
														className="absolute top-2 right-2 w-2 h-2 rounded-full"
														style={{ backgroundColor: color }}
													/>
												)}
											</button>
										);
									})}
								</div>
							</div>

							{providerDef.needsApiKey && (
								<div>
									<label className="block text-sm text-foreground/80 mb-1">
										{t("onboarding.model.apiKeyLabel")}
									</label>
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
										{t("onboarding.model.baseUrlLabel")}
										{providerDef.defaultBaseUrl && !providerDef.needsBaseUrl && (
											<span className="text-muted-foreground font-normal ml-1">
												({t("common.optional")})
											</span>
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
								<div className="flex items-center justify-between mb-1">
									<label className="block text-sm text-foreground/80">
										{t("onboarding.model.defaultModelLabel")}
									</label>
									{(availableModels.length > 0 || modelError) && (
										<button
											type="button"
											onClick={() => setManualInput(!manualInput)}
											className="text-xs text-muted-foreground hover:text-foreground transition-colors"
										>
											{manualInput
												? t("onboarding.model.selectFromList")
												: t("onboarding.model.manualInput")}
										</button>
									)}
								</div>

								{/* Fetch models button */}
								{showFetchButton && (
									<Button
										variant="outline"
										onClick={fetchModels}
										disabled={providerDef.needsApiKey && !apiKey}
										className="w-full rounded-xl mb-2"
									>
										{t("onboarding.model.fetchModels")}
									</Button>
								)}

								{/* Loading state */}
								{loadingModels && <Skeleton className="h-10 w-full rounded-xl" />}

								{/* Model dropdown from API */}
								{!loadingModels && availableModels.length > 0 && !manualInput && (
									<select
										value={model}
										onChange={(e) => setModel(e.target.value)}
										className="w-full bg-muted rounded-xl px-4 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
									>
										{availableModels.map((opt) => (
											<option key={opt.id} value={opt.id}>
												{opt.name}
											</option>
										))}
									</select>
								)}

								{/* Error state */}
								{!loadingModels && modelError && !manualInput && (
									<div className="space-y-2">
										<p className="text-red-400 text-sm">{modelError}</p>
										<Button
											variant="outline"
											size="sm"
											onClick={() => setManualInput(true)}
											className="rounded-xl"
										>
											{t("onboarding.model.manualInputModelId")}
										</Button>
									</div>
								)}

								{/* Manual input mode */}
								{!loadingModels && manualInput && (
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
								{saving ? t("common.saving") : t("common.saveAndContinue")}
							</Button>

							<div className="flex justify-between mt-8">
								<Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl">
									{t("common.previous")}
								</Button>
							</div>
						</div>
					)}

					{/* Step 2: Channels (optional) */}
					{step === 2 && (
						<div className="space-y-6 animate-fade-in-up">
							<div className="flex items-center justify-between">
								<h2 className="text-xl font-bold">{t("onboarding.channels.title")}</h2>
								<button
									type="button"
									onClick={() => setStep(3)}
									className="text-sm text-muted-foreground hover:text-foreground transition-colors"
								>
									{t("common.skip")}
								</button>
							</div>
							<p className="text-muted-foreground text-sm">{t("onboarding.channels.subtitle")}</p>

							<div>
								<h3 className="text-sm font-medium text-foreground/80 mb-2">
									{t("onboarding.channels.telegramBot")}
								</h3>
								<Input
									type="password"
									value={telegramToken}
									onChange={(e) => setTelegramToken(e.target.value)}
									placeholder="Bot token from @BotFather"
									className="rounded-xl"
								/>
							</div>

							<div>
								<h3 className="text-sm font-medium text-foreground/80 mb-2">
									{t("onboarding.channels.slackBot")}
								</h3>
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
								{saving ? t("common.saving") : t("common.saveAndContinue")}
							</Button>

							<div className="flex justify-between mt-8">
								<Button variant="outline" onClick={() => setStep(step - 1)} className="rounded-xl">
									{t("common.previous")}
								</Button>
							</div>
						</div>
					)}

					{/* Step 3: Ready */}
					{step === 3 && (
						<div className="text-center space-y-6 animate-fade-in-up">
							<div className="text-5xl">🎉</div>
							<h2 className="text-2xl font-bold">{t("onboarding.complete.title")}</h2>
							<p className="text-muted-foreground">{t("onboarding.complete.subtitle")}</p>
							<Button size="lg" onClick={() => navigate("/")} className="rounded-xl">
								{t("common.enterApp")}
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
