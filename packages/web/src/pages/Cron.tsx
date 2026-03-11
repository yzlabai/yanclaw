import { Clock, Loader2, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "../components/ui/alert-dialog";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Switch } from "../components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "../components/ui/table";
import { API_BASE, apiFetch } from "../lib/api";

interface CronTask {
	id: string;
	agent: string;
	mode: "cron" | "interval" | "once";
	schedule: string;
	prompt: string;
	deliveryTargets: { channel: string; peer?: string }[];
	enabled: boolean;
	nextRunAt: number | null;
	lastRunAt: number | null;
	lastResult: string | null;
	isRunning: boolean;
}

interface AgentInfo {
	id: string;
	name: string;
}

const EMPTY_FORM = {
	id: "",
	agent: "main",
	mode: "cron" as "cron" | "interval" | "once",
	schedule: "",
	prompt: "",
	enabled: true,
};

export function Cron() {
	const [tasks, setTasks] = useState<CronTask[]>([]);
	const [agents, setAgents] = useState<AgentInfo[]>([]);
	const [showModal, setShowModal] = useState(false);
	const [editId, setEditId] = useState<string | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	const [runningId, setRunningId] = useState<string | null>(null);
	const [runResult, setRunResult] = useState<{ id: string; text: string } | null>(null);

	useEffect(() => {
		apiFetch(`${API_BASE}/api/agents`)
			.then((r) => r.json())
			.then((data: AgentInfo[]) => setAgents(data))
			.catch(() => {});
	}, []);

	const fetchTasks = useCallback(() => {
		apiFetch(`${API_BASE}/api/cron`)
			.then((r) => r.json())
			.then((data: CronTask[]) => setTasks(data))
			.catch(() => {});
	}, []);

	useEffect(() => {
		fetchTasks();
		const interval = setInterval(fetchTasks, 15_000);
		return () => clearInterval(interval);
	}, [fetchTasks]);

	const openCreate = () => {
		setEditId(null);
		setForm(EMPTY_FORM);
		setShowModal(true);
	};

	const openEdit = (task: CronTask) => {
		setEditId(task.id);
		setForm({
			id: task.id,
			agent: task.agent,
			mode: task.mode ?? "cron",
			schedule: task.schedule,
			prompt: task.prompt,
			enabled: task.enabled,
		});
		setShowModal(true);
	};

	const handleSave = async () => {
		if (!form.id || !form.schedule || !form.prompt) {
			toast.error("Please fill in all required fields");
			return;
		}

		try {
			if (editId) {
				await apiFetch(`${API_BASE}/api/cron/${editId}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						agent: form.agent,
						mode: form.mode,
						schedule: form.schedule,
						prompt: form.prompt,
						enabled: form.enabled,
					}),
				});
			} else {
				await apiFetch(`${API_BASE}/api/cron`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(form),
				});
			}

			setShowModal(false);
			fetchTasks();
		} catch {
			toast.error("Failed to save task");
		}
	};

	const deleteTask = async (id: string) => {
		try {
			await apiFetch(`${API_BASE}/api/cron/${id}`, { method: "DELETE" });
			fetchTasks();
		} catch {
			toast.error("Failed to delete task");
		}
	};

	const runTask = async (id: string) => {
		setRunningId(id);
		setRunResult(null);
		try {
			const res = await apiFetch(`${API_BASE}/api/cron/${id}/run`, { method: "POST" });
			const data = (await res.json()) as { result?: string; error?: string };
			setRunResult({ id, text: data.result ?? data.error ?? "No output" });
		} catch {
			setRunResult({ id, text: "Failed to run task" });
		} finally {
			setRunningId(null);
			fetchTasks();
		}
	};

	const toggleEnabled = async (task: CronTask) => {
		try {
			await apiFetch(`${API_BASE}/api/cron/${task.id}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ enabled: !task.enabled }),
			});
			fetchTasks();
		} catch {
			toast.error("Failed to toggle task");
		}
	};

	const formatTime = (ts: number | null) => {
		if (!ts) return "—";
		return new Date(ts).toLocaleString([], {
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

	return (
		<div className="p-6 h-full flex flex-col animate-fade-in-up">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">定时任务</h2>
				<Button onClick={openCreate} size="sm" className="rounded-xl">
					<Plus className="size-4 mr-1.5" />
					新建任务
				</Button>
			</div>

			{tasks.length === 0 ? (
				<div className="text-center py-12">
					<Clock className="size-10 text-muted-foreground/70 mx-auto mb-3" />
					<p className="text-muted-foreground">No cron tasks configured.</p>
					<p className="text-muted-foreground text-sm mt-1">
						Create a task to run agent prompts on a schedule.
					</p>
				</div>
			) : (
				<div className="flex-1 overflow-y-auto rounded-2xl border">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Task ID</TableHead>
								<TableHead>Mode</TableHead>
								<TableHead>Schedule</TableHead>
								<TableHead>Agent</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Next Run</TableHead>
								<TableHead className="text-right">Actions</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{tasks.map((task) => (
								<TableRow key={task.id} className={task.enabled ? "" : "opacity-60"}>
									<TableCell>
										<div className="flex flex-col gap-1">
											<span className="font-medium">{task.id}</span>
											<p className="text-xs text-muted-foreground truncate max-w-48">
												{task.prompt}
											</p>
											{runResult?.id === task.id && (
												<div className="mt-1 p-2 bg-muted rounded-xl text-xs text-foreground/80 max-h-32 overflow-y-auto whitespace-pre-wrap">
													{runResult.text}
												</div>
											)}
										</div>
									</TableCell>
									<TableCell>
										<Badge variant={task.mode === "cron" ? "secondary" : "outline"}>
											{task.mode}
										</Badge>
									</TableCell>
									<TableCell>
										<code className="text-xs bg-muted px-1.5 py-0.5 rounded">{task.schedule}</code>
									</TableCell>
									<TableCell className="text-sm text-muted-foreground">
										{agentName(task.agent)}
									</TableCell>
									<TableCell>
										<div className="flex items-center gap-2">
											<Switch checked={task.enabled} onCheckedChange={() => toggleEnabled(task)} />
											{task.isRunning && <Loader2 className="size-3.5 text-primary animate-spin" />}
										</div>
									</TableCell>
									<TableCell>
										<div className="flex flex-col text-xs text-muted-foreground">
											<span>Next: {formatTime(task.nextRunAt)}</span>
											<span>Last: {formatTime(task.lastRunAt)}</span>
										</div>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex items-center justify-end gap-1">
											<Button
												variant="ghost"
												size="icon"
												onClick={() => runTask(task.id)}
												disabled={runningId === task.id}
												title="Run now"
											>
												{runningId === task.id ? (
													<Loader2 className="size-4 animate-spin" />
												) : (
													<Play className="size-4" />
												)}
											</Button>
											<Button
												variant="ghost"
												size="icon"
												onClick={() => openEdit(task)}
												title="Edit"
											>
												<Pencil className="size-4" />
											</Button>
											<AlertDialog>
												<AlertDialogTrigger asChild>
													<Button
														variant="ghost"
														size="icon"
														className="hover:text-red-400"
														title="删除"
													>
														<Trash2 className="size-4" />
													</Button>
												</AlertDialogTrigger>
												<AlertDialogContent>
													<AlertDialogHeader>
														<AlertDialogTitle>删除任务 "{task.id}"？</AlertDialogTitle>
														<AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
													</AlertDialogHeader>
													<AlertDialogFooter>
														<AlertDialogCancel>取消</AlertDialogCancel>
														<AlertDialogAction onClick={() => deleteTask(task.id)}>
															删除
														</AlertDialogAction>
													</AlertDialogFooter>
												</AlertDialogContent>
											</AlertDialog>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{/* Create/Edit Dialog */}
			<Dialog open={showModal} onOpenChange={setShowModal}>
				<DialogContent className="rounded-2xl">
					<DialogHeader>
						<DialogTitle>{editId ? "编辑任务" : "新建定时任务"}</DialogTitle>
					</DialogHeader>

					<div className="space-y-4">
						{!editId && (
							<div>
								<label className="block text-sm text-muted-foreground mb-1">Task ID</label>
								<Input
									type="text"
									value={form.id}
									onChange={(e) => setForm({ ...form, id: e.target.value })}
									placeholder="daily-summary"
									className="rounded-xl"
								/>
							</div>
						)}

						<div>
							<label className="block text-sm text-muted-foreground mb-1">Mode</label>
							<select
								value={form.mode}
								onChange={(e) =>
									setForm({
										...form,
										mode: e.target.value as "cron" | "interval" | "once",
									})
								}
								className="w-full bg-muted rounded-xl px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
							>
								<option value="cron">Cron Expression</option>
								<option value="interval">Interval</option>
								<option value="once">One-time</option>
							</select>
						</div>

						<div>
							<label className="block text-sm text-muted-foreground mb-1">
								{form.mode === "cron"
									? "Schedule (cron expression)"
									: form.mode === "interval"
										? "Interval"
										: "Run At"}
							</label>
							<Input
								type={form.mode === "once" ? "datetime-local" : "text"}
								value={form.schedule}
								onChange={(e) => setForm({ ...form, schedule: e.target.value })}
								placeholder={
									form.mode === "cron" ? "0 9 * * *" : form.mode === "interval" ? "5m" : ""
								}
								className="rounded-xl"
							/>
							<p className="text-xs text-muted-foreground/70 mt-1">
								{form.mode === "cron"
									? 'e.g. "0 9 * * *" = every day at 9:00, "*/30 * * * *" = every 30 min'
									: form.mode === "interval"
										? 'e.g. "30s", "5m", "2h", "1d"'
										: "Select a date and time for a one-time run"}
							</p>
						</div>

						<div>
							<label className="block text-sm text-muted-foreground mb-1">Agent</label>
							<select
								value={form.agent}
								onChange={(e) => setForm({ ...form, agent: e.target.value })}
								className="w-full bg-muted rounded-xl px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
							>
								{agents.map((a) => (
									<option key={a.id} value={a.id}>
										{a.name}
									</option>
								))}
							</select>
						</div>

						<div>
							<label className="block text-sm text-muted-foreground mb-1">Prompt</label>
							<textarea
								value={form.prompt}
								onChange={(e) => setForm({ ...form, prompt: e.target.value })}
								placeholder="Summarize today's news..."
								rows={3}
								className="w-full bg-muted rounded-xl px-3 py-2 text-sm text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-ring resize-y"
							/>
						</div>

						<div className="flex items-center gap-2">
							<Switch
								id="cron-enabled"
								checked={form.enabled}
								onCheckedChange={(checked) => setForm({ ...form, enabled: checked })}
							/>
							<label htmlFor="cron-enabled" className="text-sm text-muted-foreground">
								Enabled
							</label>
						</div>
					</div>

					<div className="flex gap-3 mt-2">
						<Button
							variant="outline"
							className="flex-1 rounded-xl"
							onClick={() => setShowModal(false)}
						>
							取消
						</Button>
						<Button
							className="flex-1 rounded-xl"
							onClick={handleSave}
							disabled={!form.schedule || !form.prompt || (!editId && !form.id)}
						>
							{editId ? "保存" : "创建"}
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	);
}
