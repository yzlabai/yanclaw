import { Button } from "@yanclaw/web/components/ui/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@yanclaw/web/components/ui/collapsible";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@yanclaw/web/components/ui/dialog";
import { Input } from "@yanclaw/web/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@yanclaw/web/components/ui/select";
import { Switch } from "@yanclaw/web/components/ui/switch";
import { Textarea } from "@yanclaw/web/components/ui/textarea";
import { API_BASE, apiFetch } from "@yanclaw/web/lib/api";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface AgentOption {
	id: string;
	name: string;
	runtime: string;
}

interface SpawnDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSpawn: (config: {
		agentId: string;
		task?: string;
		workDir?: string;
		worktree?: boolean;
		systemPrompt?: string;
		model?: string;
	}) => Promise<void>;
}

export function SpawnDialog({ open, onOpenChange, onSpawn }: SpawnDialogProps) {
	const [agents, setAgents] = useState<AgentOption[]>([]);
	const [agentId, setAgentId] = useState("");
	const [task, setTask] = useState("");
	const [workDir, setWorkDir] = useState("");
	const [worktree, setWorktree] = useState(false);
	const [systemPrompt, setSystemPrompt] = useState("");
	const [model, setModel] = useState("");
	const [showAdvanced, setShowAdvanced] = useState(false);
	const [spawning, setSpawning] = useState(false);

	// Fetch available agents
	useEffect(() => {
		if (!open) return;
		apiFetch(`${API_BASE}/api/agents`)
			.then((res) => res.json())
			.then((data) => {
				const list = (data.agents ?? data ?? []) as AgentOption[];
				setAgents(list);
				if (list.length > 0 && !agentId) {
					setAgentId(list[0].id);
				}
			})
			.catch(() => {});
	}, [open, agentId]);

	const handleSubmit = useCallback(async () => {
		if (!agentId) return;
		setSpawning(true);
		try {
			await onSpawn({
				agentId,
				task: task || undefined,
				workDir: workDir || undefined,
				worktree,
				systemPrompt: systemPrompt || undefined,
				model: model || undefined,
			});
			// Reset form
			setTask("");
			setWorkDir("");
			setWorktree(false);
			setSystemPrompt("");
			setModel("");
			setShowAdvanced(false);
			onOpenChange(false);
		} finally {
			setSpawning(false);
		}
	}, [agentId, task, workDir, worktree, systemPrompt, model, onSpawn, onOpenChange]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>启动新 Agent</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Agent template */}
					<div className="space-y-1">
						<label className="block text-sm text-muted-foreground">Agent 模板</label>
						<Select value={agentId} onValueChange={setAgentId}>
							<SelectTrigger>
								<SelectValue placeholder="选择 Agent..." />
							</SelectTrigger>
							<SelectContent>
								{agents.map((a) => (
									<SelectItem key={a.id} value={a.id}>
										{a.name || a.id}
										<span className="ml-2 text-xs text-muted-foreground">
											({a.runtime || "default"})
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					{/* Task */}
					<div className="space-y-1">
						<label className="block text-sm text-muted-foreground">任务描述</label>
						<Textarea
							value={task}
							onChange={(e) => setTask(e.target.value)}
							placeholder="描述你希望 Agent 完成的任务..."
							rows={2}
						/>
					</div>

					{/* Work dir */}
					<div className="space-y-1">
						<label className="block text-sm text-muted-foreground">工作目录</label>
						<Input
							value={workDir}
							onChange={(e) => setWorkDir(e.target.value)}
							placeholder="./packages/web（可选，相对于 Agent 默认目录）"
						/>
					</div>

					{/* Worktree switch */}
					<div className="flex items-center gap-3">
						<Switch checked={worktree} onCheckedChange={setWorktree} />
						<span className="text-sm">使用 Git Worktree 隔离</span>
					</div>

					{/* Advanced options */}
					<Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
						<CollapsibleTrigger className="text-sm text-muted-foreground hover:text-foreground transition-colors">
							{showAdvanced ? "▾" : "▸"} 高级选项
						</CollapsibleTrigger>
						<CollapsibleContent className="space-y-3 pt-2">
							<div className="space-y-1">
								<label className="block text-sm text-muted-foreground">Model 覆盖</label>
								<Input
									value={model}
									onChange={(e) => setModel(e.target.value)}
									placeholder="默认使用 Agent 配置的模型"
								/>
							</div>
							<div className="space-y-1">
								<label className="block text-sm text-muted-foreground">System Prompt 追加</label>
								<Textarea
									value={systemPrompt}
									onChange={(e) => setSystemPrompt(e.target.value)}
									placeholder="额外的系统提示..."
									rows={2}
								/>
							</div>
						</CollapsibleContent>
					</Collapsible>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button onClick={handleSubmit} disabled={!agentId || spawning}>
						{spawning && <Loader2 className="size-4 animate-spin" />}
						启动
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
