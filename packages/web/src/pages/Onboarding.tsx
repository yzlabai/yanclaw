import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiFetch } from "../lib/api";

const STEPS = ["Model Setup", "Channels", "Ready"] as const;

type Provider = "anthropic" | "openai" | "google";

export function Onboarding() {
	const navigate = useNavigate();
	const [step, setStep] = useState(0);
	const [provider, setProvider] = useState<Provider>("anthropic");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("claude-sonnet-4-20250514");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	// Channel setup (optional)
	const [telegramToken, setTelegramToken] = useState("");
	const [slackBotToken, setSlackBotToken] = useState("");
	const [slackAppToken, setSlackAppToken] = useState("");

	const saveModelConfig = useCallback(async () => {
		setSaving(true);
		setError("");
		try {
			const providers: Record<string, unknown> = {};
			providers[provider] = {
				type: provider,
				profiles: [{ id: "default", apiKey }],
			};

			const patch: Record<string, unknown> = {
				models: { providers },
				agents: [
					{
						id: "main",
						name: "默认助手",
						model,
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
	}, [provider, apiKey, model]);

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

	const modelOptions =
		provider === "anthropic"
			? [
					{ value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
					{ value: "claude-opus-4-20250514", label: "Claude Opus 4" },
					{ value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
				]
			: provider === "google"
				? [
						{ value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro" },
						{ value: "gemini-2.5-flash-preview-04-17", label: "Gemini 2.5 Flash" },
						{ value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
					]
				: [
						{ value: "gpt-4o", label: "GPT-4o" },
						{ value: "gpt-4o-mini", label: "GPT-4o Mini" },
						{ value: "o3-mini", label: "o3-mini" },
					];

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
								Let's get you started. First, choose your AI model provider and enter your API key.
							</p>
						</div>

						<div>
							<label className="block text-sm text-foreground/80 mb-2">Provider</label>
							<div className="flex gap-3">
								<button
									type="button"
									onClick={() => {
										setProvider("anthropic");
										setModel("claude-sonnet-4-20250514");
									}}
									className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-colors ${
										provider === "anthropic"
											? "border-primary bg-primary/10 text-primary"
											: "border-border text-muted-foreground hover:border-border"
									}`}
								>
									Anthropic
								</button>
								<button
									type="button"
									onClick={() => {
										setProvider("openai");
										setModel("gpt-4o");
									}}
									className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-colors ${
										provider === "openai"
											? "border-primary bg-primary/10 text-primary"
											: "border-border text-muted-foreground hover:border-border"
									}`}
								>
									OpenAI
								</button>
								<button
									type="button"
									onClick={() => {
										setProvider("google");
										setModel("gemini-2.5-flash-preview-04-17");
									}}
									className={`flex-1 py-3 rounded-lg border text-sm font-medium transition-colors ${
										provider === "google"
											? "border-primary bg-primary/10 text-primary"
											: "border-border text-muted-foreground hover:border-border"
									}`}
								>
									Google
								</button>
							</div>
						</div>

						<div>
							<label className="block text-sm text-foreground/80 mb-1">API Key</label>
							<input
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder={
									provider === "anthropic"
										? "sk-ant-..."
										: provider === "google"
											? "AIza..."
											: "sk-..."
								}
								className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>

						<div>
							<label className="block text-sm text-foreground/80 mb-1">Default Model</label>
							<select
								value={model}
								onChange={(e) => setModel(e.target.value)}
								className="w-full bg-muted rounded-lg px-4 py-2 text-foreground outline-none focus:ring-2 focus:ring-ring"
							>
								{modelOptions.map((opt) => (
									<option key={opt.value} value={opt.value}>
										{opt.label}
									</option>
								))}
							</select>
						</div>

						{error && <p className="text-red-400 text-sm">{error}</p>}

						<button
							type="button"
							onClick={saveModelConfig}
							disabled={!apiKey || saving}
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
