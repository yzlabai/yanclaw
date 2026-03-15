import {
	ArrowRight,
	Plus,
	Power,
	PowerOff,
	RefreshCw,
	Route,
	Search,
	Trash2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../components/ui/select";
import { useI18n } from "../i18n";
import { API_BASE, apiFetch } from "../lib/api";

interface ChannelInfo {
	type: string;
	accountId: string;
	enabled: boolean;
	status: "connected" | "disconnected" | "connecting" | "error";
}

interface ChannelType {
	type: string;
	requiredFields: string[];
}

interface Binding {
	channel?: string;
	account?: string;
	peer?: string;
	guild?: string;
	roles?: string[];
	team?: string;
	group?: string;
	agent: string;
	dmScope?: string;
	priority?: number;
	preference?: string;
}

interface AgentInfo {
	id: string;
	name: string;
	model?: string;
}

interface RoutingConfig {
	default: string;
	dmScope: string;
	bindings: Binding[];
	identityLinks: Record<string, string[]>;
}

const CHANNEL_ICONS: Record<string, string> = {
	telegram: "✈",
	discord: "🎮",
	slack: "💬",
	feishu: "🪶",
	webchat: "🌐",
};

const FIELD_LABELS: Record<string, string> = {
	token: "Token",
	botToken: "Bot Token",
	appToken: "App Token",
	appId: "App ID",
	appSecret: "App Secret",
};

const statusBadge = (status: string) => {
	switch (status) {
		case "connected":
			return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">在线</Badge>;
		case "connecting":
			return (
				<Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">连接中</Badge>
			);
		case "error":
			return <Badge variant="destructive">错误</Badge>;
		default:
			return <Badge variant="secondary">离线</Badge>;
	}
};

// --- Routing hooks & components ---

function useRouting() {
	const [routing, setRouting] = useState<RoutingConfig | null>(null);
	const [bindings, setBindings] = useState<Binding[]>([]);
	const [agents, setAgents] = useState<AgentInfo[]>([]);

	const fetchRouting = useCallback(() => {
		apiFetch(`${API_BASE}/api/routing`)
			.then((r) => r.json())
			.then((data: RoutingConfig) => {
				setRouting(data);
				setBindings(data.bindings ?? []);
			})
			.catch(() => {});
	}, []);

	const fetchAgents = useCallback(() => {
		apiFetch(`${API_BASE}/api/agents`)
			.then((r) => r.json())
			.then((data: AgentInfo[]) => setAgents(data))
			.catch(() => {});
	}, []);

	useEffect(() => {
		fetchRouting();
		fetchAgents();
	}, [fetchRouting, fetchAgents]);

	const addBinding = async (binding: Omit<Binding, "priority">) => {
		const res = await apiFetch(`${API_BASE}/api/routing/bindings`, {
			method: "POST",
			body: JSON.stringify(binding),
		});
		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			throw new Error(body.error ?? `Failed: ${res.status}`);
		}
		fetchRouting();
	};

	const removeBinding = async (index: number) => {
		await apiFetch(`${API_BASE}/api/routing/bindings/${index}`, { method: "DELETE" });
		fetchRouting();
	};

	return { routing, bindings, agents, addBinding, removeBinding, fetchRouting };
}

function describeBinding(b: Binding, t: (key: string) => string): string {
	if (b.peer) return `${t("routing.matchUser")} ${b.peer}`;
	if (b.guild) return `${t("routing.matchGroup")} ${b.guild}`;
	if (b.channel && !b.peer && !b.guild) return t("routing.matchAll");
	return t("routing.matchAll");
}

