import { useEffect, useState } from "react";
import { API_BASE, apiFetch } from "../lib/api";

type ProviderType = "anthropic" | "openai" | "google" | "ollama" | "openai-compatible";

interface ProviderEntry {
	name: string;
	type: ProviderType;
	apiKey: string;
	baseUrl: string;
}

const PROVIDER_TYPES: Array<{ value: ProviderType; label: string }> = [
	{ value: "anthropic", label: "Anthropic" },
	{ value: "openai", label: "OpenAI" },
	{ value: "google", label: "Google" },
	{ value: "ollama", label: "Ollama" },
	{ value: "openai-compatible", label: "OpenAI Compatible" },
];

const DEFAULT_BASE_URLS: Partial<Record<string, string>> = {
	ollama: "http://localhost:11434/v1",
	deepseek: "https://api.deepseek.com/v1",
	mistral: "https://api.mistral.ai/v1",
	volcengine: "https://ark.cn-beijing.volces.com/api/v3",
};

interface SystemModelsConfig {
	chatDefault: string;
	chatFast: string;
	chatQuality: string;
	chatCheap: string;
	vision: string;
	embedding: string;
	stt: string;
}

const inputCls =
	"w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring";
const labelCls = "block text-sm text-muted-foreground mb-1";

export function Settings() {
	const [providers, setProviders] = useState<ProviderEntry[]>([]);
	const [systemModels, setSystemModels] = useState<SystemModelsConfig>({
		chatDefault: "",
		chatFast: "",
		chatQuality: "",
		chatCheap: "",
		vision: "",
		embedding: "",
		stt: "",
	});
	const [port, setPort] = useState(18789);
	const [model, setModel] = useState("claude-sonnet-4-20250514");
	const [systemPrompt, setSystemPrompt] = useState("");
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

	useEffect(() => {
		apiFetch(`${API_BASE}/api/config`)
			.then((r) => r.json())
			.then((config: Record<string, unknown>) => {
				const gw = config.gateway as { port?: number } | undefined;
				if (gw?.port) setPort(gw.port);

				const agents = config.agents as { model?: string; systemPrompt?: string }[] | undefined;
				if (agents?.[0]) {
					if (agents[0].model) setModel(agents[0].model);
					if (agents[0].systemPrompt) setSystemPrompt(agents[0].systemPrompt);
				}

				// Load providers
				const models = config.models as {
					providers?: Record<
						string,
						{ type: ProviderType; profiles?: { apiKey: string }[]; baseUrl?: string }
					>;
				};
				if (models?.providers) {
					const entries: ProviderEntry[] = [];
					for (const [name, prov] of Object.entries(models.providers)) {
						entries.push({
							name,
							type: prov.type,
							apiKey: prov.profiles?.[0]?.apiKey ?? "",
							baseUrl: prov.baseUrl ?? "",
						});
					}
					if (entries.length > 0) setProviders(entries);
				}

				// Load systemModels
				const sm = config.systemModels as Record<string, unknown> | undefined;
				if (sm) {
					const chat = sm.chat;
					if (typeof chat === "string") {
						setSystemModels((prev) => ({ ...prev, chatDefault: chat }));
					} else if (chat && typeof chat === "object") {
						const c = chat as Record<string, string>;
						setSystemModels((prev) => ({
							...prev,
							chatDefault: c.default ?? "",
							chatFast: c.fast ?? "",
							chatQuality: c.quality ?? "",
							chatCheap: c.cheap ?? "",
						}));
					}
					if (typeof sm.vision === "string")
						setSystemModels((prev) => ({ ...prev, vision: sm.vision as string }));
					if (typeof sm.embedding === "string")
						setSystemModels((prev) => ({ ...prev, embedding: sm.embedding as string }));
					if (typeof sm.stt === "string")
						setSystemModels((prev) => ({ ...prev, stt: sm.stt as string }));
				}
			})
			.catch(() => {});
	}, []);

	const addProvider = () => {
		setProviders((prev) => [
			...prev,
			{ name: "", type: "openai-compatible", apiKey: "", baseUrl: "" },
		]);
	};

	const removeProvider = (idx: number) => {
		setProviders((prev) => prev.filter((_, i) => i !== idx));
	};

	const updateProvider = (idx: number, field: keyof ProviderEntry, value: string) => {
		setProviders((prev) => {
			const next = [...prev];
			next[idx] = { ...next[idx], [field]: value };
			// Auto-fill baseUrl for known providers
			if (field === "name" && DEFAULT_BASE_URLS[value] && !next[idx].baseUrl) {
				next[idx].baseUrl = DEFAULT_BASE_URLS[value];
			}
			return next;
		});
	};

	const handleSave = async () => {
		setSaving(true);
		setStatus("idle");

		try {
			const patch: Record<string, unknown> = {};

			// Build providers config
			const providersConfig: Record<string, unknown> = {};
			for (const p of providers) {
				if (!p.name) continue;
				const entry: Record<string, unknown> = { type: p.type };
				if (p.apiKey) {
					entry.profiles = [{ id: "default", apiKey: p.apiKey }];
				}
				if (p.baseUrl) {
					entry.baseUrl = p.baseUrl;
				}
				providersConfig[p.name] = entry;
			}
			patch.models = { providers: providersConfig };

			// Build systemModels config
			const sm: Record<string, unknown> = {};
			const chatObj: Record<string, string> = {};
			if (systemModels.chatDefault) chatObj.default = systemModels.chatDefault;
			if (systemModels.chatFast) chatObj.fast = systemModels.chatFast;
			if (systemModels.chatQuality) chatObj.quality = systemModels.chatQuality;
			if (systemModels.chatCheap) chatObj.cheap = systemModels.chatCheap;
			if (Object.keys(chatObj).length === 1 && chatObj.default) {
				sm.chat = chatObj.default; // string shorthand
			} else if (Object.keys(chatObj).length > 0) {
				sm.chat = chatObj;
			}
			if (systemModels.vision) sm.vision = systemModels.vision;
			if (systemModels.embedding) sm.embedding = systemModels.embedding;
			if (systemModels.stt) sm.stt = systemModels.stt;
			patch.systemModels = sm;

			// Gateway config
			if (port !== 18789) {
				patch.gateway = { port };
			}

			// Agent config
			patch.agents = [
				{
					id: "main",
					name: "\u9ED8\u8BA4\u52A9\u624B",
					model,
					systemPrompt: systemPrompt || "You are a helpful assistant.",
				},
			];

			const res = await apiFetch(`${API_BASE}/api/config`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});

			if (res.ok) {
				setStatus("saved");
				setTimeout(() => setStatus("idle"), 2000);
			} else {
				setStatus("error");
			}
		} catch {
			setStatus("error");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="p-6 overflow-y-auto h-full">
			<h2 className="text-lg font-semibold mb-6">Settings</h2>
			<div className="space-y-8 max-w-2xl">
				{/* Providers */}
				<section>
					<div className="flex items-center justify-between mb-3">
						<h3 className="text-sm font-medium text-foreground/80">Model Providers</h3>
						<button
							type="button"
							onClick={addProvider}
							className="text-xs text-primary hover:text-primary/80 transition-colors"
						>
							+ Add Provider
						</button>
					</div>
					<div className="space-y-4">
						{providers.map((p, idx) => (
							<div key={idx} className="border border-border rounded-lg p-4 space-y-3">
								<div className="flex items-center gap-3">
									<div className="flex-1">
										<label className={labelCls}>Name</label>
										<input
											type="text"
											value={p.name}
											onChange={(e) => updateProvider(idx, "name", e.target.value)}
											placeholder="anthropic, deepseek, my-proxy..."
											className={inputCls}
										/>
									</div>
									<div className="flex-1">
										<label className={labelCls}>Type</label>
										<select
											value={p.type}
											onChange={(e) => updateProvider(idx, "type", e.target.value)}
											className={inputCls}
										>
											{PROVIDER_TYPES.map((t) => (
												<option key={t.value} value={t.value}>
													{t.label}
												</option>
											))}
										</select>
									</div>
									<button
										type="button"
										onClick={() => removeProvider(idx)}
										className="text-muted-foreground hover:text-red-400 text-lg mt-5 transition-colors"
										title="Remove provider"
									>
										&times;
									</button>
								</div>
								{p.type !== "ollama" && (
									<div>
										<label className={labelCls}>API Key</label>
										<input
											type="password"
											value={p.apiKey}
											onChange={(e) => updateProvider(idx, "apiKey", e.target.value)}
											placeholder="API key"
											className={inputCls}
										/>
									</div>
								)}
								{(p.type === "openai-compatible" || p.type === "ollama") && (
									<div>
										<label className={labelCls}>Base URL</label>
										<input
											type="text"
											value={p.baseUrl}
											onChange={(e) => updateProvider(idx, "baseUrl", e.target.value)}
											placeholder={
												p.type === "ollama"
													? "http://localhost:11434/v1"
													: "https://api.example.com/v1"
											}
											className={inputCls}
										/>
									</div>
								)}
							</div>
						))}
						{providers.length === 0 && (
							<p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-lg">
								No providers configured. Click "Add Provider" to get started.
							</p>
						)}
					</div>
				</section>

				{/* System Models */}
				<section>
					<h3 className="text-sm font-medium text-foreground/80 mb-3">
						System Models
						<span className="text-muted-foreground font-normal ml-1">
							(scene &times; preference)
						</span>
					</h3>
					<div className="space-y-4">
						<div className="border border-border rounded-lg p-4 space-y-3">
							<h4 className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
								Chat
							</h4>
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className={labelCls}>Default</label>
									<input
										type="text"
										value={systemModels.chatDefault}
										onChange={(e) =>
											setSystemModels((prev) => ({ ...prev, chatDefault: e.target.value }))
										}
										placeholder="claude-sonnet-4-20250514"
										className={inputCls}
									/>
								</div>
								<div>
									<label className={labelCls}>Fast</label>
									<input
										type="text"
										value={systemModels.chatFast}
										onChange={(e) =>
											setSystemModels((prev) => ({ ...prev, chatFast: e.target.value }))
										}
										placeholder="(optional)"
										className={inputCls}
									/>
								</div>
								<div>
									<label className={labelCls}>Quality</label>
									<input
										type="text"
										value={systemModels.chatQuality}
										onChange={(e) =>
											setSystemModels((prev) => ({ ...prev, chatQuality: e.target.value }))
										}
										placeholder="(optional)"
										className={inputCls}
									/>
								</div>
								<div>
									<label className={labelCls}>Cheap</label>
									<input
										type="text"
										value={systemModels.chatCheap}
										onChange={(e) =>
											setSystemModels((prev) => ({ ...prev, chatCheap: e.target.value }))
										}
										placeholder="(optional)"
										className={inputCls}
									/>
								</div>
							</div>
						</div>

						<div className="grid grid-cols-3 gap-3">
							<div>
								<label className={labelCls}>Vision</label>
								<input
									type="text"
									value={systemModels.vision}
									onChange={(e) => setSystemModels((prev) => ({ ...prev, vision: e.target.value }))}
									placeholder="(falls back to chat)"
									className={inputCls}
								/>
							</div>
							<div>
								<label className={labelCls}>Embedding</label>
								<input
									type="text"
									value={systemModels.embedding}
									onChange={(e) =>
										setSystemModels((prev) => ({ ...prev, embedding: e.target.value }))
									}
									placeholder="text-embedding-3-small"
									className={inputCls}
								/>
							</div>
							<div>
								<label className={labelCls}>STT</label>
								<input
									type="text"
									value={systemModels.stt}
									onChange={(e) => setSystemModels((prev) => ({ ...prev, stt: e.target.value }))}
									placeholder="whisper-1"
									className={inputCls}
								/>
							</div>
						</div>
					</div>
				</section>

				{/* Default Agent */}
				<section>
					<h3 className="text-sm font-medium text-foreground/80 mb-3">Default Agent</h3>
					<div className="space-y-4">
						<div>
							<label className={labelCls}>Model ID</label>
							<input
								type="text"
								value={model}
								onChange={(e) => setModel(e.target.value)}
								placeholder="claude-sonnet-4-20250514"
								className={inputCls}
							/>
							<p className="text-xs text-muted-foreground mt-1">
								Fallback model when systemModels is not configured.
							</p>
						</div>
						<div>
							<label className={labelCls}>System Prompt</label>
							<textarea
								value={systemPrompt}
								onChange={(e) => setSystemPrompt(e.target.value)}
								placeholder="You are a helpful assistant."
								rows={4}
								className={`${inputCls} resize-y`}
							/>
						</div>
					</div>
				</section>

				{/* Gateway */}
				<section>
					<h3 className="text-sm font-medium text-foreground/80 mb-3">Gateway</h3>
					<div>
						<label className={labelCls}>Port</label>
						<input
							type="number"
							value={port}
							onChange={(e) => setPort(Number(e.target.value))}
							className={inputCls}
						/>
					</div>
				</section>

				<div className="flex items-center gap-4">
					<button
						type="button"
						onClick={handleSave}
						disabled={saving}
						className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-foreground px-6 py-2 rounded-lg transition-colors"
					>
						{saving ? "Saving..." : "Save Settings"}
					</button>

					{status === "saved" && (
						<span className="text-green-400 text-sm">Settings saved successfully.</span>
					)}
					{status === "error" && (
						<span className="text-red-400 text-sm">Failed to save settings.</span>
					)}
				</div>
			</div>
		</div>
	);
}
