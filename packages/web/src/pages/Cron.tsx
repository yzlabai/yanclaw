import { Clock, Loader2, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
		if (!form.id || !form.schedule || !form.prompt) return;

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
	};

	const deleteTask = async (id: string) => {
		await apiFetch(`${API_BASE}/api/cron/${id}`, { method: "DELETE" });
		fetchTasks();
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
		await apiFetch(`${API_BASE}/api/cron/${task.id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ enabled: !task.enabled }),
		});
		fetchTasks();
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
		<div className="p-6 h-full flex flex-col">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">Cron Tasks</h2>
				<button
					type="button"
					onClick={openCreate}
					className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
				>
					<Plus className="size-4" />
					New Task
				</button>
			</div>

			{tasks.length === 0 ? (
				<div className="text-center py-12">
					<Clock className="size-10 text-gray-600 mx-auto mb-3" />
					<p className="text-gray-400">No cron tasks configured.</p>
					<p className="text-gray-500 text-sm mt-1">
						Create a task to run agent prompts on a schedule.
					</p>
				</div>
			) : (
				<div className="flex-1 overflow-y-auto space-y-3 max-w-3xl">
					{tasks.map((task) => (
						<div
							key={task.id}
							className={`rounded-lg border px-4 py-3 ${
								task.enabled
									? "border-gray-800 bg-gray-800/30"
									: "border-gray-800/50 bg-gray-900/50 opacity-60"
							}`}
						>
							<div className="flex items-start gap-3">
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-2">
										<span className="font-medium text-white">{task.id}</span>
										{task.mode !== "cron" && (
											<span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">
												{task.mode}
											</span>
										)}
										<code className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded">
											{task.schedule}
										</code>
										<span className="text-xs text-gray-600">{agentName(task.agent)}</span>
										{task.isRunning && <Loader2 className="size-3.5 text-blue-400 animate-spin" />}
									</div>
									<p className="text-sm text-gray-400 mt-1 truncate">{task.prompt}</p>
									<div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
										<span>Next: {formatTime(task.nextRunAt)}</span>
										<span>Last: {formatTime(task.lastRunAt)}</span>
									</div>

									{/* Run result */}
									{runResult?.id === task.id && (
										<div className="mt-2 p-2 bg-gray-800 rounded text-xs text-gray-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
											{runResult.text}
										</div>
									)}
								</div>

								{/* Actions */}
								<div className="flex items-center gap-1">
									<button
										type="button"
										onClick={() => toggleEnabled(task)}
										className={`px-2 py-1 text-xs rounded ${
											task.enabled ? "bg-green-900/50 text-green-400" : "bg-gray-800 text-gray-500"
										}`}
										title={task.enabled ? "Disable" : "Enable"}
									>
										{task.enabled ? "ON" : "OFF"}
									</button>
									<button
										type="button"
										onClick={() => runTask(task.id)}
										disabled={runningId === task.id}
										className="p-1.5 text-gray-400 hover:text-blue-400 transition-colors disabled:opacity-50"
										title="Run now"
									>
										{runningId === task.id ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<Play className="size-4" />
										)}
									</button>
									<button
										type="button"
										onClick={() => openEdit(task)}
										className="p-1.5 text-gray-400 hover:text-white transition-colors"
										title="Edit"
									>
										<Pencil className="size-4" />
									</button>
									<button
										type="button"
										onClick={() => deleteTask(task.id)}
										className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
										title="Delete"
									>
										<Trash2 className="size-4" />
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Create/Edit Modal */}
			{showModal && (
				<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
					<div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6">
						<div className="flex items-center justify-between mb-4">
							<h3 className="text-lg font-semibold">{editId ? "Edit Task" : "New Cron Task"}</h3>
							<button
								type="button"
								onClick={() => setShowModal(false)}
								className="text-gray-400 hover:text-white"
							>
								<X className="size-5" />
							</button>
						</div>

						<div className="space-y-4">
							{!editId && (
								<div>
									<label className="block text-sm text-gray-400 mb-1">Task ID</label>
									<input
										type="text"
										value={form.id}
										onChange={(e) => setForm({ ...form, id: e.target.value })}
										placeholder="daily-summary"
										className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
									/>
								</div>
							)}

							<div>
								<label className="block text-sm text-gray-400 mb-1">Mode</label>
								<select
									value={form.mode}
									onChange={(e) =>
										setForm({ ...form, mode: e.target.value as "cron" | "interval" | "once" })
									}
									className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
								>
									<option value="cron">Cron Expression</option>
									<option value="interval">Interval</option>
									<option value="once">One-time</option>
								</select>
							</div>

							<div>
								<label className="block text-sm text-gray-400 mb-1">
									{form.mode === "cron"
										? "Schedule (cron expression)"
										: form.mode === "interval"
											? "Interval"
											: "Run At"}
								</label>
								<input
									type={form.mode === "once" ? "datetime-local" : "text"}
									value={form.schedule}
									onChange={(e) => setForm({ ...form, schedule: e.target.value })}
									placeholder={
										form.mode === "cron" ? "0 9 * * *" : form.mode === "interval" ? "5m" : ""
									}
									className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
								/>
								<p className="text-xs text-gray-600 mt-1">
									{form.mode === "cron"
										? 'e.g. "0 9 * * *" = every day at 9:00, "*/30 * * * *" = every 30 min'
										: form.mode === "interval"
											? 'e.g. "30s", "5m", "2h", "1d"'
											: "Select a date and time for a one-time run"}
								</p>
							</div>

							<div>
								<label className="block text-sm text-gray-400 mb-1">Agent</label>
								<select
									value={form.agent}
									onChange={(e) => setForm({ ...form, agent: e.target.value })}
									className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
								>
									{agents.map((a) => (
										<option key={a.id} value={a.id}>
											{a.name}
										</option>
									))}
								</select>
							</div>

							<div>
								<label className="block text-sm text-gray-400 mb-1">Prompt</label>
								<textarea
									value={form.prompt}
									onChange={(e) => setForm({ ...form, prompt: e.target.value })}
									placeholder="Summarize today's news..."
									rows={3}
									className="w-full bg-gray-800 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 resize-y"
								/>
							</div>

							<div className="flex items-center gap-2">
								<input
									type="checkbox"
									checked={form.enabled}
									onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
									className="rounded"
									id="cron-enabled"
								/>
								<label htmlFor="cron-enabled" className="text-sm text-gray-400">
									Enabled
								</label>
							</div>
						</div>

						<div className="flex gap-3 mt-6">
							<button
								type="button"
								onClick={() => setShowModal(false)}
								className="flex-1 px-4 py-2 text-sm rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSave}
								disabled={!form.schedule || !form.prompt || (!editId && !form.id)}
								className="flex-1 px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
							>
								{editId ? "Save" : "Create"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
