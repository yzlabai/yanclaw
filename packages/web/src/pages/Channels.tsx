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
	disconnected: "bg-gray-500",
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
				<p className="text-gray-500">Loading...</p>
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
					className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-800 transition-colors"
					title="Refresh"
				>
					<RefreshCw className="size-4" />
				</button>
			</div>

			{channels.length === 0 ? (
				<div className="text-center py-12">
					<p className="text-gray-400 mb-2">No channels configured.</p>
					<p className="text-gray-500 text-sm">
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
								className="flex items-center gap-4 px-4 py-3 rounded-lg bg-gray-800/50 border border-gray-800"
							>
								{/* Icon */}
								<span className="text-2xl" title={ch.type}>
									{CHANNEL_ICONS[ch.type] ?? "📡"}
								</span>

								{/* Info */}
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="font-medium text-white capitalize">{ch.type}</span>
										<span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
											{ch.accountId}
										</span>
									</div>
									<div className="flex items-center gap-2 mt-1">
										<span
											className={`inline-block size-2 rounded-full ${STATUS_COLORS[ch.status]}`}
										/>
										<span className="text-xs text-gray-400">{STATUS_LABELS[ch.status]}</span>
										{!ch.enabled && <span className="text-xs text-gray-600">(disabled)</span>}
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
												className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white disabled:opacity-50 transition-colors"
											>
												<PowerOff className="size-3.5" />
												Disconnect
											</button>
										) : (
											<button
												type="button"
												onClick={() => connectChannel(ch.type, ch.accountId)}
												disabled={isActing}
												className="flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
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
