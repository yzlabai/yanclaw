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
import { API_BASE, apiFetch } from "../lib/api";

interface AgentData {
	id: string;
	name: string;
	model: string;
	systemPrompt: string;
	runtime: "default" | "claude-code";
	workspaceDir?: string;
}

const MODEL_OPTIONS = [
	{
		group: "Anthropic",
		models: [
			{ value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
			{ value: "claude-opus-4-20250514", label: "Claude Opus 4" },
			{ value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
		],
	},
	{
		group: "OpenAI",
		models: [
			{ value: "gpt-4o", label: "GPT-4o" },
			{ value: "gpt-4o-mini", label: "GPT-4o Mini" },
			{ value: "o3-mini", label: "o3-mini" },
		],
	},
	{
		group: "Google",
		models: [
			{ value: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro" },
			{ value: "gemini-2.5-flash-preview-04-17", label: "Gemini 2.5 Flash" },
			{ value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
		],
	},
];

export function Agents() {
	const [agents, setAgents] = useState<AgentData[]>([]);
	const [editing, setEditing] = useState<AgentData | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [saving, setSaving] = useState(false);

	const fetchAgents = useCallback(() => {
		apiFetch(`${API_BASE}/api/agents`)
			.then((r) => r.json())
			.then((data: AgentData[]) => setAgents(data))
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
			model: "claude-sonnet-4-20250514",
			systemPrompt: "You are a helpful assistant.",
			runtime: "default",
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

	return (
		<div className="p-6 animate-fade-in-up">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">Agents</h2>
				<Button onClick={handleCreate}>+ New Agent</Button>
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
								<h3 className="font-semibold mb-1">{agent.name || agent.id}</h3>
								<p className="text-xs text-muted-foreground mb-2 truncate">{agent.systemPrompt}</p>
							</div>
							{agent.id !== "main" && (
								<AlertDialog>
									<AlertDialogTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="text-red-400 hover:text-red-300 hover:bg-muted -mr-2 -mt-1"
											onClick={(e) => e.stopPropagation()}
										>
											Delete
										</Button>
									</AlertDialogTrigger>
									<AlertDialogContent>
										<AlertDialogHeader>
											<AlertDialogTitle>Delete agent "{agent.id}"?</AlertDialogTitle>
											<AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
										</AlertDialogHeader>
										<AlertDialogFooter>
											<AlertDialogCancel>Cancel</AlertDialogCancel>
											<AlertDialogAction onClick={() => handleDelete(agent.id)}>
												Delete
											</AlertDialogAction>
										</AlertDialogFooter>
									</AlertDialogContent>
								</AlertDialog>
							)}
						</div>
						<div className="flex flex-wrap gap-2">
							<Badge variant="secondary">{agent.model || "default"}</Badge>
							{agent.runtime === "claude-code" && <Badge>Claude Code</Badge>}
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
								<div>
									<label className="block text-sm text-muted-foreground mb-1">Model</label>
									<select
										value={editing.model}
										onChange={(e) => setEditing({ ...editing, model: e.target.value })}
										className="w-full bg-muted rounded-lg px-4 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary"
									>
										{MODEL_OPTIONS.map((g) => (
											<optgroup key={g.group} label={g.group}>
												{g.models.map((m) => (
													<option key={m.value} value={m.value}>
														{m.label}
													</option>
												))}
											</optgroup>
										))}
									</select>
								</div>
							)}
							<div>
								<label className="block text-sm text-muted-foreground mb-1">Runtime</label>
								<select
									value={editing.runtime}
									onChange={(e) =>
										setEditing({
											...editing,
											runtime: e.target.value as "default" | "claude-code",
										})
									}
									className="w-full bg-muted rounded-lg px-4 py-2 text-foreground outline-none focus:ring-2 focus:ring-primary"
								>
									<option value="default">Default (Vercel AI SDK)</option>
									<option value="claude-code">Claude Code (Agent SDK)</option>
								</select>
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
									Cancel
								</Button>
								<Button onClick={handleSave} disabled={saving || !editing.id || !editing.name}>
									{saving ? "Saving..." : isNew ? "Create" : "Save"}
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
