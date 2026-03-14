import { Badge } from "@yanclaw/web/components/ui/badge";
import { Button } from "@yanclaw/web/components/ui/button";
import type { AgentProcess, AgentProcessStatus } from "@yanclaw/web/hooks/useAgentHub";
import { cn } from "@yanclaw/web/lib/utils";
import { Clock, Monitor, Send, Square } from "lucide-react";
import { useEffect, useState } from "react";

const statusConfig: Record<AgentProcessStatus, { color: string; dotClass: string; label: string }> =
	{
		starting: {
			color: "bg-blue-500/20 text-blue-400 border-blue-500/30",
			dotClass: "bg-blue-500 animate-pulse",
			label: "启动中",
		},
		running: {
			color: "bg-green-500/20 text-green-400 border-green-500/30",
			dotClass: "bg-green-500 animate-pulse",
			label: "运行中",
		},
		"waiting-approval": {
			color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
			dotClass: "bg-amber-500 animate-pulse",
			label: "等待审批",
		},
		idle: {
			color: "bg-muted text-muted-foreground",
			dotClass: "bg-gray-400",
			label: "空闲",
		},
		stopped: {
			color: "bg-muted text-muted-foreground",
			dotClass: "bg-gray-500",
			label: "已停止",
		},
		error: {
			color: "bg-red-500/20 text-red-400 border-red-500/30",
			dotClass: "bg-red-500",
			label: "错误",
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

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1)}k`;
}

interface ProcessCardProps {
	process: AgentProcess;
	selected?: boolean;
	onSelect?: () => void;
	onStop?: () => void;
	onSend?: () => void;
}

export function ProcessCard({ process, selected, onSelect, onStop, onSend }: ProcessCardProps) {
	const config = statusConfig[process.status];
	const [elapsed, setElapsed] = useState(() => Date.now() - process.startedAt);
	const isActive =
		process.status === "running" ||
		process.status === "starting" ||
		process.status === "waiting-approval";

	useEffect(() => {
		if (!isActive) return;
		const timer = setInterval(() => setElapsed(Date.now() - process.startedAt), 1000);
		return () => clearInterval(timer);
	}, [isActive, process.startedAt]);

	return (
		<div
			className={cn(
				"group relative rounded-xl border border-border bg-card p-4 transition-all duration-200 cursor-pointer card-hover",
				selected && "border-l-2 border-l-primary shadow-warm",
			)}
			onClick={onSelect}
			onKeyDown={(e) => e.key === "Enter" && onSelect?.()}
		>
			{/* Header: status dot + name + time */}
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-2">
					<span className={cn("size-2 rounded-full", config.dotClass)} />
					<span className="text-sm font-medium truncate">{process.agentId}</span>
				</div>
				<span className="text-xs text-muted-foreground tabular-nums">
					{new Date(process.startedAt).toLocaleTimeString([], {
						hour: "2-digit",
						minute: "2-digit",
					})}
				</span>
			</div>

			{/* Task description */}
			{process.task && (
				<p className="text-sm text-muted-foreground truncate mb-2">{process.task}</p>
			)}

			{/* Badges: runtime + status */}
			<div className="flex items-center gap-1.5 mb-2">
				<Badge variant="secondary" className="text-xs">
					{process.type}
				</Badge>
				<Badge variant="outline" className={cn("text-xs", config.color)}>
					{config.label}
				</Badge>
			</div>

			{/* Work dir */}
			<p className="text-xs text-muted-foreground truncate mb-2 font-mono">{process.workDir}</p>

			{/* Stats: tokens + duration */}
			<div className="flex items-center gap-3 text-xs text-muted-foreground">
				<span className="flex items-center gap-1 tabular-nums">
					<Monitor className="size-3" />
					{formatTokens(process.tokenUsage.input + process.tokenUsage.output)} tokens
				</span>
				<span className="flex items-center gap-1 tabular-nums">
					<Clock className="size-3" />
					{formatDuration(elapsed)}
				</span>
			</div>

			{/* Hover actions */}
			<div className="absolute bottom-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
				{onSend && process.status === "running" && (
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={(e) => {
							e.stopPropagation();
							onSend();
						}}
					>
						<Send className="size-3" />
					</Button>
				)}
				{onStop && process.status !== "stopped" && process.status !== "error" && (
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={(e) => {
							e.stopPropagation();
							onStop();
						}}
					>
						<Square className="size-3" />
					</Button>
				)}
			</div>
		</div>
	);
}
