import {
	Building2,
	Calendar,
	Check,
	CheckCircle2,
	Clock,
	DollarSign,
	Edit3,
	FileText,
	Package,
	Plus,
	Search,
	Trash2,
	User,
	Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
import { useI18n } from "../i18n";
import { API_BASE, apiFetch } from "../lib/api";

// ── Types ──────────────────────────────────────────

interface PimItem {
	id: string;
	category: string;
	subtype: string | null;
	title: string;
	content: string | null;
	properties: Record<string, unknown>;
	tags: string[];
	status: string | null;
	datetime: string | null;
	confidence: number;
	createdAt: number;
	updatedAt: number;
}

interface PimLink {
	id: string;
	fromId: string;
	toId: string;
	type: string;
	item: PimItem;
}

interface PimItemDetail extends PimItem {
	links: PimLink[];
}

type TabKey =
	| "contacts"
	| "orgs"
	| "schedule"
	| "todos"
	| "ledger"
	| "timeline"
	| "things"
	| "info";

const TABS: { key: TabKey; labelKey: string; icon: typeof User }[] = [
	{ key: "contacts", labelKey: "pim.tabs.contacts", icon: Users },
	{ key: "orgs", labelKey: "pim.tabs.orgs", icon: Building2 },
	{ key: "schedule", labelKey: "pim.tabs.schedule", icon: Calendar },
	{ key: "todos", labelKey: "pim.tabs.todos", icon: CheckCircle2 },
	{ key: "ledger", labelKey: "pim.tabs.ledger", icon: DollarSign },
	{ key: "timeline", labelKey: "pim.tabs.timeline", icon: Clock },
	{ key: "things", labelKey: "pim.tabs.things", icon: Package },
	{ key: "info", labelKey: "pim.tabs.info", icon: FileText },
];

// ── Helpers ────────────────────────────────────────

function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60_000) return "刚刚";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}分钟前`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}小时前`;
	return `${Math.floor(diff / 86_400_000)}天前`;
}

function formatDate(dt: string | null): string {
	if (!dt) return "";
	try {
		const d = new Date(dt);
		return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", weekday: "short" });
	} catch {
		return dt;
	}
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
	const result: Record<string, T[]> = {};
	for (const item of items) {
		const key = keyFn(item);
		if (!result[key]) result[key] = [];
		result[key].push(item);
	}
	return result;
}

const PRIORITY_COLORS: Record<string, string> = {
	high: "bg-red-500/20 text-red-400",
	medium: "bg-yellow-500/20 text-yellow-400",
	low: "bg-green-500/20 text-green-400",
};

// ── Main Component ─────────────────────────────────

