import { Badge } from "@yanclaw/web/components/ui/badge";
import { Button } from "@yanclaw/web/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@yanclaw/web/components/ui/dialog";
import { Input } from "@yanclaw/web/components/ui/input";
import { Textarea } from "@yanclaw/web/components/ui/textarea";
import { cn } from "@yanclaw/web/lib/utils";
import {
	ArrowRight,
	CheckCircle2,
	Circle,
	Loader2,
	Plus,
	SkipForward,
	Trash2,
	XCircle,
} from "lucide-react";
import { useCallback, useState } from "react";

interface TaskNode {
	id: string;
	agentId: string;
	task: string;
	dependsOn: string[];
	workDir?: string;
	worktree?: boolean;
	status: "pending" | "running" | "completed" | "failed" | "skipped";
	processId?: string;
	error?: string;
}

interface DAG {
	id: string;
	name: string;
	status: string;
	createdAt: number;
	tasks: TaskNode[];
}

const statusIcons: Record<string, React.ReactNode> = {
	pending: <Circle className="size-4 text-muted-foreground" />,
	running: <Loader2 className="size-4 text-blue-400 animate-spin" />,
	completed: <CheckCircle2 className="size-4 text-green-400" />,
	failed: <XCircle className="size-4 text-red-400" />,
	skipped: <SkipForward className="size-4 text-muted-foreground" />,
};

const statusLabels: Record<string, string> = {
	pending: "等待中",
	running: "运行中",
	completed: "已完成",
	failed: "失败",
	skipped: "已跳过",
};

interface TaskDAGViewProps {
	dags: DAG[];
	onCreateDAG: (dag: {
		id: string;
		name: string;
		tasks: Array<{
			id: string;
			agentId: string;
			task: string;
			dependsOn: string[];
			workDir?: string;
			worktree?: boolean;
		}>;
	}) => Promise<void>;
	onSelectProcess?: (processId: string) => void;
}

export function TaskDAGView({ dags, onCreateDAG, onSelectProcess }: TaskDAGViewProps) {
	const [createOpen, setCreateOpen] = useState(false);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="text-sm font-medium">任务编排 (DAG)</h3>
				<Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
					<Plus className="size-3" />
					新建 DAG
				</Button>
			</div>

			{dags.length === 0 && (
				<div className="text-center py-8 text-muted-foreground text-sm">尚未创建任务编排</div>
			)}

			{dags.map((dag) => (
				<DAGCard key={dag.id} dag={dag} onSelectProcess={onSelectProcess} />
			))}

			<CreateDAGDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={onCreateDAG} />
		</div>
	);
}

