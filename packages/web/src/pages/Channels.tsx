import { Power, PowerOff, RefreshCw } from "lucide-react";
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

const CHANNEL_ICONS: Record<string, string> = {
	telegram: "✈",
	discord: "🎮",
	slack: "💬",
	webchat: "🌐",
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
		// Poll every 10 seconds for status updates
		const interval = setInterval(fetchChannels, 10_000);
		return () => clearInterval(interval);
	}, [fetchChannels]);

	const connectChannel = async (type: string, accountId: string) => {
		const key = `${type}:${accountId}`;
		setActionLoading(key);
		try {
			await apiFetch(`${API_BASE}/api/channels/${type}/${accountId}/connect`, {
				method: "POST",
			});
			fetchChannels();
		} catch {
			// ignore
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
		} catch {
			// ignore
		} finally {
			setActionLoading(null);
		}
	};

	if (loading) {
		return (
			<div className="p-6">
				<h2 className="text-lg font-semibold mb-4">频道</h2>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="p-6 animate-fade-in-up">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">频道</h2>
				<Button variant="ghost" size="icon" onClick={fetchChannels} title="刷新">
					<RefreshCw className="size-4" />
				</Button>
			</div>

			{channels.length === 0 ? (
				<div className="text-center py-12">
					<p className="text-muted-foreground mb-2">No channels configured.</p>
					<p className="text-muted-foreground text-sm">
						Add channel configuration in Settings to connect messaging platforms.
					</p>
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
									<div className="flex items-center gap-3">
										{ch.enabled &&
											(ch.status === "connected" ? (
												<Button
													variant="secondary"
													size="sm"
													onClick={() => disconnectChannel(ch.type, ch.accountId)}
													disabled={isActing}
												>
													<PowerOff className="size-3.5" />
													Disconnect
												</Button>
											) : (
												<Button
													size="sm"
													onClick={() => connectChannel(ch.type, ch.accountId)}
													disabled={isActing}
												>
													<Power className="size-3.5" />
													Connect
												</Button>
											))}
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
