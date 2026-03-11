import { Clock, Download, MessageSquare, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
	Pagination,
	PaginationContent,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "../components/ui/pagination";
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
	const [page, setPage] = useState(1);
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
		params.set("offset", String((page - 1) * limit));
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
		<div className="p-6 h-full flex flex-col animate-fade-in-up">
			<div className="flex items-center justify-between mb-4">
				<h2 className="text-lg font-semibold">Sessions</h2>
				<span className="text-sm text-muted-foreground">{total} total</span>
			</div>

			{/* Filters */}
			<div className="flex gap-3 mb-4">
				<div className="relative flex-1 max-w-xs">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder="搜索会话..."
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="pl-9 rounded-xl"
					/>
				</div>
				<select
					value={agentFilter}
					onChange={(e) => {
						setAgentFilter(e.target.value);
						setPage(1);
					}}
					className="bg-muted rounded-xl border border-input px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
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
					<div className="text-muted-foreground text-center mt-20">No sessions found.</div>
				) : (
					<div className="space-y-1">
						{filtered.map((s) => (
							<div
								key={s.key}
								className="group flex items-center gap-4 px-4 p-3 rounded-xl cursor-pointer transition-colors hover:bg-muted/50"
							>
								<button
									type="button"
									onClick={() => openSession(s.key)}
									className="flex-1 min-w-0 text-left"
								>
									<div className="flex items-center gap-2">
										<span className="text-sm font-medium text-foreground truncate">
											{s.title || s.key.split(":").pop()}
										</span>
										<span className="text-xs text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
											{agentName(s.agentId)}
										</span>
										{s.channel && (
											<span className="text-xs text-muted-foreground/70 bg-muted px-1.5 py-0.5 rounded">
												{s.channel}
											</span>
										)}
									</div>
									<div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
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
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => exportSession(s.key, "json")}
										title="Export JSON"
										className="text-muted-foreground hover:text-primary"
									>
										<Download className="size-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon-xs"
										onClick={() => deleteSession(s.key)}
										title="Delete session"
										className="text-muted-foreground hover:text-red-400"
									>
										<Trash2 className="size-4" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="mt-4 pt-4 border-t border-border">
					<Pagination>
						<PaginationContent>
							<PaginationItem>
								<PaginationPrevious
									onClick={() => setPage(Math.max(1, page - 1))}
									className={page <= 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}
								/>
							</PaginationItem>
							{Array.from({ length: totalPages }, (_, i) => (
								<PaginationItem key={i + 1}>
									<PaginationLink
										onClick={() => setPage(i + 1)}
										isActive={page === i + 1}
										className="cursor-pointer"
									>
										{i + 1}
									</PaginationLink>
								</PaginationItem>
							))}
							<PaginationItem>
								<PaginationNext
									onClick={() => setPage(Math.min(totalPages, page + 1))}
									className={
										page >= totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"
									}
								/>
							</PaginationItem>
						</PaginationContent>
					</Pagination>
				</div>
			)}
		</div>
	);
}