function DAGCard({ dag, onSelectProcess }: { dag: DAG; onSelectProcess?: (id: string) => void }) {
	const dagStatusColors: Record<string, string> = {
		pending: "text-muted-foreground",
		running: "text-blue-400",
		completed: "text-green-400",
		failed: "text-red-400",
	};

	return (
		<div className="rounded-xl border border-border bg-card p-4 space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="font-medium text-sm">{dag.name}</span>
					<Badge
						variant="outline"
						className={cn("text-xs", dagStatusColors[dag.status] ?? "text-muted-foreground")}
					>
						{dag.status === "running"
							? "运行中"
							: dag.status === "completed"
								? "已完成"
								: dag.status === "failed"
									? "失败"
									: "等待中"}
					</Badge>
				</div>
				<span className="text-xs text-muted-foreground">
					{new Date(dag.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
				</span>
			</div>

			{/* Task nodes as a flow */}
			<div className="space-y-2">
				{dag.tasks.map((task, _i) => (
					<div key={task.id} className="flex items-start gap-2">
						<div className="mt-0.5">{statusIcons[task.status]}</div>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="text-sm font-medium truncate">{task.id}</span>
								<Badge variant="secondary" className="text-xs shrink-0">
									{task.agentId}
								</Badge>
								<span className="text-xs text-muted-foreground">{statusLabels[task.status]}</span>
							</div>
							<p className="text-xs text-muted-foreground truncate">{task.task}</p>
							{task.dependsOn.length > 0 && (
								<div className="flex items-center gap-1 mt-0.5">
									<ArrowRight className="size-3 text-muted-foreground" />
									<span className="text-xs text-muted-foreground">
										依赖: {task.dependsOn.join(", ")}
									</span>
								</div>
							)}
							{task.error && <p className="text-xs text-red-400 mt-0.5">{task.error}</p>}
							{task.processId && onSelectProcess && (
								<button
									type="button"
									className="text-xs text-primary hover:underline mt-0.5"
									onClick={() => onSelectProcess(task.processId as string)}
								>
									查看进程
								</button>
							)}
						</div>
					</div>
				))}
			</div>
		</div>
	);
}

interface TaskInput {
	id: string;
	agentId: string;
	task: string;
	dependsOn: string;
}

function CreateDAGDialog({
	open,
	onOpenChange,
	onCreate,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onCreate: (dag: {
		id: string;
		name: string;
		tasks: Array<{ id: string; agentId: string; task: string; dependsOn: string[] }>;
	}) => Promise<void>;
}) {
	const [name, setName] = useState("");
	const [tasks, setTasks] = useState<TaskInput[]>([
		{ id: "task-1", agentId: "", task: "", dependsOn: "" },
	]);
	const [submitting, setSubmitting] = useState(false);

	const addTask = () => {
		setTasks((prev) => [
			...prev,
			{ id: `task-${prev.length + 1}`, agentId: "", task: "", dependsOn: "" },
		]);
	};

	const removeTask = (idx: number) => {
		setTasks((prev) => prev.filter((_, i) => i !== idx));
	};

	const updateTask = (idx: number, field: keyof TaskInput, value: string) => {
		setTasks((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
	};

	const handleSubmit = useCallback(async () => {
		if (!name.trim() || tasks.length === 0) return;
		setSubmitting(true);
		try {
			await onCreate({
				id: `dag-${Date.now()}`,
				name,
				tasks: tasks.map((t) => ({
					id: t.id,
					agentId: t.agentId,
					task: t.task,
					dependsOn: t.dependsOn
						.split(",")
						.map((s) => s.trim())
						.filter(Boolean),
				})),
			});
			setName("");
			setTasks([{ id: "task-1", agentId: "", task: "", dependsOn: "" }]);
			onOpenChange(false);
		} finally {
			setSubmitting(false);
		}
	}, [name, tasks, onCreate, onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>新建任务编排</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-2">
					<div className="space-y-1">
						<label className="block text-sm text-muted-foreground">DAG 名称</label>
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="例如: 全栈开发"
						/>
					</div>

					<div className="space-y-2">
						<label className="block text-sm text-muted-foreground">任务列表</label>
						{tasks.map((task, i) => (
							<div key={i} className="rounded-lg border border-border p-3 space-y-2">
								<div className="flex items-center gap-2">
									<Input
										value={task.id}
										onChange={(e) => updateTask(i, "id", e.target.value)}
										placeholder="任务 ID"
										className="w-24"
									/>
									<Input
										value={task.agentId}
										onChange={(e) => updateTask(i, "agentId", e.target.value)}
										placeholder="Agent ID"
										className="flex-1"
									/>
									{tasks.length > 1 && (
										<Button variant="ghost" size="icon-xs" onClick={() => removeTask(i)}>
											<Trash2 className="size-3" />
										</Button>
									)}
								</div>
								<Textarea
									value={task.task}
									onChange={(e) => updateTask(i, "task", e.target.value)}
									placeholder="任务描述"
									rows={1}
								/>
								<Input
									value={task.dependsOn}
									onChange={(e) => updateTask(i, "dependsOn", e.target.value)}
									placeholder="依赖任务 ID（逗号分隔）"
								/>
							</div>
						))}
						<Button variant="outline" size="sm" onClick={addTask}>
							<Plus className="size-3" />
							添加任务
						</Button>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!name.trim() || tasks.length === 0 || submitting}
					>
						{submitting && <Loader2 className="size-4 animate-spin" />}
						启动 DAG
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