function ChannelBindings({
	channelType,
	bindings,
	agents,
	defaultAgent,
	onRemove,
	onAdd,
}: {
	channelType: string;
	bindings: Binding[];
	agents: AgentInfo[];
	defaultAgent: string;
	onRemove: (globalIndex: number) => void;
	onAdd: () => void;
}) {
	const { t } = useI18n();
	const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

	// Filter bindings relevant to this channel and track their global index
	const channelBindings: { binding: Binding; globalIndex: number }[] = [];
	for (let i = 0; i < bindings.length; i++) {
		const b = bindings[i];
		if (b.channel === channelType || (!b.channel && !b.peer && !b.guild)) {
			channelBindings.push({ binding: b, globalIndex: i });
		}
	}

	return (
		<div className="mt-3 pt-3 border-t border-border/50">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<Route className="size-3" />
					{t("routing.title")}
				</div>
				<button
					type="button"
					onClick={onAdd}
					className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
				>
					<Plus className="size-3" />
					{t("routing.addRule")}
				</button>
			</div>

			{/* Default agent */}
			<div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
				<span className="bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
					{t("routing.default")}
				</span>
				<ArrowRight className="size-3" />
				<span className="text-foreground font-medium">{agentName(defaultAgent)}</span>
			</div>

			{/* Channel-specific bindings */}
			{channelBindings.map(({ binding, globalIndex }) => (
				<div
					key={globalIndex}
					className="flex items-center gap-2 text-xs text-muted-foreground group mb-1"
				>
					<span className="bg-muted px-1.5 py-0.5 rounded">{describeBinding(binding, t)}</span>
					<ArrowRight className="size-3" />
					<span className="text-foreground font-medium">{agentName(binding.agent)}</span>
					<button
						type="button"
						onClick={() => onRemove(globalIndex)}
						className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
						title={t("routing.deleteRule")}
					>
						<Trash2 className="size-3" />
					</button>
				</div>
			))}
		</div>
	);
}

