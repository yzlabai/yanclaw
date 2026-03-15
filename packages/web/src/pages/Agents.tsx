import { useCallback, useEffect, useRef, useState } from "react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../components/ui/collapsible";
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
import { Switch } from "../components/ui/switch";
import { useAvailableModels } from "../hooks/useAvailableModels";
import { API_BASE, apiFetch } from "../lib/api";

interface ToolPolicy {
	allow?: string[];
	deny?: string[];
}

interface AgentData {
	id: string;
	name: string;
	model: string;
	systemPrompt: string;
	runtime: "default" | "claude-code";
	taskEnabled?: boolean;
	workspaceDir?: string;
	preference?: "default" | "fast" | "quality" | "cheap";
	tools?: ToolPolicy;
	capabilities?: string | string[];
}

interface ToolsMetadata {
	groups: Record<string, string[]>;
	presets: Record<string, string[]>;
	capabilities: Record<string, string[]>;
	ownerOnly: string[];
	allTools: string[];
}

const PREFERENCE_OPTIONS = [
	{ value: "default", label: "\u9ED8\u8BA4" },
	{ value: "fast", label: "\u5FEB\u901F" },
	{ value: "quality", label: "\u9AD8\u8D28\u91CF" },
	{ value: "cheap", label: "\u7ECF\u6D4E" },
];

const CAPABILITY_PRESETS = [
	{ value: "full-access", label: "\u4E0D\u9650\u5236", desc: "Full access" },
	{ value: "safe-reader", label: "\u5B89\u5168\u53EA\u8BFB", desc: "fs:read, memory:read" },
	{ value: "researcher", label: "\u7814\u7A76\u5458", desc: "read + web + memory" },
	{ value: "developer", label: "\u5F00\u53D1\u8005", desc: "read/write + exec + web + memory" },
	{ value: "custom", label: "\u81EA\u5B9A\u4E49", desc: "Custom allow/deny" },
];

const GROUP_LABELS: Record<string, string> = {
	"group:exec": "\u6267\u884C",
	"group:file": "\u6587\u4EF6",
	"group:web": "\u7F51\u7EDC",
	"group:browser": "\u6D4F\u89C8\u5668",
	"group:memory": "\u8BB0\u5FC6",
	"group:desktop": "\u684C\u9762",
	"group:session": "\u4F1A\u8BDD",
};

/** Derive which preset key matches the current agent state. */
function derivePresetKey(agent: AgentData): string {
	if (agent.tools?.allow || agent.tools?.deny?.length) return "custom";
	if (!agent.capabilities) return "full-access";
	if (typeof agent.capabilities === "string") return agent.capabilities;
	return "custom";
}

