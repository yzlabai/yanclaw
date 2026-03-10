import { Power, PowerOff, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { API_BASE, apiFetch } from "../lib/api";

interface ChannelInfo {
	type: string;
	accountId: string;
	enabled: boolean;
	status: "connected" | "disconnected" | "connecting" | "error";
}

const STATUS_COLORS: Record<string, string> = {
	connected: "bg-green-500",
	disconnected: "bg-muted-foreground",
	connecting: "bg-yellow-500 animate-pulse",
	error: "bg-red-500",
};

const STATUS_LABELS: Record<string, string> = {
	connected: "Connected",
	disconnected: "Disconnected",
	connecting: "Connecting...",
	error: "Error",
};

const CHANNEL_ICONS: Record<string, string> = {
	telegram: "✈",
	discord: "🎮",
	slack: "💬",
	webchat: "🌐",
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
				<h2 className="text-lg font-semibold mb-4">Channels</h2>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="p-6">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">Channels</h2>
				<button
					type="button"
					onClick={fetchChannels}
					className="text-muted-foreground hover:text-foreground p-1.5 rounded-lg hover:bg-muted transition-colors"
					title="Refresh"
				>
					<RefreshCw className="size-4" />
				</button>
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
								className="flex items-center gap-4 px-4 py-3 rounded-lg bg-muted/50 border border-border"
							>
								{/* Icon */}
								<span className="text-2xl" title={ch.type}>
									{CHANNEL_ICONS[ch.type] ?? "📡"}
								</span>

								{/* Info */}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="font-medium text-foreground capitalize">{ch.type}</span>
										<span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
											{ch.accountId}
										</span>
									</div>
									<div className="flex items-center gap-2 mt-1">
										<span
											className={`inline-block size-2 rounded-full ${STATUS_COLORS[ch.status]}`}
										/>
										<span className="text-xs text-muted-foreground">
											{STATUS_LABELS[ch.status]}
										</span>
										{!ch.enabled && (
											<span className="text-xs text-muted-foreground/70">(disabled)</span>
										)}
									</div>
								</div>

								{/* Actions */}
								{ch.enabled && (
									<div className="flex gap-2">
										{ch.status === "connected" ? (
											<button
												type="button"
												onClick={() => disconnectChannel(ch.type, ch.accountId)}
												disabled={isActing}
												className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-accent text-foreground/80 hover:bg-accent hover:text-foreground disabled:opacity-50 transition-colors"
											>
												<PowerOff className="size-3.5" />
												Disconnect
											</button>
										) : (
											<button
												type="button"
												onClick={() => connectChannel(ch.type, ch.accountId)}
												disabled={isActing}
												className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-primary text-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
											>
												<Power className="size-3.5" />
												Connect
											</button>
										)}
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
