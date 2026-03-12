import { ChevronDown, ChevronRight, Play, RefreshCw, Search, Square, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { API_BASE, apiFetch } from "../lib/api";

interface McpServer {
	name: string;
	enabled: boolean;
	mode: "stdio" | "http";
	status: "connected" | "connecting" | "closed" | "error";
	toolCount: number;
}

interface McpTool {
	name: string;
	description?: string;
	inputSchema?: unknown;
}

interface RegistryServer {
	name: string;
	description?: string;
	repository?: string;
}

const statusBadge = (status: string) => {
	switch (status) {
		case "connected":
			return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">运行中</Badge>;
		case "connecting":
			return (
				<Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">连接中</Badge>
			);
		case "error":
			return <Badge variant="destructive">错误</Badge>;
		default:
			return <Badge variant="secondary">停止</Badge>;
	}
};

export function McpServers() {
	const [servers, setServers] = useState<McpServer[]>([]);
	const [loading, setLoading] = useState(true);
	const [actionLoading, setActionLoading] = useState<string | null>(null);
	const [expandedServer, setExpandedServer] = useState<string | null>(null);
	const [tools, setTools] = useState<Record<string, McpTool[]>>({});
	const [toolsLoading, setToolsLoading] = useState<string | null>(null);

	// Registry search
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<RegistryServer[]>([]);
	const [searching, setSearching] = useState(false);

	const fetchServers = useCallback(() => {
		apiFetch(`${API_BASE}/api/mcp/servers`)
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((data: McpServer[]) => {
				if (Array.isArray(data)) setServers(data);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		fetchServers();
		const interval = setInterval(fetchServers, 30_000);
		return () => clearInterval(interval);
	}, [fetchServers]);

	const startServer = async (name: string) => {
		setActionLoading(name);
		try {
			await apiFetch(`${API_BASE}/api/mcp/servers/${name}/start`, { method: "POST" });
			fetchServers();
		} finally {
			setActionLoading(null);
		}
	};

	const stopServer = async (name: string) => {
		setActionLoading(name);
		try {
			await apiFetch(`${API_BASE}/api/mcp/servers/${name}/stop`, { method: "POST" });
			fetchServers();
		} finally {
			setActionLoading(null);
		}
	};

	const toggleTools = async (name: string) => {
		if (expandedServer === name) {
			setExpandedServer(null);
			return;
		}
		setExpandedServer(name);
		if (!tools[name]) {
			setToolsLoading(name);
			try {
				const res = await apiFetch(`${API_BASE}/api/mcp/servers/${name}/tools`);
				const data = (await res.json()) as { tools: McpTool[] };
				setTools((prev) => ({ ...prev, [name]: data.tools }));
			} catch {
				setTools((prev) => ({ ...prev, [name]: [] }));
			} finally {
				setToolsLoading(null);
			}
		}
	};

	const searchRegistry = async () => {
		if (!searchQuery.trim()) return;
		setSearching(true);
		try {
			const res = await apiFetch(`${API_BASE}/api/mcp/registry/search`, {
				method: "POST",
				body: JSON.stringify({ query: searchQuery, limit: 20 }),
			});
			const data = (await res.json()) as { servers?: RegistryServer[] };
			setSearchResults(data.servers ?? []);
		} catch {
			setSearchResults([]);
		} finally {
			setSearching(false);
		}
	};

	if (loading) {
		return (
			<div className="p-6">
				<h2 className="text-lg font-semibold mb-4">MCP 服务</h2>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	return (
		<div className="p-6 animate-fade-in-up overflow-y-auto h-full">
			{/* Installed servers */}
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">MCP 服务</h2>
				<Button variant="ghost" size="icon" onClick={fetchServers} title="刷新">
					<RefreshCw className="size-4" />
				</Button>
			</div>

			{servers.length === 0 ? (
				<div className="text-center py-12 mb-8">
					<p className="text-muted-foreground mb-2">未配置 MCP 服务。</p>
					<p className="text-muted-foreground text-sm">
						在配置文件的 mcp.servers 中添加 MCP 服务配置。
					</p>
				</div>
			) : (
				<div className="space-y-3 max-w-2xl mb-8">
					{servers.map((srv) => (
						<div key={srv.name} className="bg-card border border-border rounded-2xl shadow-warm-sm">
							<div className="flex items-center justify-between p-4">
								<div className="flex items-center gap-3">
									<button
										type="button"
										onClick={() => toggleTools(srv.name)}
										className="text-muted-foreground hover:text-foreground transition-colors"
									>
										{expandedServer === srv.name ? (
											<ChevronDown className="size-4" />
										) : (
											<ChevronRight className="size-4" />
										)}
									</button>
									<div>
										<span className="font-medium text-foreground">{srv.name}</span>
										<span className="text-sm text-muted-foreground ml-2">
											{srv.mode === "stdio" ? "stdio" : "HTTP"}
										</span>
									</div>
									{statusBadge(srv.status)}
									{srv.toolCount > 0 && (
										<span className="text-xs text-muted-foreground flex items-center gap-1">
											<Wrench className="size-3" />
											{srv.toolCount}
										</span>
									)}
								</div>
								<div className="flex items-center gap-2">
									{srv.status === "connected" ? (
										<Button
											variant="secondary"
											size="sm"
											onClick={() => stopServer(srv.name)}
											disabled={actionLoading === srv.name}
										>
											<Square className="size-3.5" />
											停止
										</Button>
									) : (
										<Button
											size="sm"
											onClick={() => startServer(srv.name)}
											disabled={actionLoading === srv.name || !srv.enabled}
										>
											<Play className="size-3.5" />
											启动
										</Button>
									)}
								</div>
							</div>

							{/* Expandable tools list */}
							{expandedServer === srv.name && (
								<div className="border-t border-border px-4 py-3">
									{toolsLoading === srv.name ? (
										<p className="text-sm text-muted-foreground">加载工具列表...</p>
									) : (tools[srv.name] ?? []).length === 0 ? (
										<p className="text-sm text-muted-foreground">无可用工具</p>
									) : (
										<div className="space-y-2">
											{(tools[srv.name] ?? []).map((tool) => (
												<div key={tool.name} className="text-sm">
													<span className="font-mono text-foreground">{tool.name}</span>
													{tool.description && (
														<span className="text-muted-foreground ml-2">— {tool.description}</span>
													)}
												</div>
											))}
										</div>
									)}
								</div>
							)}
						</div>
					))}
				</div>
			)}

			{/* Registry search */}
			<div className="max-w-2xl">
				<h3 className="text-base font-semibold mb-4">Registry 浏览</h3>
				<div className="flex gap-2 mb-4">
					<div className="relative flex-1">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
						<input
							type="text"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && searchRegistry()}
							placeholder="搜索 MCP 服务..."
							className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<Button onClick={searchRegistry} disabled={searching || !searchQuery.trim()}>
						{searching ? "搜索中..." : "搜索"}
					</Button>
				</div>

				{searchResults.length > 0 && (
					<div className="space-y-2">
						{searchResults.map((srv) => (
							<div
								key={srv.name}
								className="bg-card border border-border rounded-xl p-3 shadow-warm-sm"
							>
								<div className="font-medium text-foreground text-sm">{srv.name}</div>
								{srv.description && (
									<p className="text-xs text-muted-foreground mt-1">{srv.description}</p>
								)}
								{srv.repository && (
									<p className="text-xs text-muted-foreground/70 mt-1 font-mono">
										{srv.repository}
									</p>
								)}
							</div>
						))}
					</div>
				)}
			</div>
		</div>
	);
}
