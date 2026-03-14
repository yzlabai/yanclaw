import { ApprovalQueue } from "@yanclaw/web/components/agent-hub/ApprovalQueue";
import { ProcessCard } from "@yanclaw/web/components/agent-hub/ProcessCard";
import { ProcessDetail } from "@yanclaw/web/components/agent-hub/ProcessDetail";
import { SpawnDialog } from "@yanclaw/web/components/agent-hub/SpawnDialog";
import { TaskDAGView } from "@yanclaw/web/components/agent-hub/TaskDAGView";
import { Badge } from "@yanclaw/web/components/ui/badge";
import { Button } from "@yanclaw/web/components/ui/button";
import { Input } from "@yanclaw/web/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@yanclaw/web/components/ui/select";
import { Skeleton } from "@yanclaw/web/components/ui/skeleton";
import { useAgentHub } from "@yanclaw/web/hooks/useAgentHub";
import { AlertTriangle, GitFork, Monitor, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

export function AgentHub() {
	const { processes, pendingApprovals, loading, spawn, stop, send, approve, startDAG, listDAGs } =
		useAgentHub();
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [spawnOpen, setSpawnOpen] = useState(false);
	const [approvalOpen, setApprovalOpen] = useState(false);
	const [showDAGs, setShowDAGs] = useState(false);
	const [dags, setDags] = useState<Awaited<ReturnType<typeof listDAGs>>>([]);
	const [statusFilter, setStatusFilter] = useState<string>("all");
	const [search, setSearch] = useState("");

	// Load DAGs
	useEffect(() => {
		if (showDAGs) {
			listDAGs().then(setDags);
		}
	}, [showDAGs, listDAGs]);

	const selectedProcess = processes.find((p) => p.id === selectedId) ?? null;

	// Filter processes
	const filteredProcesses = processes.filter((p) => {
		if (statusFilter !== "all" && p.status !== statusFilter) return false;
		if (search) {
			const q = search.toLowerCase();
			return (
				p.agentId.toLowerCase().includes(q) ||
				p.task?.toLowerCase().includes(q) ||
				p.workDir.toLowerCase().includes(q)
			);
		}
		return true;
	});

	const handleSpawn = useCallback(
		async (config: Parameters<typeof spawn>[0]) => {
			const proc = await spawn(config);
			setSelectedId(proc.id);
		},
		[spawn],
	);

	const handleStop = useCallback(
		async (processId: string) => {
			await stop(processId);
		},
		[stop],
	);

	const handleSend = useCallback(
		async (processId: string, message: string) => {
			await send(processId, message);
		},
		[send],
	);

	const handleApprove = useCallback(
		(processId: string, requestId: string, allowed: boolean) => {
			approve(processId, requestId, allowed);
		},
		[approve],
	);

	return (
		<div className="flex flex-col h-full animate-fade-in-up">
			{/* Toolbar */}
			<div className="flex items-center gap-2 p-4 border-b border-border flex-wrap">
				<Button onClick={() => setSpawnOpen(true)}>
					<Plus className="size-4" />
					启动 Agent
				</Button>

				<Select value={statusFilter} onValueChange={setStatusFilter}>
					<SelectTrigger className="w-32">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">全部</SelectItem>
						<SelectItem value="running">运行中</SelectItem>
						<SelectItem value="waiting-approval">等待审批</SelectItem>
						<SelectItem value="idle">已完成</SelectItem>
						<SelectItem value="error">出错</SelectItem>
						<SelectItem value="stopped">已停止</SelectItem>
					</SelectContent>
				</Select>

				<div className="relative">
					<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
					<Input
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="搜索任务..."
						className="pl-8 w-48"
					/>
				</div>

				<div className="flex-1" />

				<Button variant={showDAGs ? "default" : "outline"} onClick={() => setShowDAGs((v) => !v)}>
					<GitFork className="size-4" />
					DAG
				</Button>

				<Button variant="outline" onClick={() => setApprovalOpen(true)} className="relative">
					<AlertTriangle className="size-4" />
					审批
					{pendingApprovals.length > 0 && (
						<Badge
							variant="default"
							className="ml-1 bg-red-500 text-white text-xs px-1.5 py-0 min-w-0 animate-pulse"
						>
							{pendingApprovals.length}
						</Badge>
					)}
				</Button>
			</div>

			{/* Main content */}
			<div className="flex flex-1 min-h-0">
				{/* Process list */}
				<div className="w-80 border-r border-border overflow-y-auto p-3 space-y-2 shrink-0 hidden lg:block">
					{loading && (
						<>
							<Skeleton className="h-28 rounded-xl" />
							<Skeleton className="h-28 rounded-xl" />
							<Skeleton className="h-28 rounded-xl" />
						</>
					)}

					{!loading && filteredProcesses.length === 0 && (
						<EmptyState onSpawn={() => setSpawnOpen(true)} />
					)}

					{filteredProcesses.map((p) => (
						<ProcessCard
							key={p.id}
							process={p}
							selected={p.id === selectedId}
							onSelect={() => setSelectedId(p.id)}
							onStop={() => handleStop(p.id)}
							onSend={() => setSelectedId(p.id)}
						/>
					))}
				</div>

				{/* Detail panel */}
				<div className="flex-1 min-w-0">
					{showDAGs ? (
						<div className="p-4 overflow-y-auto h-full">
							<TaskDAGView
								dags={dags}
								onCreateDAG={async (dag) => {
									await startDAG(dag);
									const updated = await listDAGs();
									setDags(updated);
								}}
								onSelectProcess={(pid) => {
									setSelectedId(pid);
									setShowDAGs(false);
								}}
							/>
						</div>
					) : selectedProcess ? (
						<ProcessDetail
							process={selectedProcess}
							onStop={() => handleStop(selectedProcess.id)}
							onSend={(msg) => handleSend(selectedProcess.id, msg)}
							onBack={() => setSelectedId(null)}
						/>
					) : (
						<div className="flex flex-col items-center justify-center h-full text-muted-foreground">
							<Monitor className="size-16 opacity-20 mb-3" />
							<p className="text-sm">
								{processes.length > 0 ? "选择一个 Agent 查看详情" : "尚未启动任何 Agent"}
							</p>
							{processes.length === 0 && (
								<Button variant="outline" className="mt-3" onClick={() => setSpawnOpen(true)}>
									<Plus className="size-4" />
									启动第一个 Agent
								</Button>
							)}
						</div>
					)}
				</div>

				{/* Mobile: process list (when no selection) */}
				<div className="lg:hidden absolute inset-0 z-10">
					{!selectedId && (
						<div className="p-3 space-y-2 overflow-y-auto h-full bg-background">
							{loading && (
								<>
									<Skeleton className="h-28 rounded-xl" />
									<Skeleton className="h-28 rounded-xl" />
								</>
							)}
							{!loading && filteredProcesses.length === 0 && (
								<EmptyState onSpawn={() => setSpawnOpen(true)} />
							)}
							{filteredProcesses.map((p) => (
								<ProcessCard
									key={p.id}
									process={p}
									selected={false}
									onSelect={() => setSelectedId(p.id)}
									onStop={() => handleStop(p.id)}
								/>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Dialogs */}
			<SpawnDialog open={spawnOpen} onOpenChange={setSpawnOpen} onSpawn={handleSpawn} />
			<ApprovalQueue
				open={approvalOpen}
				onOpenChange={setApprovalOpen}
				approvals={pendingApprovals}
				onApprove={handleApprove}
			/>
		</div>
	);
}

function EmptyState({ onSpawn }: { onSpawn: () => void }) {
	return (
		<div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
			<Monitor className="size-12 opacity-20 mb-2" />
			<p className="text-sm mb-3">尚未启动任何 Agent</p>
			<Button variant="outline" size="sm" onClick={onSpawn}>
				<Plus className="size-4" />
				启动 Agent
			</Button>
		</div>
	);
}
