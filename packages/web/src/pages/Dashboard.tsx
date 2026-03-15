import {
	AlertCircle,
	AlertTriangle,
	ChevronDown,
	ChevronRight,
	RefreshCw,
	TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { useI18n } from "../i18n";
import { API_BASE, apiFetch } from "../lib/api";

interface StoredError {
	id: string;
	timestamp: number;
	module: string;
	severity: "error" | "warn";
	code: string;
	message: string;
	context?: Record<string, unknown>;
	stackTrace?: string;
	createdAt: number;
}

interface ErrorStats {
	last24h: { error: number; warn: number };
	byModule: Record<string, number>;
}

interface ErrorsResponse {
	errors: StoredError[];
	total: number;
	stats: ErrorStats;
}

type TimeRange = "1h" | "24h" | "7d";
type SeverityFilter = "all" | "error" | "warn";

const MODULES = ["agent", "channel", "security", "config", "plugin", "memory", "cron", "system"];

const MODULE_COLORS: Record<string, string> = {
	agent: "bg-blue-500",
	channel: "bg-green-500",
	security: "bg-red-500",
	config: "bg-yellow-500",
	plugin: "bg-purple-500",
	memory: "bg-cyan-500",
	cron: "bg-orange-500",
	system: "bg-zinc-500",
};

function timeRangeToSince(range: TimeRange): number {
	const now = Date.now();
	switch (range) {
		case "1h":
			return now - 3600_000;
		case "24h":
			return now - 86400_000;
		case "7d":
			return now - 604800_000;
	}
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const now = Date.now();
	const diffMs = now - ts;
	const diffMin = Math.floor(diffMs / 60000);
	if (diffMin < 1) return "just now";
	if (diffMin < 60) return `${diffMin}m ago`;
	const diffHr = Math.floor(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h ago`;
	return d.toLocaleDateString([], {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

export function Dashboard() {
	const { t } = useI18n();
	const [errors, setErrors] = useState<StoredError[]>([]);
	const [total, setTotal] = useState(0);
	const [stats, setStats] = useState<ErrorStats | null>(null);
	const [severity, setSeverity] = useState<SeverityFilter>("all");
	const [module, setModule] = useState("");
	const [timeRange, setTimeRange] = useState<TimeRange>("24h");
	const [offset, setOffset] = useState(0);
	const [loading, setLoading] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [autoRefresh, setAutoRefresh] = useState(true);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const limit = 50;

	const fetchErrors = useCallback(async () => {
		setLoading(true);
		try {
			const params = new URLSearchParams();
			if (severity !== "all") params.set("severity", severity);
			if (module) params.set("module", module);
			params.set("since", String(timeRangeToSince(timeRange)));
			params.set("limit", String(limit));
			params.set("offset", "0");

			const res = await apiFetch(`${API_BASE}/api/system/errors?${params}`);
			if (!res.ok) throw new Error(`${res.status}`);
			const data: ErrorsResponse = await res.json();

			setErrors(data.errors);
			setTotal(data.total);
			setStats(data.stats);
			setOffset(0);
		} catch {
			// API may not be available yet
		} finally {
			setLoading(false);
		}
	}, [severity, module, timeRange]);

	// Initial fetch + filter changes
	useEffect(() => {
		fetchErrors();
	}, [fetchErrors]);

	// Auto-refresh polling
	useEffect(() => {
		if (intervalRef.current) clearInterval(intervalRef.current);
		if (autoRefresh) {
			intervalRef.current = setInterval(() => {
				fetchErrors();
			}, 30_000);
		}
		return () => {
			if (intervalRef.current) clearInterval(intervalRef.current);
		};
	}, [autoRefresh, fetchErrors]);

	const loadMore = () => {
		const newOffset = offset + limit;
		setOffset(newOffset);
		// Fetch with append
		const params = new URLSearchParams();
		if (severity !== "all") params.set("severity", severity);
		if (module) params.set("module", module);
		params.set("since", String(timeRangeToSince(timeRange)));
		params.set("limit", String(limit));
		params.set("offset", String(newOffset));

		setLoading(true);
		apiFetch(`${API_BASE}/api/system/errors?${params}`)
			.then((res) => res.json())
			.then((data: ErrorsResponse) => {
				setErrors((prev) => [...prev, ...data.errors]);
				setTotal(data.total);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	};

	const errorCount = stats?.last24h.error ?? 0;
	const warnCount = stats?.last24h.warn ?? 0;
	const totalCount = errorCount + warnCount;
	const byModule = stats?.byModule ?? {};
	const maxModuleCount = Math.max(1, ...Object.values(byModule));

	return (
		<div className="p-6 h-full flex flex-col overflow-y-auto animate-fade-in-up">
			{/* Header */}
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">{t("nav.dashboard")}</h2>
				<div className="flex items-center gap-2">
					<label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
						<input
							type="checkbox"
							checked={autoRefresh}
							onChange={(e) => setAutoRefresh(e.target.checked)}
							className="rounded"
						/>
						{t("dashboard.autoRefresh")}
					</label>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => fetchErrors()}
						disabled={loading}
						className="text-muted-foreground"
					>
						<RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
					</Button>
				</div>
			</div>

			{/* Stats cards */}
			<div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
				<div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
					<div className="flex items-center gap-2 text-red-400 mb-1">
						<AlertCircle className="size-4" />
						<span className="text-sm font-medium">{t("dashboard.errors24h")}</span>
					</div>
					<span className="text-2xl font-bold text-foreground">{errorCount}</span>
				</div>
				<div className="rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4">
					<div className="flex items-center gap-2 text-yellow-400 mb-1">
						<AlertTriangle className="size-4" />
						<span className="text-sm font-medium">{t("dashboard.warnings24h")}</span>
					</div>
					<span className="text-2xl font-bold text-foreground">{warnCount}</span>
				</div>
				<div className="rounded-xl border border-border bg-muted/30 p-4">
					<div className="flex items-center gap-2 text-muted-foreground mb-1">
						<TrendingUp className="size-4" />
						<span className="text-sm font-medium">{t("dashboard.total24h")}</span>
					</div>
					<span className="text-2xl font-bold text-foreground">{totalCount}</span>
				</div>
			</div>

			{/* Module distribution */}
			{Object.keys(byModule).length > 0 && (
				<div className="mb-6">
					<h3 className="text-sm font-medium text-muted-foreground mb-3">
						{t("dashboard.moduleDistribution")}
					</h3>
					<div className="space-y-2">
						{Object.entries(byModule)
							.sort(([, a], [, b]) => b - a)
							.map(([mod, count]) => (
								<div key={mod} className="flex items-center gap-3">
									<span className="text-xs text-muted-foreground w-20 text-right">{mod}</span>
									<div className="flex-1 bg-muted/30 rounded-full h-2 overflow-hidden">
										<div
											className={`h-full rounded-full transition-all ${MODULE_COLORS[mod] ?? "bg-zinc-500"}`}
											style={{ width: `${(count / maxModuleCount) * 100}%` }}
										/>
									</div>
									<span className="text-xs text-muted-foreground w-8">{count}</span>
								</div>
							))}
					</div>
				</div>
			)}

			{/* Filters */}
			<div className="flex flex-wrap items-center gap-3 mb-4">
				<select
					value={severity}
					onChange={(e) => setSeverity(e.target.value as SeverityFilter)}
					className="bg-muted rounded-xl border border-input px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
				>
					<option value="all">{t("dashboard.severityAll")}</option>
					<option value="error">{t("dashboard.severityError")}</option>
					<option value="warn">{t("dashboard.severityWarn")}</option>
				</select>

				<select
					value={module}
					onChange={(e) => setModule(e.target.value)}
					className="bg-muted rounded-xl border border-input px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
				>
					<option value="">{t("dashboard.moduleAll")}</option>
					{MODULES.map((m) => (
						<option key={m} value={m}>
							{m}
						</option>
					))}
				</select>

				<div className="flex rounded-xl border border-input overflow-hidden">
					{(["1h", "24h", "7d"] as TimeRange[]).map((r) => (
						<button
							key={r}
							type="button"
							onClick={() => setTimeRange(r)}
							className={`px-3 py-1.5 text-sm transition-colors ${
								timeRange === r
									? "bg-primary text-primary-foreground"
									: "bg-muted text-muted-foreground hover:text-foreground"
							}`}
						>
							{r}
						</button>
					))}
				</div>

				<span className="text-xs text-muted-foreground ml-auto">
					{total} {t("dashboard.results")}
				</span>
			</div>

			{/* Error list */}
			<div className="flex-1 space-y-1">
				{errors.length === 0 && !loading ? (
					<div className="text-muted-foreground text-center mt-20">{t("dashboard.noErrors")}</div>
				) : (
					errors.map((err) => {
						const isExpanded = expandedId === err.id;
						return (
							<div key={err.id} className="rounded-xl border border-border overflow-hidden">
								<button
									type="button"
									onClick={() => setExpandedId(isExpanded ? null : err.id)}
									className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 border-l-2 ${
										err.severity === "error" ? "border-l-red-500" : "border-l-yellow-500"
									}`}
								>
									{err.severity === "error" ? (
										<AlertCircle className="size-4 text-red-400 shrink-0" />
									) : (
										<AlertTriangle className="size-4 text-yellow-400 shrink-0" />
									)}
									<span className="text-xs text-muted-foreground shrink-0 w-16">
										{formatTime(err.timestamp)}
									</span>
									<span className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground shrink-0">
										{err.module}
									</span>
									{err.code && (
										<span className="text-xs font-mono text-muted-foreground/70 shrink-0">
											{err.code}
										</span>
									)}
									<span className="text-sm text-foreground truncate flex-1">{err.message}</span>
									{isExpanded ? (
										<ChevronDown className="size-4 text-muted-foreground shrink-0" />
									) : (
										<ChevronRight className="size-4 text-muted-foreground shrink-0" />
									)}
								</button>
								{isExpanded && (
									<div className="px-4 py-3 bg-muted/20 border-t border-border space-y-3">
										{err.context && Object.keys(err.context).length > 0 && (
											<div>
												<h4 className="text-xs font-medium text-muted-foreground mb-1">
													{t("dashboard.context")}
												</h4>
												<pre className="text-xs text-foreground/80 bg-muted/50 rounded-lg p-3 overflow-x-auto max-h-40">
													{JSON.stringify(err.context, null, 2)}
												</pre>
											</div>
										)}
										{err.stackTrace && (
											<div>
												<h4 className="text-xs font-medium text-muted-foreground mb-1">
													{t("dashboard.stackTrace")}
												</h4>
												<pre className="text-xs text-foreground/80 bg-muted/50 rounded-lg p-3 overflow-x-auto max-h-60 whitespace-pre-wrap">
													{err.stackTrace}
												</pre>
											</div>
										)}
										<div className="text-xs text-muted-foreground">
											ID: {err.id} | {new Date(err.timestamp).toISOString()}
										</div>
									</div>
								)}
							</div>
						);
					})
				)}
			</div>

			{/* Load more */}
			{errors.length < total && (
				<div className="mt-4 pt-4 border-t border-border flex justify-center">
					<Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
						{loading ? t("common.loading") : t("dashboard.loadMore")}
					</Button>
				</div>
			)}
		</div>
	);
}
