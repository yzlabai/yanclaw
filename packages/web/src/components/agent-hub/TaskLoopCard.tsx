import { Badge } from "@yanclaw/web/components/ui/badge";
import { Button } from "@yanclaw/web/components/ui/button";
import type { LoopTask, LoopTaskState } from "@yanclaw/web/hooks/useTaskLoop";
import { cn } from "@yanclaw/web/lib/utils";
import { Check, Clock, Play, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

const stateConfig: Record<LoopTaskState, { color: string; dotClass: string; label: string }> = {
	queued: {
		color: "bg-muted text-muted-foreground",
		dotClass: "bg-gray-400",
		label: "排队中",
	},
	spawning: {
		color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
		dotClass: "bg-blue-500 animate-pulse",
		label: "启动中",
	},
	executing: {
		color: "bg-green-500/20 text-green-400 border-green-500/30",
		dotClass: "bg-green-500 animate-pulse",
		label: "执行中",
	},
	verifying: {
		color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
		dotClass: "bg-cyan-500 animate-pulse",
		label: "验证中",
	},
	evaluating: {
		color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
		dotClass: "bg-cyan-500 animate-pulse",
		label: "评估中",
	},
	iterating: {
		color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
		dotClass: "bg-amber-500 animate-pulse",
		label: "迭代中",
	},
	done: {
		color: "bg-green-500/20 text-green-400 border-green-500/30",
		dotClass: "bg-green-500",
		label: "完成",
	},
	delivering: {
		color: "bg-purple-500/20 text-purple-400 border-purple-500/30",
		dotClass: "bg-purple-500 animate-pulse",
		label: "交付中",
	},
	blocked: {
		color: "bg-red-500/20 text-red-400 border-red-500/30",
		dotClass: "bg-red-500",
		label: "阻塞",
	},
	waiting_confirm: {
		color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
		dotClass: "bg-amber-500 animate-pulse",
		label: "等待确认",
	},
	cancelled: {
		color: "bg-muted text-muted-foreground",
		dotClass: "bg-gray-500",
		label: "已取消",
	},
};

function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m`;
}

interface TaskLoopCardProps {
	task: LoopTask;
	onApprove?: () => void;
	onCancel?: () => void;
	onResume?: () => void;
}

export function TaskLoopCard({ task, onApprove, onCancel, onResume }: TaskLoopCardProps) {
	const config = stateConfig[task.state];
	const isActive = [
		"spawning",
		"executing",
		"verifying",
		"evaluating",
		"iterating",
		"delivering",
	].includes(task.state);
	const [elapsed, setElapsed] = useState(() => Date.now() - (task.startedAt ?? task.createdAt));

	useEffect(() => {
		if (!isActive) return;
		const timer = setInterval(
			() => setElapsed(Date.now() - (task.startedAt ?? task.createdAt)),
			1000,
		);
		return () => clearInterval(timer);
	}, [isActive, task.startedAt, task.createdAt]);

	return (
		<div className="rounded-xl border border-border bg-card p-4 space-y-2">
			{/* Header: status + preset + id */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className={cn("size-2 rounded-full", config.dotClass)} />
					<Badge variant="secondary" className="text-xs">
						{task.preset}
					</Badge>
					<Badge variant="outline" className={cn("text-xs", config.color)}>
						{config.label}
					</Badge>
				</div>
				<span className="text-xs text-muted-foreground font-mono">{task.id.slice(0, 8)}</span>
			</div>

			{/* Prompt */}
			<p className="text-sm truncate">{task.prompt}</p>

			{/* Progress bar */}
			<div className="flex items-center gap-2">
				<div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
					<div
						className="h-full bg-primary rounded-full transition-all duration-300"
						style={{
							width: `${Math.min(100, (task.iteration / task.maxIterations) * 100)}%`,
						}}
					/>
				</div>
				<span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
					<RefreshCw className="size-3 inline mr-0.5" />
					{task.iteration}/{task.maxIterations}
				</span>
			</div>

			{/* Stats + Actions */}
			<div className="flex items-center justify-between">
				<span className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
					<Clock className="size-3" />
					{formatDuration(elapsed)}
				</span>

				<div className="flex gap-1">
					{task.state === "waiting_confirm" && onApprove && (
						<Button variant="outline" size="sm" onClick={onApprove} className="h-6 px-2 text-xs">
							<Check className="size-3 mr-1" />
							批准
						</Button>
					)}
					{task.state === "blocked" && onResume && (
						<Button variant="outline" size="sm" onClick={onResume} className="h-6 px-2 text-xs">
							<Play className="size-3 mr-1" />
							恢复
						</Button>
					)}
					{task.state === "done" && task.deliverResult?.url && (
						<a
							href={task.deliverResult.url}
							target="_blank"
							rel="noopener noreferrer"
							className="text-xs text-primary hover:underline"
						>
							PR
						</a>
					)}
					{!["done", "cancelled"].includes(task.state) && onCancel && (
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={onCancel}
							className="text-muted-foreground hover:text-destructive"
						>
							<X className="size-3" />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
