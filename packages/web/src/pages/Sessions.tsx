import { Clock, Download, MessageSquare, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE, apiFetch } from "../lib/api";

interface SessionInfo {
	key: string;
	agentId: string;
	channel: string | null;
	peerKind: string | null;
	peerId: string | null;
	peerName: string | null;
	title: string | null;
	messageCount: number;
	tokenCount: number;
	createdAt: number;
	updatedAt: number;
}

interface AgentInfo {
	id: string;
	name: string;
}

export function Sessions() {
	const navigate = useNavigate();
	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [agents, setAgents] = useState<AgentInfo[]>([]);
	const [total, setTotal] = useState(0);
	const [agentFilter, setAgentFilter] = useState("");
	const [search, setSearch] = useState("");
	const [page, setPage] = useState(0);
	const limit = 20;

	useEffect(() => {
		apiFetch(`${API_BASE}/api/agents`)
			.then((r) => r.json())
			.then((data: AgentInfo[]) => setAgents(data))
			.catch(() => {});
	}, []);

	const fetchSessions = useCallback(() => {
		const params = new URLSearchParams();
		params.set("limit", String(limit));
		params.set("offset", String(page * limit));
		if (agentFilter) params.set("agentId", agentFilter);

		apiFetch(`${API_BASE}/api/sessions?${params}`)
			.then((r) => r.json())
			.then((data: { sessions: SessionInfo[]; total: number }) => {
				setSessions(data.sessions);
				setTotal(data.total);
			})
			.catch(() => {});
	}, [agentFilter, page]);

	useEffect(() => {
		fetchSessions();
	}, [fetchSessions]);

	const deleteSession = async (key: string) => {
		const res = await apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(key)}`, {
			method: "DELETE",
		});
		if (res.ok) fetchSessions();
	};

	const exportSession = async (key: string, format: "json" | "md") => {
		const res = await apiFetch(
			`${API_BASE}/api/sessions/${encodeURIComponent(key)}/export?format=${format}`,
		);
		if (!res.ok) return;
		const blob = await res.blob();
		const disposition = res.headers.get("Content-Disposition");
		const match = disposition?.match(/filename="(.+)"/);
		const filename = match?.[1] ?? `export.${format}`;
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	};

	const openSession = (key: string) => {
		// Navigate to chat with this session key
		navigate(`/?session=${encodeURIComponent(key)}`);
	};

	const formatTime = (ts: number) => {
		const d = new Date(ts);
		const now = new Date();
		const diffMs = now.getTime() - d.getTime();
		const diffMin = Math.floor(diffMs / 60000);
		if (diffMin < 1) return "just now";
		if (diffMin < 60) return `${diffMin}m ago`;
		const diffHr = Math.floor(diffMin / 60);
		if (diffHr < 24) return `${diffHr}h ago`;
		const diffDay = Math.floor(diffHr / 24);
		if (diffDay < 7) return `${diffDay}d ago`;
		return d.toLocaleDateString([], { month: "short", day: "numeric" });
	};

	const formatTokens = (n: number) => {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
		return String(n);
	};

	const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

	const filtered = search
		? sessions.filter(
				(s) =>
					s.title?.toLowerCase().includes(search.toLowerCase()) ||
					s.key.toLowerCase().includes(search.toLowerCase()) ||
					s.peerName?.toLowerCase().includes(search.toLowerCase()),
			)
		: sessions;

	const totalPages = Math.ceil(total / limit);

	return (
		<div className="p-6 h-full flex flex-col">
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-lg font-semibold">Sessions</h2>
				<span className="text-sm text-gray-500">{total} total</span>
			</div>

			{/* Filters */}
			<div className="flex gap-3 mb-4">
				<div className="relative flex-1 max-w-xs">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-gray-500" />
					<input
						type="text"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="Search sessions..."
						className="w-full bg-gray-800 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>
				<select
					value={agentFilter}
					onChange={(e) => {
						setAgentFilter(e.target.value);
						setPage(0);
					}}
					className="bg-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
				>
					<option value="">All Agents</option>
					{agents.map((a) => (
						<option key={a.id} value={a.id}>
							{a.name}
						</option>
					))}
				</select>
			</div>

			{/* Sessions list */}
			<div className="flex-1 overflow-y-auto">
				{filtered.length === 0 ? (
					<div className="text-gray-500 text-center mt-20">No sessions found.</div>
				) : (
					<div className="space-y-1">
						{filtered.map((s) => (
							<div
								key={s.key}
								className="group flex items-center gap-4 px-4 py-3 rounded-lg hover:bg-gray-800/60 transition-colors"
							>
								<button
									type="button"
									onClick={() => openSession(s.key)}
									className="flex-1 min-w-0 text-left"
								>
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-white truncate">
											{s.title || s.key.split(":").pop()}
										</span>
										<span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
											{agentName(s.agentId)}
										</span>
										{s.channel && (
											<span className="text-xs text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">
												{s.channel}
											</span>
										)}
									</div>
									<div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
										<span className="flex items-center gap-1">
											<MessageSquare className="size-3" />
											{s.messageCount}
										</span>
										<span>{formatTokens(s.tokenCount)} tokens</span>
										<span className="flex items-center gap-1">
											<Clock className="size-3" />
											{formatTime(s.updatedAt)}
										</span>
										{s.peerName && <span>· {s.peerName}</span>}
									</div>
								</button>
								<div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
									<button
										type="button"
										onClick={() => exportSession(s.key, "json")}
										title="Export JSON"
										className="text-gray-500 hover:text-blue-400 p-1"
									>
										<Download className="size-4" />
									</button>
									<button
										type="button"
										onClick={() => deleteSession(s.key)}
										className="text-gray-500 hover:text-red-400 p-1"
									>
										<Trash2 className="size-4" />
									</button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-gray-800">
					<button
						type="button"
						onClick={() => setPage((p) => Math.max(0, p - 1))}
						disabled={page === 0}
						className="px-3 py-1 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						Prev
					</button>
					<span className="text-sm text-gray-500">
						{page + 1} / {totalPages}
					</span>
					<button
						type="button"
						onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
						disabled={page >= totalPages - 1}
						className="px-3 py-1 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
					>
						Next
					</button>
				</div>
			)}
		</div>
	);
}