export function Agents() {
	const [agents, setAgents] = useState<AgentData[]>([]);
	const [editing, setEditing] = useState<AgentData | null>(null);
	const [isNew, setIsNew] = useState(false);
	const [saving, setSaving] = useState(false);
	const [toolPolicyOpen, setToolPolicyOpen] = useState(false);
	const [presetKey, setPresetKey] = useState("full-access");
	const [toolsMeta, setToolsMeta] = useState<ToolsMetadata | null>(null);
	const metaCacheRef = useRef<ToolsMetadata | null>(null);
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

	// Fetch tools metadata when dialog opens
	useEffect(() => {
		if (!editing) return;
		if (metaCacheRef.current) {
			setToolsMeta(metaCacheRef.current);
			return;
		}
		apiFetch(`${API_BASE}/api/tools/metadata`)
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((data: ToolsMetadata) => {
				metaCacheRef.current = data;
				setToolsMeta(data);
			})
			.catch(() => {});
	}, [editing]);

	const handleCreate = () => {
		setIsNew(true);
		setToolPolicyOpen(false);
		setPresetKey("full-access");
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
		const key = derivePresetKey(agent);
		setPresetKey(key);
		setToolPolicyOpen(key !== "full-access");
		setEditing({
			...agent,
			id: `${agent.id}-copy`,
			name: `${agent.name} (\u526F\u672C)`,
		});
	};

	const openEdit = (agent: AgentData) => {
		setIsNew(false);
		const key = derivePresetKey(agent);
		setPresetKey(key);
		setToolPolicyOpen(key !== "full-access");
		setEditing({ ...agent });
	};

	const handleSave = async () => {
		if (!editing) return;
		setSaving(true);

		// Build payload with tool policy
		const payload: AgentData = { ...editing };

		if (presetKey === "full-access") {
			payload.capabilities = undefined;
			payload.tools = undefined;
		} else if (presetKey === "custom") {
			// capabilities stays as-is (custom array or undefined)
			// tools allow/deny stays as-is
		} else {
			// Named preset
			payload.capabilities = presetKey;
			// Keep deny list if user set one
			if (!payload.tools?.deny?.length) {
				payload.tools = undefined;
			}
		}

		try {
			if (isNew) {
				const res = await apiFetch(`${API_BASE}/api/agents`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(payload),
				});
				if (!res.ok) {
					const err = await res.json();
					toast.error(err.error || "Failed to create agent");
					return;
				}
			} else {
				const { id, ...body } = payload;
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

	const toggleToolInList = (listKey: "allow" | "deny", toolName: string, checked: boolean) => {
		if (!editing) return;
		const currentTools = editing.tools ?? {};
		const currentList = currentTools[listKey] ?? [];
		const next = checked ? [...currentList, toolName] : currentList.filter((t) => t !== toolName);
		setEditing({
			...editing,
			tools: { ...currentTools, [listKey]: next.length ? next : undefined },
		});
	};

	const ownerOnlySet = new Set(toolsMeta?.ownerOnly ?? []);
	const hasModels = modelProviders.some((p) => p.models.length > 0);

	return (
		<div className="p-6 animate-fade-in-up">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">AI \u52A9\u624B</h2>
				<Button onClick={handleCreate}>+ \u65B0\u5EFA AI \u52A9\u624B</Button>
			</div>

			{/* Agent card grid */}
			<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{agents.map((agent) => (
					<div
						key={agent.id}
						className="bg-card border border-border rounded-2xl p-4 shadow-warm-sm card-hover cursor-pointer"
						onClick={() => openEdit(agent)}
					>
						<div className="flex items-start justify-between">
							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2 mb-1">
									<h3 className="font-semibold">{agent.name || agent.id}</h3>
									{agent.id === "main" && (
										<Badge variant="outline" className="text-xs">
											\u9ED8\u8BA4
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
									title="\u514B\u9686"
								>
									\u590D\u5236
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
												\u5220\u9664
											</Button>
										</AlertDialogTrigger>
										<AlertDialogContent>
											<AlertDialogHeader>
												<AlertDialogTitle>
													\u5220\u9664 Agent &quot;{agent.id}&quot;\uFF1F
												</AlertDialogTitle>
												<AlertDialogDescription>
													\u6B64\u64CD\u4F5C\u4E0D\u53EF\u64A4\u9500\u3002
												</AlertDialogDescription>
											</AlertDialogHeader>
											<AlertDialogFooter>
												<AlertDialogCancel>\u53D6\u6D88</AlertDialogCancel>
												<AlertDialogAction onClick={() => handleDelete(agent.id)}>
													\u5220\u9664
												</AlertDialogAction>
											</AlertDialogFooter>
										</AlertDialogContent>
									</AlertDialog>
								)}
							</div>
						</div>
						<div className="flex flex-wrap gap-2">
							<Badge variant="secondary">{agent.model || "\u7CFB\u7EDF\u914D\u7F6E"}</Badge>
							{agent.runtime === "claude-code" && <Badge>Claude Code</Badge>}
							{agent.preference && agent.preference !== "default" && (
								<Badge variant="outline">
									{PREFERENCE_OPTIONS.find((o) => o.value === agent.preference)?.label}
								</Badge>
							)}
							{agent.taskEnabled && (
								<Badge variant="outline" className="text-xs">
									\u53EF\u6267\u884C\u4EFB\u52A1
								</Badge>
							)}
							{agent.capabilities && (
								<Badge variant="outline" className="text-xs">
									{typeof agent.capabilities === "string"
										? (CAPABILITY_PRESETS.find((p) => p.value === agent.capabilities)?.label ??
											agent.capabilities)
										: "\u81EA\u5B9A\u4E49\u6743\u9650"}
								</Badge>
							)}
						</div>
					</div>
				))}
			</div>
			{agents.length === 0 && <p className="text-muted-foreground mt-4">No agents configured.</p>}

			{/* Edit dialog */}
			<Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
				<DialogContent className="rounded-2xl max-h-[85vh] overflow-y-auto">
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
											<div className="text-sm text-muted-foreground py-2">
												\u52A0\u8F7D\u6A21\u578B\u5217\u8868...
											</div>
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
													<SelectValue placeholder="\u9009\u62E9\u6A21\u578B" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="__system__">
														\u4F7F\u7528\u7CFB\u7EDF\u914D\u7F6E
													</SelectItem>
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
															\u672A\u627E\u5230\u53EF\u7528\u6A21\u578B\uFF0C\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u914D\u7F6E
															Provider
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
												\u4F7F\u7528\u7CFB\u7EDF\u914D\u7F6E\u65F6\uFF0Cpreference
												\u51B3\u5B9A\u9009\u7528 fast/quality/cheap \u5BF9\u5E94\u7684\u6A21\u578B
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
							<div className="flex items-center justify-between">
								<label className="text-sm text-muted-foreground">
									\u5141\u8BB8\u81EA\u4E3B\u4EFB\u52A1
								</label>
								<Switch
									checked={editing.taskEnabled ?? false}
									onCheckedChange={(checked) => setEditing({ ...editing, taskEnabled: !!checked })}
								/>
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

							{/* Tool Policy Editor */}
							<Collapsible open={toolPolicyOpen} onOpenChange={setToolPolicyOpen}>
								<CollapsibleTrigger asChild>
									<button
										type="button"
										className="flex items-center gap-2 w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
									>
										<span className="text-xs">{toolPolicyOpen ? "\u25BC" : "\u25B6"}</span>
										<span>\u5DE5\u5177\u6743\u9650\u7B56\u7565</span>
										{presetKey !== "full-access" && (
											<Badge variant="outline" className="text-xs ml-1">
												{CAPABILITY_PRESETS.find((p) => p.value === presetKey)?.label}
											</Badge>
										)}
									</button>
								</CollapsibleTrigger>
								<CollapsibleContent>
									<div className="mt-2 space-y-3 pl-1">
										{/* Capability Preset Radio Group */}
										<div>
											<label className="block text-xs text-muted-foreground mb-2">
												\u80FD\u529B\u9884\u8BBE
											</label>
											<div className="space-y-1.5">
												{CAPABILITY_PRESETS.map((preset) => (
													<label
														key={preset.value}
														className="flex items-center gap-2 cursor-pointer text-sm group"
													>
														<input
															type="radio"
															name="capabilityPreset"
															value={preset.value}
															checked={presetKey === preset.value}
															onChange={() => {
																setPresetKey(preset.value);
																if (preset.value === "full-access") {
																	setEditing({
																		...editing,
																		capabilities: undefined,
																		tools: editing.tools?.deny?.length
																			? { deny: editing.tools.deny }
																			: undefined,
																	});
																} else if (preset.value === "custom") {
																	setEditing({
																		...editing,
																		capabilities: undefined,
																	});
																} else {
																	setEditing({
																		...editing,
																		capabilities: preset.value,
																		tools: editing.tools?.deny?.length
																			? { deny: editing.tools.deny }
																			: undefined,
																	});
																}
															}}
															className="accent-primary"
														/>
														<span className="text-foreground group-hover:text-primary transition-colors">
															{preset.label}
														</span>
														<span className="text-xs text-muted-foreground">{preset.desc}</span>
													</label>
												))}
											</div>
										</div>

										{/* Allowed Tools — only for custom */}
										{presetKey === "custom" && toolsMeta && (
											<div>
												<label className="block text-xs text-muted-foreground mb-2">
													\u5141\u8BB8\u5DE5\u5177 (allow)
												</label>
												<div className="max-h-48 overflow-y-auto bg-muted/50 rounded-lg p-2 space-y-2">
													{Object.entries(toolsMeta.groups).map(([groupKey, tools]) => (
														<div key={groupKey}>
															<div className="text-xs font-medium text-muted-foreground mb-1">
																{GROUP_LABELS[groupKey] || groupKey}
															</div>
															<div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-2">
																{tools.map((toolName) => (
																	<label
																		key={toolName}
																		className="flex items-center gap-1.5 text-xs cursor-pointer"
																	>
																		<input
																			type="checkbox"
																			checked={editing.tools?.allow?.includes(toolName) ?? false}
																			onChange={(e) =>
																				toggleToolInList("allow", toolName, e.target.checked)
																			}
																			className="accent-primary rounded"
																		/>
																		<span className="text-foreground">{toolName}</span>
																		{ownerOnlySet.has(toolName) && (
																			<span title="ownerOnly">{"\uD83D\uDD10"}</span>
																		)}
																	</label>
																))}
															</div>
														</div>
													))}
												</div>
												<p className="text-xs text-muted-foreground mt-1">
													\u82E5\u8BBE\u7F6E\u4E86
													allow\uFF0C\u4EC5\u5141\u8BB8\u5217\u8868\u4E2D\u7684\u5DE5\u5177\u3002\u7559\u7A7A\u8868\u793A\u4E0D\u9650\u5236\u3002
												</p>
											</div>
										)}

										{/* Denied Tools — always visible */}
										{toolsMeta && (
											<div>
												<label className="block text-xs text-muted-foreground mb-2">
													\u7981\u7528\u5DE5\u5177 (deny)
												</label>
												<div className="max-h-48 overflow-y-auto bg-muted/50 rounded-lg p-2 space-y-2">
													{Object.entries(toolsMeta.groups).map(([groupKey, tools]) => (
														<div key={groupKey}>
															<div className="text-xs font-medium text-muted-foreground mb-1">
																{GROUP_LABELS[groupKey] || groupKey}
															</div>
															<div className="grid grid-cols-2 gap-x-4 gap-y-0.5 pl-2">
																{tools.map((toolName) => (
																	<label
																		key={toolName}
																		className="flex items-center gap-1.5 text-xs cursor-pointer"
																	>
																		<input
																			type="checkbox"
																			checked={editing.tools?.deny?.includes(toolName) ?? false}
																			onChange={(e) =>
																				toggleToolInList("deny", toolName, e.target.checked)
																			}
																			className="accent-red-500 rounded"
																		/>
																		<span className="text-foreground">{toolName}</span>
																		{ownerOnlySet.has(toolName) && (
																			<span title="ownerOnly">{"\uD83D\uDD10"}</span>
																		)}
																	</label>
																))}
															</div>
														</div>
													))}
												</div>
												<p className="text-xs text-muted-foreground mt-1">
													deny
													\u5217\u8868\u4E2D\u7684\u5DE5\u5177\u4F1A\u88AB\u5F3A\u5236\u7981\u7528\uFF0C\u5373\u4F7F\u9884\u8BBE\u5141\u8BB8\u3002
												</p>
											</div>
										)}

										{!toolsMeta && (
											<div className="text-xs text-muted-foreground py-2">
												\u52A0\u8F7D\u5DE5\u5177\u5143\u6570\u636E...
											</div>
										)}
									</div>
								</CollapsibleContent>
							</Collapsible>

							<div className="flex justify-end gap-3 mt-6">
								<Button variant="ghost" onClick={() => setEditing(null)}>
									\u53D6\u6D88
								</Button>
								<Button onClick={handleSave} disabled={saving || !editing.id || !editing.name}>
									{saving ? "\u4FDD\u5B58\u4E2D..." : isNew ? "\u521B\u5EFA" : "\u4FDD\u5B58"}
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