export function Pim() {
	const { t } = useI18n();
	const [tab, setTab] = useState<TabKey>("contacts");
	const [items, setItems] = useState<PimItem[]>([]);
	const [search, setSearch] = useState("");
	const [loading, setLoading] = useState(false);
	const [stats, setStats] = useState<Record<string, number>>({});

	// Edit/create dialog
	const [editItem, setEditItem] = useState<PimItemDetail | null>(null);
	const [showCreate, setShowCreate] = useState(false);

	const fetchItems = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (search) params.set("q", search);

			// Map tab to query params
			switch (tab) {
				case "contacts":
					params.set("category", "person");
					break;
				case "orgs":
					params.set("category", "org");
					break;
				case "schedule":
					params.set("category", "event");
					break;
				case "todos":
					params.set("category", "event");
					params.set("subtype", "task");
					break;
				case "ledger":
					params.set("category", "ledger");
					break;
				case "timeline":
					params.set("category", "event");
					break;
				case "things":
					params.set("category", "thing");
					break;
				case "info":
					params.set("category", "info");
					break;
			}

			params.set("limit", "100");
			const res = await apiFetch(`${API_BASE}/api/pim/items?${params}`);
			if (res.ok) {
				setItems(await res.json());
			}
		} finally {
			setLoading(false);
		}
	}, [tab, search]);

	const fetchStats = useCallback(async () => {
		const res = await apiFetch(`${API_BASE}/api/pim/stats`);
		if (res.ok) setStats(await res.json());
	}, []);

	useEffect(() => {
		fetchItems();
	}, [fetchItems]);

	useEffect(() => {
		fetchStats();
	}, [fetchStats]);

	const handleDelete = async (id: string) => {
		await apiFetch(`${API_BASE}/api/pim/items/${id}`, { method: "DELETE" });
		fetchItems();
		fetchStats();
	};

	const handleToggleTodo = async (item: PimItem) => {
		const newStatus = item.status === "done" ? "pending" : "done";
		await apiFetch(`${API_BASE}/api/pim/items/${item.id}`, {
			method: "PATCH",
			body: JSON.stringify({ status: newStatus }),
		});
		fetchItems();
	};

	const handleEdit = async (id: string) => {
		const res = await apiFetch(`${API_BASE}/api/pim/items/${id}`);
		if (res.ok) setEditItem(await res.json());
	};

	return (
		<div className="h-full flex flex-col overflow-hidden">
			{/* Header */}
			<div className="flex items-center justify-between px-6 py-4 border-b border-border">
				<h1 className="text-xl font-bold">{t("pim.title")}</h1>
				<Button size="sm" onClick={() => setShowCreate(true)}>
					<Plus className="h-4 w-4 mr-1" />
					{t("pim.create")}
				</Button>
			</div>

			{/* Tabs */}
			<div className="flex items-center gap-1 px-6 py-2 border-b border-border overflow-x-auto">
				{TABS.map((tb) => {
					const Icon = tb.icon;
					const count = getTabCount(tb.key, stats);
					return (
						<button
							key={tb.key}
							type="button"
							onClick={() => setTab(tb.key)}
							className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm whitespace-nowrap transition-colors ${
								tab === tb.key
									? "bg-accent text-accent-foreground font-medium"
									: "text-muted-foreground hover:text-foreground hover:bg-muted/50"
							}`}
						>
							<Icon className="h-4 w-4" />
							{t(tb.labelKey)}
							{count > 0 && <span className="text-xs opacity-60">({count})</span>}
						</button>
					);
				})}

				{/* Search */}
				<div className="ml-auto flex items-center gap-2">
					<div className="relative">
						<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder={t("pim.search")}
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							className="pl-9 w-48 h-8"
						/>
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto p-6">
				{loading ? (
					<div className="text-center text-muted-foreground py-12">{t("common.loading")}</div>
				) : items.length === 0 ? (
					<div className="text-center text-muted-foreground py-12">{t("pim.empty")}</div>
				) : (
					<>
						{tab === "contacts" && (
							<ContactsView items={items} onEdit={handleEdit} onDelete={handleDelete} />
						)}
						{tab === "orgs" && (
							<OrgsView items={items} onEdit={handleEdit} onDelete={handleDelete} />
						)}
						{tab === "todos" && (
							<TodosView
								items={items}
								onToggle={handleToggleTodo}
								onEdit={handleEdit}
								onDelete={handleDelete}
							/>
						)}
						{tab === "schedule" && <ScheduleView items={items} onEdit={handleEdit} />}
						{tab === "ledger" && <LedgerView items={items} />}
						{tab === "timeline" && <TimelineView items={items} onEdit={handleEdit} />}
						{tab === "things" && (
							<GenericListView items={items} onEdit={handleEdit} onDelete={handleDelete} />
						)}
						{tab === "info" && (
							<GenericListView items={items} onEdit={handleEdit} onDelete={handleDelete} />
						)}
					</>
				)}
			</div>

			{/* Edit Dialog */}
			{editItem && (
				<EditDialog
					item={editItem}
					onClose={() => setEditItem(null)}
					onSaved={() => {
						setEditItem(null);
						fetchItems();
						fetchStats();
					}}
				/>
			)}

			{/* Create Dialog */}
			{showCreate && (
				<CreateDialog
					onClose={() => setShowCreate(false)}
					onCreated={() => {
						setShowCreate(false);
						fetchItems();
						fetchStats();
					}}
				/>
			)}
		</div>
	);
}

function getTabCount(tab: TabKey, stats: Record<string, number>): number {
	switch (tab) {
		case "contacts":
			return stats.person ?? 0;
		case "orgs":
			return stats.org ?? 0;
		case "schedule":
		case "timeline":
		case "todos":
			return stats.event ?? 0;
		case "ledger":
			return stats.ledger ?? 0;
		case "things":
			return stats.thing ?? 0;
		case "info":
			return stats.info ?? 0;
		default:
			return 0;
	}
}

// ── Contacts View ──────────────────────────────────

function ContactsView({
	items,
	onEdit,
	onDelete,
}: {
	items: PimItem[];
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const grouped = groupBy(items, (i) =>
		String((i.properties as Record<string, unknown>).relation ?? "其他"),
	);

	return (
		<div className="space-y-6">
			{Object.entries(grouped).map(([relation, group]) => (
				<div key={relation}>
					<h3 className="text-sm font-medium text-muted-foreground mb-2">
						{relation} ({group.length})
					</h3>
					<div className="space-y-2">
						{group.map((item) => {
							const props = item.properties as Record<string, unknown>;
							return (
								<div
									key={item.id}
									className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors"
								>
									<User className="h-5 w-5 text-blue-400 shrink-0" />
									<div className="flex-1 min-w-0">
										<div className="font-medium">{item.title}</div>
										<div className="text-xs text-muted-foreground">
											{[props.org, props.role].filter(Boolean).join(" · ")}
										</div>
									</div>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											onClick={() => onEdit(item.id)}
										>
											<Edit3 className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7 text-destructive"
											onClick={() => onDelete(item.id)}
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

// ── Orgs View ──────────────────────────────────────

function OrgsView({
	items,
	onEdit,
	onDelete,
}: {
	items: PimItem[];
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const grouped = groupBy(items, (i) =>
		String((i.properties as Record<string, unknown>).relation ?? "其他"),
	);

	return (
		<div className="space-y-6">
			{Object.entries(grouped).map(([relation, group]) => (
				<div key={relation}>
					<h3 className="text-sm font-medium text-muted-foreground mb-2">
						{relation} ({group.length})
					</h3>
					<div className="space-y-2">
						{group.map((item) => {
							const props = item.properties as Record<string, unknown>;
							return (
								<div
									key={item.id}
									className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30"
								>
									<Building2 className="h-5 w-5 text-orange-400 shrink-0" />
									<div className="flex-1 min-w-0">
										<div className="font-medium">{item.title}</div>
										<div className="text-xs text-muted-foreground">
											{[props.industry, props.location, item.subtype].filter(Boolean).join(" · ")}
										</div>
									</div>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											onClick={() => onEdit(item.id)}
										>
											<Edit3 className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7 text-destructive"
											onClick={() => onDelete(item.id)}
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			))}
		</div>
	);
}

// ── Todos View ─────────────────────────────────────

function TodosView({
	items,
	onToggle,
	onEdit,
	onDelete,
}: {
	items: PimItem[];
	onToggle: (item: PimItem) => void;
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	const pending = items.filter((i) => i.status !== "done");
	const done = items.filter((i) => i.status === "done");

	return (
		<div className="space-y-6">
			{pending.length > 0 && (
				<div>
					<h3 className="text-sm font-medium text-muted-foreground mb-2">
						待完成 ({pending.length})
					</h3>
					<div className="space-y-2">
						{pending.map((item) => {
							const priority = String((item.properties as Record<string, unknown>).priority ?? "");
							return (
								<div
									key={item.id}
									className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30"
								>
									<button type="button" onClick={() => onToggle(item)} className="shrink-0">
										<div className="h-5 w-5 rounded-full border-2 border-muted-foreground hover:border-primary" />
									</button>
									<div className="flex-1 min-w-0">
										<div className="font-medium flex items-center gap-2">
											{priority && (
												<Badge className={`text-[10px] ${PRIORITY_COLORS[priority] ?? ""}`}>
													{priority}
												</Badge>
											)}
											{item.title}
										</div>
										{item.datetime && (
											<div className="text-xs text-muted-foreground">
												截止: {formatDate(item.datetime)}
											</div>
										)}
									</div>
									<div className="flex items-center gap-1">
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7"
											onClick={() => onEdit(item.id)}
										>
											<Edit3 className="h-3.5 w-3.5" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7 text-destructive"
											onClick={() => onDelete(item.id)}
										>
											<Trash2 className="h-3.5 w-3.5" />
										</Button>
									</div>
								</div>
							);
						})}
					</div>
				</div>
			)}

			{done.length > 0 && (
				<div>
					<h3 className="text-sm font-medium text-muted-foreground mb-2">已完成 ({done.length})</h3>
					<div className="space-y-1">
						{done.map((item) => (
							<div
								key={item.id}
								className="flex items-center gap-3 p-2 rounded-lg text-muted-foreground"
							>
								<button type="button" onClick={() => onToggle(item)} className="shrink-0">
									<Check className="h-5 w-5 text-green-500" />
								</button>
								<span className="line-through text-sm">{item.title}</span>
								{item.datetime && (
									<span className="text-xs ml-auto">{formatDate(item.datetime)}</span>
								)}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

// ── Schedule View ──────────────────────────────────

function ScheduleView({ items, onEdit }: { items: PimItem[]; onEdit: (id: string) => void }) {
	// Filter to non-task events with datetime, group by date
	const events = items.filter((i) => i.subtype !== "task" && i.datetime);
	const grouped = groupBy(events, (i) => (i.datetime ?? "").split("T")[0]);
	const sortedDates = Object.keys(grouped).sort();

	return (
		<div className="space-y-6">
			{sortedDates.map((date) => (
				<div key={date}>
					<h3 className="text-sm font-medium text-muted-foreground mb-2">{formatDate(date)}</h3>
					<div className="space-y-2 pl-4 border-l-2 border-border">
						{grouped[date].map((item) => (
							<div
								key={item.id}
								className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 cursor-pointer"
								onClick={() => onEdit(item.id)}
								onKeyDown={() => {}}
							>
								<Calendar className="h-4 w-4 text-blue-400 shrink-0" />
								<div className="flex-1">
									<div className="text-sm font-medium">{item.title}</div>
									{item.subtype && (
										<span className="text-xs text-muted-foreground">{item.subtype}</span>
									)}
								</div>
								{item.datetime?.includes("T") && (
									<span className="text-xs text-muted-foreground">
										{item.datetime.split("T")[1]?.slice(0, 5)}
									</span>
								)}
							</div>
						))}
					</div>
				</div>
			))}
			{sortedDates.length === 0 && (
				<div className="text-center text-muted-foreground py-8">暂无日程</div>
			)}
		</div>
	);
}

// ── Ledger View ────────────────────────────────────

function LedgerView({ items }: { items: PimItem[] }) {
	let totalIncome = 0;
	let totalExpense = 0;

	for (const item of items) {
		const props = item.properties as Record<string, unknown>;
		const amount = Number(props.amount) || 0;
		const direction = String(props.direction ?? "expense");
		if (direction === "income") totalIncome += amount;
		else if (direction === "expense") totalExpense += amount;
	}

	// Group by category
	const byCategory: Record<string, number> = {};
	for (const item of items) {
		const props = item.properties as Record<string, unknown>;
		const cat = String(props.category ?? "其他");
		const amount = Number(props.amount) || 0;
		byCategory[cat] = (byCategory[cat] ?? 0) + amount;
	}

	return (
		<div className="space-y-6">
			{/* Summary cards */}
			<div className="grid grid-cols-3 gap-4">
				<div className="p-4 rounded-lg border border-border">
					<div className="text-xs text-muted-foreground">支出</div>
					<div className="text-xl font-bold text-red-400">&yen;{totalExpense.toLocaleString()}</div>
				</div>
				<div className="p-4 rounded-lg border border-border">
					<div className="text-xs text-muted-foreground">收入</div>
					<div className="text-xl font-bold text-green-400">
						&yen;{totalIncome.toLocaleString()}
					</div>
				</div>
				<div className="p-4 rounded-lg border border-border">
					<div className="text-xs text-muted-foreground">结余</div>
					<div className="text-xl font-bold">
						&yen;{(totalIncome - totalExpense).toLocaleString()}
					</div>
				</div>
			</div>

			{/* Category breakdown */}
			{Object.keys(byCategory).length > 0 && (
				<div>
					<h3 className="text-sm font-medium text-muted-foreground mb-2">按分类</h3>
					<div className="space-y-2">
						{Object.entries(byCategory)
							.sort(([, a], [, b]) => b - a)
							.map(([cat, amount]) => {
								const pct =
									totalExpense > 0 ? Math.round((amount / (totalExpense + totalIncome)) * 100) : 0;
								return (
									<div key={cat} className="flex items-center gap-3">
										<span className="text-sm w-16 shrink-0">{cat}</span>
										<div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
											<div
												className="h-full bg-primary rounded-full"
												style={{ width: `${pct}%` }}
											/>
										</div>
										<span className="text-sm text-muted-foreground w-24 text-right">
											&yen;{amount.toLocaleString()} ({pct}%)
										</span>
									</div>
								);
							})}
					</div>
				</div>
			)}

			{/* Detail list */}
			<div>
				<h3 className="text-sm font-medium text-muted-foreground mb-2">明细</h3>
				<div className="space-y-1">
					{items.map((item) => {
						const props = item.properties as Record<string, unknown>;
						const direction = String(props.direction ?? "expense");
						const isIncome = direction === "income";
						return (
							<div
								key={item.id}
								className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30"
							>
								<DollarSign
									className={`h-4 w-4 shrink-0 ${isIncome ? "text-green-400" : "text-red-400"}`}
								/>
								<div className="flex-1 min-w-0">
									<div className="text-sm">{item.title}</div>
									<div className="text-xs text-muted-foreground">
										{[props.category, props.method, item.datetime].filter(Boolean).join(" · ")}
									</div>
								</div>
								<span
									className={`text-sm font-medium ${isIncome ? "text-green-400" : "text-red-400"}`}
								>
									{isIncome ? "+" : "-"}&yen;{Number(props.amount ?? 0).toLocaleString()}
								</span>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}

// ── Timeline View ──────────────────────────────────

function TimelineView({ items, onEdit }: { items: PimItem[]; onEdit: (id: string) => void }) {
	const withDatetime = items.filter((i) => i.datetime);
	const grouped = groupBy(withDatetime, (i) => (i.datetime ?? "").split("T")[0]);
	const sortedDates = Object.keys(grouped).sort();

	const SUBTYPE_ICONS: Record<string, string> = {
		meeting: "\uD83D\uDCC5",
		interaction: "\uD83E\uDD1D",
		task: "\u2610",
		trip: "\u2708\uFE0F",
		purchase: "\uD83D\uDED2",
	};

	return (
		<div className="space-y-6">
			{sortedDates.map((date) => (
				<div key={date}>
					<h3 className="text-sm font-medium text-muted-foreground mb-2">{formatDate(date)}</h3>
					<div className="space-y-1 pl-4 border-l-2 border-border">
						{grouped[date].map((item) => (
							<div
								key={item.id}
								className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/30 cursor-pointer"
								onClick={() => onEdit(item.id)}
								onKeyDown={() => {}}
							>
								<span className="text-sm">{SUBTYPE_ICONS[item.subtype ?? ""] ?? "\u2022"}</span>
								<span className="text-sm">{item.title}</span>
								{item.status === "pending" && (
									<Badge variant="outline" className="text-[10px]">
										待办
									</Badge>
								)}
							</div>
						))}
					</div>
				</div>
			))}
			{sortedDates.length === 0 && (
				<div className="text-center text-muted-foreground py-8">暂无事件</div>
			)}
		</div>
	);
}

// ── Generic List View ──────────────────────────────

function GenericListView({
	items,
	onEdit,
	onDelete,
}: {
	items: PimItem[];
	onEdit: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<div className="space-y-2">
			{items.map((item) => (
				<div
					key={item.id}
					className="flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-muted/30"
				>
					<div className="flex-1 min-w-0">
						<div className="font-medium flex items-center gap-2">
							{item.title}
							{item.subtype && (
								<Badge variant="outline" className="text-[10px]">
									{item.subtype}
								</Badge>
							)}
						</div>
						{item.content && (
							<div className="text-xs text-muted-foreground line-clamp-1">{item.content}</div>
						)}
						<div className="text-xs text-muted-foreground mt-0.5">
							{relativeTime(item.updatedAt)}
						</div>
					</div>
					<div className="flex items-center gap-1">
						<Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(item.id)}>
							<Edit3 className="h-3.5 w-3.5" />
						</Button>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 text-destructive"
							onClick={() => onDelete(item.id)}
						>
							<Trash2 className="h-3.5 w-3.5" />
						</Button>
					</div>
				</div>
			))}
		</div>
	);
}

// ── Edit Dialog ────────────────────────────────────

function EditDialog({
	item,
	onClose,
	onSaved,
}: {
	item: PimItemDetail;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [title, setTitle] = useState(item.title);
	const [content, setContent] = useState(item.content ?? "");
	const [status, setStatus] = useState(item.status ?? "");
	const [datetime, setDatetime] = useState(item.datetime ?? "");
	const [propsJson, setPropsJson] = useState(JSON.stringify(item.properties, null, 2));
	const [saving, setSaving] = useState(false);

	const handleSave = async () => {
		setSaving(true);
		try {
			let properties: Record<string, unknown> = {};
			try {
				properties = JSON.parse(propsJson);
			} catch {
				// keep existing
				properties = item.properties;
			}
			await apiFetch(`${API_BASE}/api/pim/items/${item.id}`, {
				method: "PATCH",
				body: JSON.stringify({
					title,
					content: content || undefined,
					status: status || undefined,
					datetime: datetime || undefined,
					properties,
				}),
			});
			onSaved();
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent className="max-w-lg">
				<DialogHeader>
					<DialogTitle>
						编辑 [{item.category}
						{item.subtype ? `:${item.subtype}` : ""}]
					</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题" />
					<Textarea
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="内容/描述"
						rows={2}
					/>
					<div className="grid grid-cols-2 gap-3">
						<Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="状态" />
						<Input
							value={datetime}
							onChange={(e) => setDatetime(e.target.value)}
							placeholder="时间 (ISO)"
						/>
					</div>
					<div>
						<label className="text-xs text-muted-foreground">属性 (JSON)</label>
						<Textarea
							value={propsJson}
							onChange={(e) => setPropsJson(e.target.value)}
							rows={4}
							className="font-mono text-xs"
						/>
					</div>

					{/* Linked items */}
					{item.links.length > 0 && (
						<div>
							<label className="text-xs text-muted-foreground">关联 ({item.links.length})</label>
							<div className="space-y-1 mt-1">
								{item.links.map((link) => (
									<div
										key={link.id}
										className="text-xs flex items-center gap-2 p-1.5 rounded bg-muted/30"
									>
										<span className="text-muted-foreground">{link.type}</span>
										<span>
											[{link.item.category}] {link.item.title}
										</span>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button onClick={handleSave} disabled={saving}>
						{saving ? "保存中..." : "保存"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

// ── Create Dialog ──────────────────────────────────

const CATEGORIES = [
	{ value: "person", label: "人" },
	{ value: "event", label: "事" },
	{ value: "thing", label: "物" },
	{ value: "place", label: "地" },
	{ value: "time", label: "时" },
	{ value: "info", label: "信息" },
	{ value: "org", label: "组织" },
	{ value: "ledger", label: "账" },
];

function CreateDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
	const [category, setCategory] = useState("person");
	const [subtype, setSubtype] = useState("");
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	const [datetime, setDatetime] = useState("");
	const [status, setStatus] = useState("");
	const [saving, setSaving] = useState(false);

	const handleCreate = async () => {
		if (!title.trim()) return;
		setSaving(true);
		try {
			await apiFetch(`${API_BASE}/api/pim/items`, {
				method: "POST",
				body: JSON.stringify({
					category,
					subtype: subtype || undefined,
					title: title.trim(),
					content: content || undefined,
					datetime: datetime || undefined,
					status: status || undefined,
				}),
			});
			onCreated();
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog open onOpenChange={onClose}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>新建条目</DialogTitle>
				</DialogHeader>
				<div className="space-y-3">
					<Select value={category} onValueChange={setCategory}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{CATEGORIES.map((c) => (
								<SelectItem key={c.value} value={c.value}>
									{c.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						value={subtype}
						onChange={(e) => setSubtype(e.target.value)}
						placeholder="子类型 (如 client, meeting, product)"
					/>
					<Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="标题 *" />
					<Textarea
						value={content}
						onChange={(e) => setContent(e.target.value)}
						placeholder="内容/描述"
						rows={2}
					/>
					<div className="grid grid-cols-2 gap-3">
						<Input
							value={datetime}
							onChange={(e) => setDatetime(e.target.value)}
							placeholder="时间 (YYYY-MM-DD)"
						/>
						<Input value={status} onChange={(e) => setStatus(e.target.value)} placeholder="状态" />
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						取消
					</Button>
					<Button onClick={handleCreate} disabled={saving || !title.trim()}>
						{saving ? "创建中..." : "创建"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
