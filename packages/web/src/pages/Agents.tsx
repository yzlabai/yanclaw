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
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "../components/ui/select";
import { useAvailableModels } from "../hooks/useAvailableModels";
import { API_BASE, apiFetch } from "../lib/api";

interface AgentData {
	id: string;
	name: string;
	model: string;
	systemPrompt: string;
	runtime: "default" | "claude-code";
	workspaceDir?: string;
	preference?: "default" | "fast" | "quality" | "cheap";
}

const PREFERENCE_OPTIONS = [
	{ value: "default", label: "默认" },
	{ value: "fast", label: "快速" },
	{ value: "quality", label: "高质量" },
	{ value: "cheap", label: "经济" },
];

export function Agents() {
	const [agents, setAgents] = useState<AgentData[]>([]);
	const [editing, setEditing] = useState<AgentData | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [saving, setSaving] = useState(false);
	const { providers: modelProviders, loading: modelsLoading } = useAvailableModels();

	const fetchAgents = useCallback(() => {
		apiFetch(`${API_BASE}/api/agents`)
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((data: AgentData[]) => {
				if (Array.isArray(data)) setAgents(data);
			})
			.catch(() => {});
	}, []);

	useEffect(() => {
		fetchAgents();
	}, [fetchAgents]);

	const handleCreate = () => {
		setIsNew(true);
		setEditing({
			id: "",
			name: "",
			model: "",
			systemPrompt: "You are a helpful assistant.",
			runtime: "default",
		});
	};

	const handleClone = (agent: AgentData) => {
		setIsNew(true);
		setEditing({
			...agent,
			id: `${agent.id}-copy`,
			name: `${agent.name} (副本)`,
		});
	};

	const handleSave = async () => {
		if (!editing) return;
		setSaving(true);

		try {
			if (isNew) {
				const res = await apiFetch(`${API_BASE}/api/agents`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(editing),
				});
				if (!res.ok) {
					const err = await res.json();
					toast.error(err.error || "Failed to create agent");
					return;
				}
			} else {
				const { id, ...body } = editing;
				const res = await apiFetch(`${API_BASE}/api/agents/${id}`, {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					const err = await res.json();
					toast.error(err.error || "Failed to update agent");
					return;
				}
			}
			setEditing(null);
			fetchAgents();
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (id: string) => {
		const res = await apiFetch(`${API_BASE}/api/agents/${id}`, { method: "DELETE" });
		if (res.ok) {
			fetchAgents();
		} else {
			const err = await res.json();
			toast.error(err.error || "Failed to delete");
		}
	};

	const hasModels = modelProviders.some((p) => p.models.length > 0);

	return (
		<div className="p-6 animate-fade-in-up">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">Agent 管理</h2>
				<Button onClick={handleCreate}>+ 新建 Agent</Button>
			</div>

			{/* Agent card grid */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{agents.map((agent) => (
					<div
						key={agent.id}
						className="bg-card border border-border rounded-2xl p-4 shadow-warm-sm card-hover cursor-pointer"
						onClick={() => {
							setIsNew(false);
							setEditing({ ...agent });
						}}
					>
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2 mb-1">
									<h3 className="font-semibold">{agent.name || agent.id}</h3>
									{agent.id === "main" && (
										<Badge variant="outline" className="text-xs">
											默认
										</Badge>
									)}
								</div>
								<p className="text-xs text-muted-foreground mb-2 truncate">{agent.systemPrompt}</p>
							</div>
							<div className="flex items-center gap-1 -mr-2 -mt-1">
								<Button
									variant="ghost"
									size="sm"
									className="text-muted-foreground hover:text-foreground"
									onClick={(e) => {
										e.stopPropagation();
										handleClone(agent);
									}}
									title="克隆"
								>
									复制
								</Button>
								{agent.id !== "main" && (
									<AlertDialog>
										<AlertDialogTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												className="text-red-400 hover:text-red-300 hover:bg-muted"
												onClick={(e) => e.stopPropagation()}
											>
												删除
											</Button>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>删除 Agent "{agent.id}"？</AlertDialogTitle>
												<AlertDialogDescription>此操作不可撤销。</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>取消</AlertDialogCancel>
												<AlertDialogAction onClick={() => handleDelete(agent.id)}>
													删除
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								)}
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							<Badge variant="secondary">{agent.model || "系统配置"}</Badge>
							{agent.runtime === "claude-code" && <Badge>Claude Code</Badge>}
							{agent.preference && agent.preference !== "default" && (
								<Badge variant="outline">
									{PREFERENCE_OPTIONS.find((o) => o.value === agent.preference)?.label}
								</Badge>
							)}
						</div>
					</div>
				))}
			</div>
			{agents.length === 0 && <p className="text-muted-foreground mt-4">No agents configured.</p>}

			{/* Edit dialog */}
			<Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
				<DialogContent className="rounded-2xl">
					<DialogHeader>
						<DialogTitle>{isNew ? "Create Agent" : `Edit: ${editing?.name}`}</DialogTitle>
					</DialogHeader>
					{editing && (
						<div className="space-y-4">
							<div>
								<label className="block text-sm text-muted-foreground mb-1">ID</label>
								<Input
									type="text"
									value={editing.id}
									onChange={(e) => setEditing({ ...editing, id: e.target.value })}
									disabled={!isNew}
									placeholder="my-agent"
									className="rounded-xl"
								/>
							</div>
							<div>
								<label className="block text-sm text-muted-foreground mb-1">Name</label>
								<Input
									type="text"
									value={editing.name}
									onChange={(e) => setEditing({ ...editing, name: e.target.value })}
									placeholder="My Assistant"
									className="rounded-xl"
								/>
							</div>
							{editing.runtime !== "claude-code" && (
								<>
									<div>
										<label className="block text-sm text-muted-foreground mb-1">Model</label>
										{modelsLoading ? (
											<div className="text-sm text-muted-foreground py-2">加载模型列表...</div>
										) : (
											<Select
												value={editing.model}
												onValueChange={(v) =>
													setEditing({
														...editing,
														model: v === "__system__" ? "" : v,
													})
												}
											>
												<SelectTrigger className="rounded-xl">
													<SelectValue placeholder="选择模型" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="__system__">使用系统配置</SelectItem>
													{hasModels && <SelectSeparator />}
													{modelProviders.map(
														(p) =>
															p.models.length > 0 && (
																<SelectGroup key={p.provider}>
																	<SelectLabel>{p.provider}</SelectLabel>
																	{p.models.map((m) => (
																		<SelectItem key={m.id} value={m.id}>
																			{m.name}
																		</SelectItem>
																	))}
																</SelectGroup>
															),
													)}
													{!hasModels && (
														<div className="px-2 py-1.5 text-xs text-muted-foreground">
															未找到可用模型，请先在设置中配置 Provider
														</div>
													)}
												</SelectContent>
											</Select>
										)}
									</div>
									{!editing.model && (
										<div>
											<label className="block text-sm text-muted-foreground mb-1">Preference</label>
											<Select
												value={editing.preference || "default"}
												onValueChange={(v) =>
													setEditing({
														...editing,
														preference: v as AgentData["preference"],
													})
												}
											>
												<SelectTrigger className="rounded-xl">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{PREFERENCE_OPTIONS.map((o) => (
														<SelectItem key={o.value} value={o.value}>
															{o.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
											<p className="text-xs text-muted-foreground mt-1">
												使用系统配置时，preference 决定选用 fast/quality/cheap 对应的模型
											</p>
										</div>
									)}
								</>
							)}
							<div>
								<label className="block text-sm text-muted-foreground mb-1">Runtime</label>
								<Select
									value={editing.runtime}
									onValueChange={(v) =>
										setEditing({
											...editing,
											runtime: v as "default" | "claude-code",
										})
									}
								>
									<SelectTrigger className="rounded-xl">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="default">Default (Vercel AI SDK)</SelectItem>
										<SelectItem value="claude-code">Claude Code (Agent SDK)</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{editing.runtime === "claude-code" && (
								<div>
									<label className="block text-sm text-muted-foreground mb-1">
										Workspace Directory
									</label>
									<Input
										type="text"
										value={editing.workspaceDir ?? ""}
										onChange={(e) =>
											setEditing({
												...editing,
												workspaceDir: e.target.value || undefined,
											})
										}
										placeholder="/path/to/project"
										className="rounded-xl"
									/>
								</div>
							)}
							<div>
								<label className="block text-sm text-muted-foreground mb-1">System Prompt</label>
								<textarea
									value={editing.systemPrompt}
									onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
									rows={4}
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground placeholder-muted-foreground outline-none focus:ring-2 focus:ring-primary resize-y"
								/>
							</div>
							<div className="flex justify-end gap-3 mt-6">
								<Button variant="ghost" onClick={() => setEditing(null)}>
									取消
								</Button>
								<Button onClick={handleSave} disabled={saving || !editing.id || !editing.name}>
									{saving ? "保存中..." : isNew ? "创建" : "保存"}
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
