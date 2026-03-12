import { Plus, Power, PowerOff, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
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
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
