import {
	BookOpen,
	ChevronLeft,
	ChevronRight,
	Edit3,
	Plus,
	Search,
	Tags,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import {
	Dialog,
	DialogContent,
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
import { Textarea } from "../components/ui/textarea";
import { API_BASE, apiFetch } from "../lib/api";

// ── Types ──────────────────────────────────────────────────────────────

interface Memory {
	id: string;
	agentId: string;
	content: string;
	tags: string[];
	source: string;
	createdAt: number;
	updatedAt: number;
}

interface MemoryStats {
	total: number;
	byAgent: Record<string, number>;
	bySource: Record<string, number>;
}

// ── Helpers ────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) return "刚刚";
	if (diff < 3600_000) return `${Math.floor(diff / 60_000)}分钟前`;
	if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}小时前`;
	return `${Math.floor(diff / 86400_000)}天前`;
}

const SOURCES = ["tool", "user", "auto", "auto-indexed"] as const;

const TAG_COLORS = [
	"bg-blue-500/20 text-blue-400 border-blue-500/30",
	"bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
	"bg-purple-500/20 text-purple-400 border-purple-500/30",
	"bg-amber-500/20 text-amber-400 border-amber-500/30",
	"bg-rose-500/20 text-rose-400 border-rose-500/30",
	"bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
	"bg-orange-500/20 text-orange-400 border-orange-500/30",
	"bg-pink-500/20 text-pink-400 border-pink-500/30",
];

function tagColor(tag: string): string {
	let hash = 0;
	for (const ch of tag) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
	return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}

const PAGE_SIZE = 20;

// ── Component ──────────────────────────────────────────────────────────

export function Knowledge() {
	const [searchParams, setSearchParams] = useSearchParams();

	// Data state
	const [memories, setMemories] = useState<Memory[]>([]);
	const [total, setTotal] = useState(0);
	const [stats, setStats] = useState<MemoryStats | null>(null);
	const [allTags, setAllTags] = useState<string[]>([]);
	const [page, setPage] = useState(1);
	const [loading, setLoading] = useState(false);

	// Filters
	const [searchQuery, setSearchQuery] = useState("");
	const [debouncedQuery, setDebouncedQuery] = useState("");
	const [searchMode, setSearchMode] = useState<"hybrid" | "keyword" | "semantic">("hybrid");
	const [selectedTags, setSelectedTags] = useState<string[]>([]);
	const [sourceFilter, setSourceFilter] = useState<string>("all");

	// Selection
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

	// Dialogs
	const [detailMemory, setDetailMemory] = useState<Memory | null>(null);
	const [editMode, setEditMode] = useState(false);
	const [editContent, setEditContent] = useState("");
	const [editTags, setEditTags] = useState("");
	const [showNewDialog, setShowNewDialog] = useState(false);
	const [newContent, setNewContent] = useState("");
	const [newTags, setNewTags] = useState("");
	const [showBatchTagDialog, setShowBatchTagDialog] = useState(false);
	const [batchAddTags, setBatchAddTags] = useState("");
	const [batchRemoveTags, setBatchRemoveTags] = useState("");
	const [showTagFilter, setShowTagFilter] = useState(false);

	// Import
	const [importing, setImporting] = useState(false);
	const [dragOver, setDragOver] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Debounce search
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();
	useEffect(() => {
		debounceRef.current = setTimeout(() => setDebouncedQuery(searchQuery), 300);
		return () => clearTimeout(debounceRef.current);
	}, [searchQuery]);

	// Deep-link: open detail dialog for a specific memory ID from ?id= param
	useEffect(() => {
		const memoryId = searchParams.get("id");
		if (!memoryId) return;
		// Clear the param so it doesn't re-trigger
		setSearchParams({}, { replace: true });
		// Fetch the specific memory and open detail dialog
		apiFetch(`${API_BASE}/api/memory/${encodeURIComponent(memoryId)}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((data: Memory | null) => {
				if (data) {
					setDetailMemory(data);
					setEditContent(data.content);
					setEditTags(data.tags.join(", "));
				}
			})
			.catch(() => {});
	}, [searchParams, setSearchParams]);

	// Reset page on filter change
	// biome-ignore lint/correctness/useExhaustiveDependencies: intentional reset on filter change
	useEffect(() => {
		setPage(1);
	}, [debouncedQuery, selectedTags, sourceFilter, searchMode]);

	// Fetch tags + stats once
	useEffect(() => {
		apiFetch(`${API_BASE}/api/memory/tags`)
			.then((r) => r.json())
			.then((data: { tags: { tag: string; count: number }[] }) =>
				setAllTags(data.tags.map((t) => t.tag)),
			)
			.catch(() => {});
		apiFetch(`${API_BASE}/api/memory/stats`)
			.then((r) => r.json())
			.then((data: MemoryStats) => setStats(data))
			.catch(() => {});
	}, []);

	// Fetch memories
	const fetchMemories = useCallback(async () => {
		setLoading(true);
		try {
			let data: { entries: Memory[]; total: number };

			if (debouncedQuery.trim()) {
				const params = new URLSearchParams();
				params.set("agentId", "main");
				params.set("q", debouncedQuery.trim());
				params.set("limit", String(PAGE_SIZE));
				params.set("mode", searchMode);
				params.set("includeShared", "true");
				const res = await apiFetch(`${API_BASE}/api/memory/search?${params}`);
				const json = (await res.json()) as { results: Memory[] };
				const results = json.results ?? [];
				data = { entries: results, total: results.length };
			} else {
				const params = new URLSearchParams();
				params.set("agentId", "main");
				params.set("limit", String(PAGE_SIZE));
				params.set("offset", String((page - 1) * PAGE_SIZE));
				if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
				if (sourceFilter !== "all") params.set("source", sourceFilter);
				params.set("sortBy", "updatedAt");
				params.set("includeShared", "true");
				const res = await apiFetch(`${API_BASE}/api/memory?${params}`);
				data = await res.json();
			}

			setMemories(data.entries ?? []);
			setTotal(data.total ?? 0);
		} catch {
			setMemories([]);
			setTotal(0);
		} finally {
			setLoading(false);
		}
	}, [debouncedQuery, searchMode, page, selectedTags, sourceFilter]);

	useEffect(() => {
		fetchMemories();
	}, [fetchMemories]);

	// Refresh stats after mutations
	const refreshStats = useCallback(() => {
		apiFetch(`${API_BASE}/api/memory/stats`)
			.then((r) => r.json())
			.then((data: MemoryStats) => setStats(data))
			.catch(() => {});
		apiFetch(`${API_BASE}/api/memory/tags`)
			.then((r) => r.json())
			.then((data: { tags: { tag: string; count: number }[] }) =>
				setAllTags(data.tags.map((t) => t.tag)),
			)
			.catch(() => {});
	}, []);

	// ── Import ────────────────────────────────────────────────────────

	const handleImportFiles = useCallback(
		async (files: FileList | File[]) => {
			if (importing) return;
			setImporting(true);
			try {
				for (const file of files) {
					const form = new FormData();
					form.append("file", file);
					const res = await apiFetch(`${API_BASE}/api/memory/import`, {
						method: "POST",
						body: form,
					});
					if (!res.ok) {
						console.error(`Import failed for ${file.name}: ${res.status}`);
					}
				}
				fetchMemories();
				refreshStats();
			} catch (err) {
				console.error("Import error:", err);
			} finally {
				setImporting(false);
			}
		},
		[importing, fetchMemories, refreshStats],
	);

	// ── Actions ────────────────────────────────────────────────────────

	const handleCreate = async () => {
		if (!newContent.trim()) return;
		const tags = newTags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const res = await apiFetch(`${API_BASE}/api/memory`, {
			method: "POST",
			body: JSON.stringify({ agentId: "main", content: newContent.trim(), tags }),
		});
		if (!res.ok) {
			console.error(`Create memory failed: ${res.status}`);
			return;
		}
		setShowNewDialog(false);
		setNewContent("");
		setNewTags("");
		fetchMemories();
		refreshStats();
	};

	const handleUpdate = async () => {
		if (!detailMemory) return;
		const tags = editTags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const res = await apiFetch(`${API_BASE}/api/memory/${detailMemory.id}`, {
			method: "PATCH",
			body: JSON.stringify({ content: editContent.trim(), tags }),
		});
		if (!res.ok) {
			console.error(`Update memory failed: ${res.status}`);
			return;
		}
		setDetailMemory(null);
		setEditMode(false);
		fetchMemories();
		refreshStats();
	};

	const handleDelete = async (id: string) => {
		const res = await apiFetch(`${API_BASE}/api/memory/${id}`, { method: "DELETE" });
		if (!res.ok) {
			console.error(`Delete memory failed: ${res.status}`);
			return;
		}
		setDetailMemory(null);
		fetchMemories();
		refreshStats();
	};

	const handleBatchDelete = async () => {
		if (selectedIds.size === 0) return;
		const res = await apiFetch(`${API_BASE}/api/memory/batch`, {
			method: "DELETE",
			body: JSON.stringify({ ids: [...selectedIds] }),
		});
		if (!res.ok) {
			console.error(`Batch delete failed: ${res.status}`);
			return;
		}
		setSelectedIds(new Set());
		fetchMemories();
		refreshStats();
	};

	const handleBatchTags = async () => {
		if (selectedIds.size === 0) return;
		const addTags = batchAddTags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		const removeTags = batchRemoveTags
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		if (addTags.length === 0 && removeTags.length === 0) return;
		const res = await apiFetch(`${API_BASE}/api/memory/batch/tags`, {
			method: "PATCH",
			body: JSON.stringify({ ids: [...selectedIds], addTags, removeTags }),
		});
		if (!res.ok) {
			console.error(`Batch tags failed: ${res.status}`);
			return;
		}
		setShowBatchTagDialog(false);
		setBatchAddTags("");
		setBatchRemoveTags("");
		setSelectedIds(new Set());
		fetchMemories();
		refreshStats();
	};

	const toggleSelect = (id: string) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const toggleSelectAll = () => {
		if (selectedIds.size === memories.length) {
			setSelectedIds(new Set());
		} else {
			setSelectedIds(new Set(memories.map((m) => m.id)));
		}
	};

	const toggleTagFilter = (tag: string) => {
		setSelectedTags((prev) =>
			prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
		);
	};

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
	const isSearching = debouncedQuery.trim().length > 0;

	// Compute visible page numbers
	const pageNumbers = useMemo(() => {
		const pages: number[] = [];
		const start = Math.max(1, page - 2);
		const end = Math.min(totalPages, page + 2);
		for (let i = start; i <= end; i++) pages.push(i);
		return pages;
	}, [page, totalPages]);

	return (
		<div
			className="h-full overflow-y-auto relative"
			onDragOver={(e) => {
				e.preventDefault();
				setDragOver(true);
			}}
			onDragLeave={(e) => {
				if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) {
					setDragOver(false);
				}
			}}
			onDrop={(e) => {
				e.preventDefault();
				setDragOver(false);
				if (e.dataTransfer.files.length) {
					handleImportFiles(e.dataTransfer.files);
				}
			}}
		>
			{dragOver && (
				<div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm border-2 border-dashed border-primary rounded-xl">
					<div className="flex flex-col items-center gap-2 text-primary">
						<Upload className="h-10 w-10" />
						<p className="text-lg font-medium">拖放文件导入知识库</p>
						<p className="text-sm text-muted-foreground">支持 .md, .txt, .json, .csv</p>
					</div>
				</div>
			)}
			<div className="max-w-7xl mx-auto p-6 space-y-6">
				{/* Header */}
				<div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
					<div className="flex items-center gap-3">
						<BookOpen className="h-6 w-6 text-primary" />
						<h1 className="text-2xl font-bold">知识库</h1>
					</div>
					<div className="flex items-center gap-3 w-full sm:w-auto">
						<div className="relative flex-1 sm:w-72">
							<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
							<Input
								placeholder="搜索记忆..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-9"
							/>
							{searchQuery && (
								<button
									type="button"
									onClick={() => setSearchQuery("")}
									className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								>
									<X className="h-3.5 w-3.5" />
								</button>
							)}
						</div>
						<input
							ref={fileInputRef}
							type="file"
							accept=".md,.txt,.json,.csv"
							multiple
							className="hidden"
							onChange={(e) => {
								if (e.target.files?.length) {
									handleImportFiles(e.target.files);
									e.target.value = "";
								}
							}}
						/>
						<Button
							variant="outline"
							onClick={() => fileInputRef.current?.click()}
							disabled={importing}
						>
							<Upload className="h-4 w-4 mr-1" />
							{importing ? "导入中..." : "导入"}
						</Button>
						<Button onClick={() => setShowNewDialog(true)}>
							<Plus className="h-4 w-4 mr-1" />
							新增
						</Button>
					</div>
				</div>

				<div className="flex flex-col lg:flex-row gap-6">
					{/* Stats sidebar */}
					<aside className="lg:w-56 shrink-0 space-y-4">
						<div className="bg-card rounded-xl border border-border p-4 space-y-3">
							<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
								统计
							</h2>
							<div className="text-3xl font-bold">{stats?.total ?? 0}</div>
							<p className="text-xs text-muted-foreground">总记忆数</p>
						</div>

						{stats?.byAgent && Object.keys(stats.byAgent).length > 0 && (
							<div className="bg-card rounded-xl border border-border p-4 space-y-2">
								<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
									按 Agent
								</h3>
								{Object.entries(stats.byAgent).map(([agent, count]) => (
									<div key={agent} className="flex justify-between text-sm">
										<span className="text-muted-foreground truncate">{agent}</span>
										<span className="font-medium">{count}</span>
									</div>
								))}
							</div>
						)}

						{stats?.bySource && Object.keys(stats.bySource).length > 0 && (
							<div className="bg-card rounded-xl border border-border p-4 space-y-2">
								<h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
									按来源
								</h3>
								{Object.entries(stats.bySource).map(([source, count]) => (
									<div key={source} className="flex justify-between text-sm">
										<span className="text-muted-foreground">{source}</span>
										<span className="font-medium">{count}</span>
									</div>
								))}
							</div>
						)}
					</aside>

					{/* Main content */}
					<div className="flex-1 space-y-4">
						{/* Filters bar */}
						<div className="bg-card rounded-xl border border-border p-4 flex flex-wrap items-center gap-3">
							{/* Tag filter */}
							<div className="relative">
								<Button
									variant="outline"
									size="sm"
									onClick={() => setShowTagFilter(!showTagFilter)}
								>
									<Tags className="h-3.5 w-3.5 mr-1" />
									标签
									{selectedTags.length > 0 && (
										<Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
											{selectedTags.length}
										</Badge>
									)}
								</Button>
								{showTagFilter && (
									<div className="absolute top-full left-0 mt-1 z-20 bg-popover border border-border rounded-xl p-3 shadow-lg min-w-[200px] max-h-60 overflow-y-auto">
										{allTags.length === 0 && (
											<p className="text-xs text-muted-foreground">暂无标签</p>
										)}
										<div className="flex flex-wrap gap-1.5">
											{allTags.map((tag) => (
												<button
													type="button"
													key={tag}
													onClick={() => toggleTagFilter(tag)}
													className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
														selectedTags.includes(tag)
															? "bg-primary text-primary-foreground border-primary"
															: tagColor(tag)
													}`}
												>
													{tag}
												</button>
											))}
										</div>
										{selectedTags.length > 0 && (
											<button
												type="button"
												onClick={() => setSelectedTags([])}
												className="mt-2 text-xs text-muted-foreground hover:text-foreground"
											>
												清除筛选
											</button>
										)}
									</div>
								)}
							</div>

							{/* Close tag filter on outside click */}
							{showTagFilter && (
								<div
									className="fixed inset-0 z-10"
									onClick={() => setShowTagFilter(false)}
									onKeyDown={(e) => {
										if (e.key === "Escape") setShowTagFilter(false);
									}}
									role="presentation"
								/>
							)}

							{/* Source filter */}
							<Select value={sourceFilter} onValueChange={setSourceFilter}>
								<SelectTrigger size="sm" className="w-32">
									<SelectValue placeholder="来源" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">全部来源</SelectItem>
									{SOURCES.map((s) => (
										<SelectItem key={s} value={s}>
											{s}
										</SelectItem>
									))}
								</SelectContent>
							</Select>

							{/* Search mode */}
							<div className="flex items-center gap-1 ml-auto">
								<span className="text-xs text-muted-foreground mr-1">搜索模式:</span>
								{(["hybrid", "keyword", "semantic"] as const).map((mode) => (
									<button
										type="button"
										key={mode}
										onClick={() => setSearchMode(mode)}
										className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
											searchMode === mode
												? "bg-primary text-primary-foreground"
												: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
										}`}
									>
										{mode === "hybrid" ? "混合" : mode === "keyword" ? "关键词" : "语义"}
									</button>
								))}
							</div>
						</div>

						{/* Selected tags display */}
						{selectedTags.length > 0 && (
							<div className="flex flex-wrap items-center gap-1.5">
								<span className="text-xs text-muted-foreground">已选标签:</span>
								{selectedTags.map((tag) => (
									<Badge
										key={tag}
										variant="outline"
										className="cursor-pointer"
										onClick={() => toggleTagFilter(tag)}
									>
										{tag}
										<X className="h-2.5 w-2.5 ml-1" />
									</Badge>
								))}
							</div>
						)}

						{/* Batch actions */}
						{selectedIds.size > 0 && (
							<div className="bg-card rounded-xl border border-border p-3 flex items-center gap-3">
								<span className="text-sm text-muted-foreground">已选择 {selectedIds.size} 条</span>
								<Button variant="outline" size="sm" onClick={() => setShowBatchTagDialog(true)}>
									<Tags className="h-3.5 w-3.5 mr-1" />
									批量标签
								</Button>
								<Button variant="destructive" size="sm" onClick={handleBatchDelete}>
									<Trash2 className="h-3.5 w-3.5 mr-1" />
									批量删除
								</Button>
								<button
									type="button"
									onClick={() => setSelectedIds(new Set())}
									className="text-xs text-muted-foreground hover:text-foreground ml-auto"
								>
									取消选择
								</button>
							</div>
						)}

						{/* Memory list */}
						{loading ? (
							<div className="flex items-center justify-center py-20 text-muted-foreground">
								加载中...
							</div>
						) : memories.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-2">
								<BookOpen className="h-10 w-10 opacity-30" />
								<p>{isSearching ? "未找到匹配的记忆" : "暂无记忆"}</p>
							</div>
						) : (
							<div className="space-y-2">
								{/* Select all */}
								<div className="flex items-center gap-2 px-1">
									<button
										type="button"
										onClick={toggleSelectAll}
										className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
											selectedIds.size === memories.length
												? "bg-primary border-primary text-primary-foreground"
												: "border-border hover:border-muted-foreground"
										}`}
									>
										{selectedIds.size === memories.length && <span className="text-[10px]">✓</span>}
									</button>
									<span className="text-xs text-muted-foreground">全选</span>
								</div>

								{memories.map((memory) => (
									// biome-ignore lint/a11y/useSemanticElements: card with click handler
									<div
										key={memory.id}
										className="bg-card rounded-xl border border-border p-4 hover:border-muted-foreground/50 transition-colors cursor-pointer group"
										onClick={() => {
											setDetailMemory(memory);
											setEditMode(false);
											setEditContent(memory.content);
											setEditTags(memory.tags.join(", "));
										}}
										onKeyDown={(e) => {
											if (e.key === "Enter") {
												setDetailMemory(memory);
												setEditMode(false);
												setEditContent(memory.content);
												setEditTags(memory.tags.join(", "));
											}
										}}
										role="button"
										tabIndex={0}
									>
										<div className="flex items-start gap-3">
											{/* Checkbox */}
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													toggleSelect(memory.id);
												}}
												className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
													selectedIds.has(memory.id)
														? "bg-primary border-primary text-primary-foreground"
														: "border-border hover:border-muted-foreground"
												}`}
											>
												{selectedIds.has(memory.id) && <span className="text-[10px]">✓</span>}
											</button>

											{/* Content */}
											<div className="flex-1 min-w-0">
												<p className="text-sm leading-relaxed line-clamp-2">
													{memory.content.slice(0, 150)}
													{memory.content.length > 150 && "..."}
												</p>
												<div className="flex flex-wrap items-center gap-1.5 mt-2">
													{memory.tags.map((tag) => (
														<span
															key={tag}
															className={`px-2 py-0.5 rounded-full text-[10px] border ${tagColor(tag)}`}
														>
															{tag}
														</span>
													))}
													<span className="text-xs text-muted-foreground ml-auto">
														{memory.source}
													</span>
													<span className="text-xs text-muted-foreground">
														· {relativeTime(memory.updatedAt)}
													</span>
												</div>
											</div>
										</div>
									</div>
								))}
							</div>
						)}

						{/* Pagination */}
						{!isSearching && totalPages > 1 && (
							<div className="flex items-center justify-center gap-2 pt-2">
								<Button
									variant="outline"
									size="sm"
									disabled={page <= 1}
									onClick={() => setPage((p) => p - 1)}
								>
									<ChevronLeft className="h-4 w-4" />
								</Button>
								{pageNumbers.map((p) => (
									<button
										type="button"
										key={p}
										onClick={() => setPage(p)}
										className={`w-8 h-8 rounded-lg text-sm transition-colors ${
											p === page
												? "bg-primary text-primary-foreground"
												: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
										}`}
									>
										{p}
									</button>
								))}
								<Button
									variant="outline"
									size="sm"
									disabled={page >= totalPages}
									onClick={() => setPage((p) => p + 1)}
								>
									<ChevronRight className="h-4 w-4" />
								</Button>
							</div>
						)}
					</div>
				</div>
			</div>

			{/* Detail / Edit Dialog */}
			<Dialog
				open={!!detailMemory}
				onOpenChange={(open) => {
					if (!open) {
						setDetailMemory(null);
						setEditMode(false);
					}
				}}
			>
				<DialogContent className="max-w-xl">
					<DialogHeader>
						<DialogTitle>{editMode ? "编辑记忆" : "记忆详情"}</DialogTitle>
					</DialogHeader>
					{detailMemory && !editMode && (
						<div className="space-y-4">
							<p className="text-sm leading-relaxed whitespace-pre-wrap">{detailMemory.content}</p>
							<div className="flex flex-wrap gap-1.5">
								{detailMemory.tags.map((tag) => (
									<span
										key={tag}
										className={`px-2 py-0.5 rounded-full text-xs border ${tagColor(tag)}`}
									>
										{tag}
									</span>
								))}
							</div>
							<div className="flex items-center gap-3 text-xs text-muted-foreground">
								<span>来源: {detailMemory.source}</span>
								<span>Agent: {detailMemory.agentId}</span>
								<span>{relativeTime(detailMemory.updatedAt)}</span>
							</div>
						</div>
					)}
					{detailMemory && editMode && (
						<div className="space-y-4">
							<Textarea
								value={editContent}
								onChange={(e) => setEditContent(e.target.value)}
								rows={6}
								placeholder="记忆内容"
							/>
							<Input
								value={editTags}
								onChange={(e) => setEditTags(e.target.value)}
								placeholder="标签 (逗号分隔)"
							/>
						</div>
					)}
					<DialogFooter>
						{!editMode ? (
							<div className="flex items-center gap-2 w-full">
								<Button variant="outline" size="sm" onClick={() => setEditMode(true)}>
									<Edit3 className="h-3.5 w-3.5 mr-1" />
									编辑
								</Button>
								<Button
									variant="destructive"
									size="sm"
									onClick={() => detailMemory && handleDelete(detailMemory.id)}
								>
									<Trash2 className="h-3.5 w-3.5 mr-1" />
									删除
								</Button>
								<Button
									variant="ghost"
									size="sm"
									className="ml-auto"
									onClick={() => setDetailMemory(null)}
								>
									关闭
								</Button>
							</div>
						) : (
							<div className="flex items-center gap-2 w-full">
								<Button size="sm" onClick={handleUpdate}>
									保存
								</Button>
								<Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>
									取消
								</Button>
							</div>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* New Memory Dialog */}
			<Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
				<DialogContent className="max-w-xl">
					<DialogHeader>
						<DialogTitle>新增记忆</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<Textarea
							value={newContent}
							onChange={(e) => setNewContent(e.target.value)}
							rows={6}
							placeholder="记忆内容..."
						/>
						<Input
							value={newTags}
							onChange={(e) => setNewTags(e.target.value)}
							placeholder="标签 (逗号分隔, 如: preference, user)"
						/>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setShowNewDialog(false)}>
							取消
						</Button>
						<Button onClick={handleCreate} disabled={!newContent.trim()}>
							创建
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Batch Tag Dialog */}
			<Dialog open={showBatchTagDialog} onOpenChange={setShowBatchTagDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>批量标签操作</DialogTitle>
					</DialogHeader>
					<div className="space-y-4">
						<div>
							<label className="text-sm text-muted-foreground mb-1 block">
								添加标签 (逗号分隔)
							</label>
							<Input
								value={batchAddTags}
								onChange={(e) => setBatchAddTags(e.target.value)}
								placeholder="tag1, tag2"
							/>
						</div>
						<div>
							<label className="text-sm text-muted-foreground mb-1 block">
								移除标签 (逗号分隔)
							</label>
							<Input
								value={batchRemoveTags}
								onChange={(e) => setBatchRemoveTags(e.target.value)}
								placeholder="tag1, tag2"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="ghost" onClick={() => setShowBatchTagDialog(false)}>
							取消
						</Button>
						<Button onClick={handleBatchTags}>应用到 {selectedIds.size} 条记忆</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