function AddBindingDialog({
	open,
	onOpenChange,
	channelType,
	agents,
	onSave,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	channelType: string;
	agents: AgentInfo[];
	onSave: (binding: Omit<Binding, "priority">) => Promise<void>;
}) {
	const { t } = useI18n();
	const [matchType, setMatchType] = useState<"all" | "peer" | "guild">("all");
	const [matchValue, setMatchValue] = useState("");
	const [agentId, setAgentId] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	const reset = () => {
		setMatchType("all");
		setMatchValue("");
		setAgentId("");
		setError("");
		setSaving(false);
	};

	const handleSave = async () => {
		if (!agentId) return;
		setSaving(true);
		setError("");
		try {
			const binding: Omit<Binding, "priority"> = {
				channel: channelType,
				agent: agentId,
			};
			if (matchType === "peer" && matchValue.trim()) {
				binding.peer = matchValue.trim();
			} else if (matchType === "guild" && matchValue.trim()) {
				binding.guild = matchValue.trim();
			}
			await onSave(binding);
			reset();
			onOpenChange(false);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to add binding");
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) reset();
				onOpenChange(v);
			}}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{t("routing.addRuleTitle")}</DialogTitle>
					<DialogDescription>
						{t("routing.addRuleDesc")} ({channelType})
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Match type */}
					<div>
						<label className="text-sm text-muted-foreground block mb-1.5">
							{t("routing.matchType")}
						</label>
						<Select
							value={matchType}
							onValueChange={(v) => setMatchType(v as "all" | "peer" | "guild")}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{t("routing.matchAllOption")}</SelectItem>
								<SelectItem value="peer">{t("routing.matchUserOption")}</SelectItem>
								<SelectItem value="guild">{t("routing.matchGroupOption")}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{/* Match value */}
					{matchType !== "all" && (
						<div>
							<label className="text-sm text-muted-foreground block mb-1.5">
								{matchType === "peer" ? t("routing.peerId") : t("routing.guildId")}
							</label>
							<input
								type="text"
								value={matchValue}
								onChange={(e) => setMatchValue(e.target.value)}
								placeholder={matchType === "peer" ? "e.g. 123456789" : "e.g. -1001234567890"}
								className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
					)}

					{/* Agent selector */}
					<div>
						<label className="text-sm text-muted-foreground block mb-1.5">
							{t("routing.targetAgent")}
						</label>
						<Select value={agentId} onValueChange={setAgentId}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("routing.selectAgent")} />
							</SelectTrigger>
							<SelectContent>
								{agents.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.name} ({a.id})
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>

				<DialogFooter>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button onClick={handleSave} disabled={saving || !agentId}>
						{saving ? t("common.saving") : t("common.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// --- Route Test ---

interface RouteTestCandidate {
	rank: number;
	score: number;
	isWinner: boolean;
	binding: Binding;
	breakdown: Record<string, number>;
}

interface RouteTestResult {
	agentId: string;
	sessionKey: string;
	dmScope: string;
	binding: Binding | null;
	candidates: RouteTestCandidate[];
	defaultAgent: string;
	totalBindings: number;
	matchedBindings: number;
}

function BreakdownBadges({ breakdown }: { breakdown: Record<string, number> }) {
	return (
		<span className="inline-flex flex-wrap gap-1">
			{Object.entries(breakdown)
				.filter(([, v]) => v !== 0)
				.map(([k, v]) => (
					<span
						key={k}
						className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-muted text-muted-foreground"
					>
						{k}({v > 0 ? "+" : ""}
						{v})
					</span>
				))}
		</span>
	);
}

function RouteTestDialog({
	open,
	onOpenChange,
	channels,
	agents,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	channels: ChannelInfo[];
	agents: AgentInfo[];
}) {
	const { t } = useI18n();
	const [channelType, setChannelType] = useState("");
	const [peerId, setPeerId] = useState("");
	const [guildId, setGuildId] = useState("");
	const [testing, setTesting] = useState(false);
	const [result, setResult] = useState<RouteTestResult | null>(null);
	const [error, setError] = useState("");

	const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

	const connectedTypes = [...new Set(channels.filter((c) => c.enabled).map((c) => c.type))];

	const reset = () => {
		setChannelType("");
		setPeerId("");
		setGuildId("");
		setResult(null);
		setError("");
		setTesting(false);
	};

	const runTest = async () => {
		if (!channelType) return;
		setTesting(true);
		setError("");
		setResult(null);
		try {
			const params = new URLSearchParams({ channel: channelType, debug: "true" });
			if (peerId.trim()) params.set("peer", peerId.trim());
			if (guildId.trim()) params.set("guild", guildId.trim());
			const res = await apiFetch(`${API_BASE}/api/routing/test?${params}`);
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				throw new Error(body.error ?? `Failed: ${res.status}`);
			}
			setResult(await res.json());
		} catch (err) {
			setError(err instanceof Error ? err.message : "Test failed");
		} finally {
			setTesting(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(v) => {
				if (!v) reset();
				onOpenChange(v);
			}}
		>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>{t("routing.testRoute")}</DialogTitle>
					<DialogDescription>{t("routing.testRouteDesc")}</DialogDescription>
				</DialogHeader>

				<div className="space-y-3 py-2">
					{/* Channel type */}
					<div>
						<label className="text-sm text-muted-foreground block mb-1.5">
							{t("routing.channelType")}
						</label>
						<Select value={channelType} onValueChange={setChannelType}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("routing.selectChannel")} />
							</SelectTrigger>
							<SelectContent>
								{connectedTypes.map((ct) => (
									<SelectItem key={ct} value={ct}>
										{CHANNEL_ICONS[ct] ?? "📡"} {ct}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Peer ID */}
					<div>
						<label className="text-sm text-muted-foreground block mb-1.5">
							{t("routing.peerId")}
							<span className="ml-1 text-xs opacity-60">({t("common.optional")})</span>
						</label>
						<Input
							value={peerId}
							onChange={(e) => setPeerId(e.target.value)}
							placeholder="e.g. 123456789"
						/>
					</div>

					{/* Guild ID (show always, mostly useful for Discord) */}
					<div>
						<label className="text-sm text-muted-foreground block mb-1.5">
							{t("routing.guildId")}
							<span className="ml-1 text-xs opacity-60">({t("common.optional")})</span>
						</label>
						<Input
							value={guildId}
							onChange={(e) => setGuildId(e.target.value)}
							placeholder="e.g. -1001234567890"
						/>
					</div>

					{error && <p className="text-sm text-destructive">{error}</p>}
				</div>

				{/* Result */}
				{result && (
					<div className="space-y-3 border-t border-border pt-3">
						{/* Winner */}
						<div
							className={`rounded-xl p-3 border ${
								result.binding ? "border-green-500/40 bg-green-500/10" : "border-border bg-muted/50"
							}`}
						>
							<div className="flex items-center gap-2 text-sm font-medium">
								{result.binding ? (
									<>
										<Badge className="bg-green-500/20 text-green-400 border-green-500/30">
											{t("routing.winner")}
										</Badge>
										<span>{agentName(result.agentId)}</span>
									</>
								) : (
									<>
										<Badge variant="secondary">{t("routing.default")}</Badge>
										<span>{agentName(result.defaultAgent)}</span>
										<span className="text-xs text-muted-foreground">— {t("routing.noMatch")}</span>
									</>
								)}
							</div>
						</div>

						{/* Session key & DM scope */}
						<div className="grid grid-cols-2 gap-2 text-xs">
							<div className="bg-muted/50 rounded-lg p-2">
								<span className="text-muted-foreground">{t("routing.sessionKey")}</span>
								<p className="font-mono text-foreground mt-0.5 break-all">{result.sessionKey}</p>
							</div>
							<div className="bg-muted/50 rounded-lg p-2">
								<span className="text-muted-foreground">{t("routing.dmScope")}</span>
								<p className="font-mono text-foreground mt-0.5">{result.dmScope}</p>
							</div>
						</div>

						{/* Candidates */}
						{result.candidates.length > 0 && (
							<div>
								<h4 className="text-xs text-muted-foreground mb-1.5">
									{t("routing.candidates")} ({result.matchedBindings}/{result.totalBindings})
								</h4>
								<div className="space-y-1.5">
									{result.candidates.map((c, i) => (
										<div
											key={i}
											className={`text-xs rounded-lg p-2 flex flex-col gap-1 ${
												c.isWinner
													? "bg-green-500/10 border border-green-500/30"
													: "bg-muted/30 border border-border/50"
											}`}
										>
											<div className="flex items-center gap-2">
												<span className="text-muted-foreground font-mono w-5 text-right">
													#{c.rank}
												</span>
												<span className="font-medium">{agentName(c.binding.agent)}</span>
												<Badge variant="outline" className="text-[10px] px-1.5 py-0">
													{t("routing.score")}: {c.score}
												</Badge>
												{c.isWinner && (
													<Badge className="bg-green-500/20 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0">
														{t("routing.winner")}
													</Badge>
												)}
											</div>
											{c.breakdown && <BreakdownBadges breakdown={c.breakdown} />}
										</div>
									))}
								</div>
							</div>
						)}
					</div>
				)}

				<DialogFooter>
					<Button variant="secondary" onClick={() => onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					<Button onClick={runTest} disabled={testing || !channelType}>
						<Search className="size-3.5" />
						{testing ? t("routing.testing") : t("routing.testBtn")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// --- Main component ---

export function Channels() {
	const [channels, setChannels] = useState<ChannelInfo[]>([]);
	const [loading, setLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState<string | null>(null);

	// Add channel form
	const [showAdd, setShowAdd] = useState(false);
	const [channelTypes, setChannelTypes] = useState<ChannelType[]>([]);
	const [addType, setAddType] = useState("");
	const [addFields, setAddFields] = useState<Record<string, string>>({});
	const [addLoading, setAddLoading] = useState(false);
	const [addError, setAddError] = useState("");

	// Routing
	const { routing, bindings, agents, addBinding, removeBinding } = useRouting();
	const [bindingDialogChannel, setBindingDialogChannel] = useState<string | null>(null);
	const [showRouteTest, setShowRouteTest] = useState(false);

	const fetchChannels = useCallback(() => {
		apiFetch(`${API_BASE}/api/channels`)
			.then((r) => r.json())
			.then((data: ChannelInfo[]) => {
				setChannels(data);
				setLoading(false);
			})
			.catch(() => setLoading(false));
	}, []);

	useEffect(() => {
		fetchChannels();
		const interval = setInterval(fetchChannels, 10_000);
		return () => clearInterval(interval);
	}, [fetchChannels]);

	const fetchTypes = useCallback(() => {
		apiFetch(`${API_BASE}/api/channels/types`)
			.then((r) => r.json())
			.then((data: ChannelType[]) => setChannelTypes(data))
			.catch(() => {});
	}, []);

	const openAddForm = () => {
		fetchTypes();
		setShowAdd(true);
		setAddType("");
		setAddFields({});
		setAddError("");
	};

	const selectType = (type: string) => {
		setAddType(type);
		setAddFields({ id: "" });
		setAddError("");
	};

	const addChannel = async () => {
		if (!addType || !addFields.id?.trim()) return;
		setAddLoading(true);
		setAddError("");
		try {
			const { id, dmPolicy, ...rest } = addFields;
			const res = await apiFetch(`${API_BASE}/api/channels`, {
				method: "POST",
				body: JSON.stringify({
					type: addType,
					account: { id: id.trim(), dmPolicy: dmPolicy || "allowlist", ...rest },
				}),
			});
			if (!res.ok) {
				const body = (await res.json().catch(() => ({}))) as { error?: string };
				setAddError(body.error ?? `Failed: ${res.status}`);
				return;
			}
			setShowAdd(false);
			fetchChannels();
		} catch (err) {
			setAddError(err instanceof Error ? err.message : "Failed to add channel");
		} finally {
			setAddLoading(false);
		}
	};

	const deleteChannel = async (type: string, accountId: string) => {
		const key = `${type}:${accountId}`;
		setActionLoading(key);
		try {
			await apiFetch(`${API_BASE}/api/channels/${type}/${accountId}`, { method: "DELETE" });
			fetchChannels();
		} finally {
			setActionLoading(null);
		}
	};

	const connectChannel = async (type: string, accountId: string) => {
		const key = `${type}:${accountId}`;
		setActionLoading(key);
		try {
			await apiFetch(`${API_BASE}/api/channels/${type}/${accountId}/connect`, {
				method: "POST",
			});
			fetchChannels();
		} finally {
			setActionLoading(null);
		}
	};

	const disconnectChannel = async (type: string, accountId: string) => {
		const key = `${type}:${accountId}`;
		setActionLoading(key);
		try {
			await apiFetch(`${API_BASE}/api/channels/${type}/${accountId}/disconnect`, {
				method: "POST",
			});
			fetchChannels();
		} finally {
			setActionLoading(null);
		}
	};

	const selectedTypeInfo = channelTypes.find((t) => t.type === addType);

	if (loading) {
		return (
			<div className="p-6">
				<h2 className="text-lg font-semibold mb-4">频道</h2>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="p-6 animate-fade-in-up overflow-y-auto h-full">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">频道</h2>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={fetchChannels} title="刷新">
						<RefreshCw className="size-4" />
					</Button>
					<Button variant="outline" size="sm" onClick={() => setShowRouteTest(true)}>
						<Search className="size-4" />
						测试路由
					</Button>
					<Button size="sm" onClick={openAddForm}>
						<Plus className="size-4" />
						添加渠道
					</Button>
				</div>
			</div>

			{/* Add channel form */}
			{showAdd && (
				<div className="bg-card border border-border rounded-2xl p-4 shadow-warm-sm mb-6 max-w-2xl">
					<div className="flex items-center justify-between mb-4">
						<h3 className="font-medium">添加渠道</h3>
						<button
							type="button"
							onClick={() => setShowAdd(false)}
							className="text-muted-foreground hover:text-foreground"
						>
							<X className="size-4" />
						</button>
					</div>

					{!addType ? (
						<div className="flex flex-wrap gap-2">
							{channelTypes.map((ct) => (
								<button
									type="button"
									key={ct.type}
									onClick={() => selectType(ct.type)}
									className="px-4 py-2 bg-muted rounded-xl hover:bg-muted/80 transition-colors text-sm font-medium"
								>
									<span className="mr-2">{CHANNEL_ICONS[ct.type] ?? "📡"}</span>
									{ct.type}
								</button>
							))}
							{channelTypes.length === 0 && (
								<p className="text-sm text-muted-foreground">无可用渠道类型</p>
							)}
						</div>
					) : (
						<div className="space-y-3">
							<div className="flex items-center gap-2 mb-2">
								<span className="text-lg">{CHANNEL_ICONS[addType] ?? "📡"}</span>
								<span className="font-medium capitalize">{addType}</span>
								<button
									type="button"
									onClick={() => setAddType("")}
									className="text-xs text-muted-foreground hover:text-foreground ml-2"
								>
									更换
								</button>
							</div>

							<div>
								<label className="text-sm text-muted-foreground block mb-1">账号 ID</label>
								<input
									type="text"
									value={addFields.id ?? ""}
									onChange={(e) => setAddFields((f) => ({ ...f, id: e.target.value }))}
									placeholder="e.g. bot-prod"
									className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
								/>
							</div>

							{(selectedTypeInfo?.requiredFields ?? []).map((field) => (
								<div key={field}>
									<label className="text-sm text-muted-foreground block mb-1">
										{FIELD_LABELS[field] ?? field}
									</label>
									<input
										type={field.toLowerCase().includes("secret") ? "password" : "text"}
										value={addFields[field] ?? ""}
										onChange={(e) => setAddFields((f) => ({ ...f, [field]: e.target.value }))}
										className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
									/>
								</div>
							))}

							<div>
								<label className="text-sm text-muted-foreground block mb-1">DM 策略</label>
								<select
									value={addFields.dmPolicy ?? "allowlist"}
									onChange={(e) => setAddFields((f) => ({ ...f, dmPolicy: e.target.value }))}
									className="w-full px-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
								>
									<option value="open">开放</option>
									<option value="allowlist">白名单</option>
									<option value="pairing">配对</option>
								</select>
							</div>

							{addError && <p className="text-sm text-destructive">{addError}</p>}

							<div className="flex justify-end gap-2 pt-2">
								<Button variant="secondary" size="sm" onClick={() => setShowAdd(false)}>
									取消
								</Button>
								<Button
									size="sm"
									onClick={addChannel}
									disabled={addLoading || !addFields.id?.trim()}
								>
									{addLoading ? "添加中..." : "添加并连接"}
								</Button>
							</div>
						</div>
					)}
				</div>
			)}

			{channels.length === 0 && !showAdd ? (
				<div className="text-center py-12">
					<p className="text-muted-foreground mb-2">未配置渠道。</p>
					<p className="text-muted-foreground text-sm">点击"添加渠道"连接消息平台。</p>
				</div>
			) : (
				<div className="space-y-3 max-w-2xl">
					{channels.map((ch) => {
						const key = `${ch.type}:${ch.accountId}`;
						const isActing = actionLoading === key;

						return (
							<div
								key={key}
								className="bg-card border border-border rounded-2xl p-4 shadow-warm-sm"
							>
								<div className="flex items-center justify-between">
									<div className="flex items-center gap-3">
										<span className="text-2xl" title={ch.type}>
											{CHANNEL_ICONS[ch.type] ?? "📡"}
										</span>
										<div>
											<span className="font-medium text-foreground capitalize">{ch.type}</span>
											{ch.accountId && (
												<span className="text-sm text-muted-foreground ml-2">{ch.accountId}</span>
											)}
										</div>
										{statusBadge(ch.status)}
										{!ch.enabled && (
											<Badge variant="outline" className="text-muted-foreground/70">
												disabled
											</Badge>
										)}
									</div>
									<div className="flex items-center gap-2">
										{ch.enabled &&
											(ch.status === "connected" ? (
												<Button
													variant="secondary"
													size="sm"
													onClick={() => disconnectChannel(ch.type, ch.accountId)}
													disabled={isActing}
												>
													<PowerOff className="size-3.5" />
													断开
												</Button>
											) : (
												<Button
													size="sm"
													onClick={() => connectChannel(ch.type, ch.accountId)}
													disabled={isActing}
												>
													<Power className="size-3.5" />
													连接
												</Button>
											))}
										<Button
											variant="ghost"
											size="icon"
											onClick={() => deleteChannel(ch.type, ch.accountId)}
											disabled={isActing}
											title="删除"
											className="text-muted-foreground hover:text-destructive"
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								</div>

								{/* Routing bindings for this channel */}
								{routing && (
									<ChannelBindings
										channelType={ch.type}
										bindings={bindings}
										agents={agents}
										defaultAgent={routing.default}
										onRemove={removeBinding}
										onAdd={() => setBindingDialogChannel(ch.type)}
									/>
								)}
							</div>
						);
					})}
				</div>
			)}

			{/* Add binding dialog */}
			<AddBindingDialog
				open={bindingDialogChannel !== null}
				onOpenChange={(open) => {
					if (!open) setBindingDialogChannel(null);
				}}
				channelType={bindingDialogChannel ?? ""}
				agents={agents}
				onSave={addBinding}
			/>

			{/* Route test dialog */}
			<RouteTestDialog
				open={showRouteTest}
				onOpenChange={setShowRouteTest}
				channels={channels}
				agents={agents}
			/>
		</div>
	);
}
