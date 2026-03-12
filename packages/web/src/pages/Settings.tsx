import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
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

const selectCls =
	"w-full bg-muted rounded-xl px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring";
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
	const [saving, setSaving] = useState(false);
	const [testResults, setTestResults] = useState<
		Record<number, { ok: boolean; count?: number; error?: string } | "loading" | null>
	>({});

	useEffect(() => {
		apiFetch(`${API_BASE}/api/config`)
			.then((r) => r.json())
			.then((config: Record<string, unknown>) => {
				const gw = config.gateway as { port?: number } | undefined;
				if (gw?.port) setPort(gw.port);

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

	const testConnection = async (idx: number) => {
		const p = providers[idx];
		if (!p.name) return;
		setTestResults((prev) => ({ ...prev, [idx]: "loading" }));
		try {
			const res = await apiFetch(`${API_BASE}/api/models/list`, {
				method: "POST",
				body: JSON.stringify({
					providerType: p.type,
					apiKey: p.apiKey || undefined,
					baseUrl: p.baseUrl || undefined,
				}),
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				setTestResults((prev) => ({
					...prev,
					[idx]: { ok: false, error: (body as { error?: string }).error ?? `HTTP ${res.status}` },
				}));
				return;
			}
			const data = (await res.json()) as { models?: unknown[] };
			const count = Array.isArray(data.models) ? data.models.length : 0;
			setTestResults((prev) => ({ ...prev, [idx]: { ok: true, count } }));
		} catch (e) {
			setTestResults((prev) => ({
				...prev,
				[idx]: { ok: false, error: e instanceof Error ? e.message : "Connection failed" },
			}));
		}
	};

	const handleSave = async () => {
		setSaving(true);

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

			const res = await apiFetch(`${API_BASE}/api/config`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});

			if (res.ok) {
				toast.success("设置已保存");
			} else {
				toast.error("保存失败");
			}
		} catch {
			toast.error("保存失败");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="p-6 overflow-y-auto h-full max-w-4xl mx-auto animate-fade-in-up">
			<h2 className="text-lg font-semibold mb-6">设置</h2>

			<Tabs defaultValue="providers" className="w-full">
				<TabsList className="grid w-full grid-cols-3 rounded-xl">
					<TabsTrigger value="providers" className="rounded-xl">
						Providers
					</TabsTrigger>
					<TabsTrigger value="models" className="rounded-xl">
						Models
					</TabsTrigger>
					<TabsTrigger value="gateway" className="rounded-xl">
						Gateway
					</TabsTrigger>
				</TabsList>

				{/* Providers */}
				<TabsContent value="providers" className="mt-4">
					<div className="rounded-2xl shadow-warm border border-border p-6 space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-medium text-foreground/80">Model Providers</h3>
							<Button variant="ghost" size="sm" onClick={addProvider}>
								+ Add Provider
							</Button>
						</div>
						<div className="space-y-4">
							{providers.map((p, idx) => (
								<div key={idx} className="border border-border rounded-2xl p-4 space-y-3">
									<div className="flex items-center gap-3">
										<div className="flex-1">
											<label className={labelCls}>Name</label>
											<Input
												type="text"
												value={p.name}
												onChange={(e) => updateProvider(idx, "name", e.target.value)}
												placeholder="anthropic, deepseek, my-proxy..."
												className="rounded-xl"
											/>
										</div>
										<div className="flex-1">
											<label className={labelCls}>Type</label>
											<select
												value={p.type}
												onChange={(e) => updateProvider(idx, "type", e.target.value)}
												className={selectCls}
											>
												{PROVIDER_TYPES.map((t) => (
													<option key={t.value} value={t.value}>
														{t.label}
													</option>
												))}
											</select>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => removeProvider(idx)}
											className="text-muted-foreground hover:text-red-400 text-lg mt-5"
											title="Remove provider"
										>
											&times;
										</Button>
									</div>
									{p.type !== "ollama" && (
										<div>
											<label className={labelCls}>API Key</label>
											<Input
												type="password"
												value={p.apiKey}
												onChange={(e) => updateProvider(idx, "apiKey", e.target.value)}
												placeholder="API key"
												className="rounded-xl"
											/>
										</div>
									)}
									{(p.type === "openai-compatible" || p.type === "ollama") && (
										<div>
											<label className={labelCls}>Base URL</label>
											<Input
												type="text"
												value={p.baseUrl}
												onChange={(e) => updateProvider(idx, "baseUrl", e.target.value)}
												placeholder={
													p.type === "ollama"
														? "http://localhost:11434/v1"
														: "https://api.example.com/v1"
												}
												className="rounded-xl"
											/>
										</div>
									)}
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											className="rounded-xl text-xs"
											disabled={!p.name || testResults[idx] === "loading"}
											onClick={() => testConnection(idx)}
										>
											{testResults[idx] === "loading" ? "测试中..." : "测试连接"}
										</Button>
										{testResults[idx] && testResults[idx] !== "loading" && (
											<span
												className={`text-xs ${testResults[idx].ok ? "text-green-500" : "text-red-400"}`}
											>
												{testResults[idx].ok
													? `连接成功 (${testResults[idx].count} 个模型)`
													: testResults[idx].error}
											</span>
										)}
									</div>
								</div>
							))}
							{providers.length === 0 && (
								<p className="text-sm text-muted-foreground py-4 text-center border border-dashed border-border rounded-2xl">
									No providers configured. Click "Add Provider" to get started.
								</p>
							)}
						</div>
					</div>
				</TabsContent>

				{/* System Models */}
				<TabsContent value="models" className="mt-4">
					<div className="rounded-2xl shadow-warm border border-border p-6 space-y-4">
						<h3 className="text-sm font-medium text-foreground/80">
							System Models
							<span className="text-muted-foreground font-normal ml-1">
								(scene &times; preference)
							</span>
						</h3>
						<div className="space-y-4">
							<div className="border border-border rounded-2xl p-4 space-y-3">
								<h4 className="text-xs font-medium text-foreground/60 uppercase tracking-wide">
									Chat
								</h4>
								<div className="grid grid-cols-2 gap-3">
									<div>
										<label className={labelCls}>Default</label>
										<Input
											type="text"
											value={systemModels.chatDefault}
											onChange={(e) =>
												setSystemModels((prev) => ({
													...prev,
													chatDefault: e.target.value,
												}))
											}
											placeholder="claude-sonnet-4-20250514"
											className="rounded-xl"
										/>
									</div>
									<div>
										<label className={labelCls}>Fast</label>
										<Input
											type="text"
											value={systemModels.chatFast}
											onChange={(e) =>
												setSystemModels((prev) => ({
													...prev,
													chatFast: e.target.value,
												}))
											}
											placeholder="(optional)"
											className="rounded-xl"
										/>
									</div>
									<div>
										<label className={labelCls}>Quality</label>
										<Input
											type="text"
											value={systemModels.chatQuality}
											onChange={(e) =>
												setSystemModels((prev) => ({
													...prev,
													chatQuality: e.target.value,
												}))
											}
											placeholder="(optional)"
											className="rounded-xl"
										/>
									</div>
									<div>
										<label className={labelCls}>Cheap</label>
										<Input
											type="text"
											value={systemModels.chatCheap}
											onChange={(e) =>
												setSystemModels((prev) => ({
													...prev,
													chatCheap: e.target.value,
												}))
											}
											placeholder="(optional)"
											className="rounded-xl"
										/>
									</div>
								</div>
							</div>

							<div className="grid grid-cols-3 gap-3">
								<div>
									<label className={labelCls}>Vision</label>
									<Input
										type="text"
										value={systemModels.vision}
										onChange={(e) =>
											setSystemModels((prev) => ({
												...prev,
												vision: e.target.value,
											}))
										}
										placeholder="(falls back to chat)"
										className="rounded-xl"
									/>
								</div>
								<div>
									<label className={labelCls}>Embedding</label>
									<Input
										type="text"
										value={systemModels.embedding}
										onChange={(e) =>
											setSystemModels((prev) => ({
												...prev,
												embedding: e.target.value,
											}))
										}
										placeholder="text-embedding-3-small"
										className="rounded-xl"
									/>
								</div>
								<div>
									<label className={labelCls}>STT</label>
									<Input
										type="text"
										value={systemModels.stt}
										onChange={(e) =>
											setSystemModels((prev) => ({
												...prev,
												stt: e.target.value,
											}))
										}
										placeholder="whisper-1"
										className="rounded-xl"
									/>
								</div>
							</div>
						</div>
					</div>
				</TabsContent>

				{/* Gateway */}
				<TabsContent value="gateway" className="mt-4">
					<div className="rounded-2xl shadow-warm border border-border p-6 space-y-4">
						<h3 className="text-sm font-medium text-foreground/80">Gateway</h3>
						<div>
							<label className={labelCls}>Port</label>
							<Input
								type="number"
								value={port}
								onChange={(e) => setPort(Number(e.target.value))}
								className="rounded-xl"
							/>
						</div>
					</div>
				</TabsContent>
			</Tabs>

			<div className="mt-6">
				<Button onClick={handleSave} disabled={saving} className="rounded-xl">
					{saving ? "保存中..." : "保存设置"}
				</Button>
			</div>
		</div>
	);
}
