import { Button } from "@yanclaw/web/components/ui/button";
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
}

interface TaskLoopSpawnDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSpawn: (config: {
		preset: string;
		prompt: string;
		workDir: string;
		agentId: string;
		worktree?: boolean;
		maxIterations?: number;
		presetOptions?: Record<string, unknown>;
	}) => Promise<void>;
}

export function TaskLoopSpawnDialog({ open, onOpenChange, onSpawn }: TaskLoopSpawnDialogProps) {
	const [agents, setAgents] = useState<AgentOption[]>([]);
	const [agentId, setAgentId] = useState("");
	const [preset, setPreset] = useState("dev");
	const [prompt, setPrompt] = useState("");
	const [workDir, setWorkDir] = useState("");
	const [worktree, setWorktree] = useState(true);
	const [maxIterations, setMaxIterations] = useState("10");
	const [verifyCommands, setVerifyCommands] = useState("");
	const [spawning, setSpawning] = useState(false);

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
		if (!agentId || !prompt.trim()) return;
		setSpawning(true);
		try {
			const presetOptions: Record<string, unknown> = {};
			if (verifyCommands.trim()) {
				presetOptions.verifyCommands = verifyCommands
					.split("\n")
					.map((s) => s.trim())
					.filter(Boolean);
			}

			await onSpawn({
				preset,
				prompt: prompt.trim(),
				workDir: workDir || ".",
				agentId,
				worktree,
				maxIterations: Number(maxIterations) || undefined,
				presetOptions: Object.keys(presetOptions).length > 0 ? presetOptions : undefined,
			});

			setPrompt("");
			setWorkDir("");
			setVerifyCommands("");
			onOpenChange(false);
		} finally {
			setSpawning(false);
		}
	}, [
		agentId,
		preset,
		prompt,
		workDir,
		worktree,
		maxIterations,
		verifyCommands,
		onSpawn,
		onOpenChange,
	]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>新建 Task Loop</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-2">
					{/* Preset + Agent */}
					<div className="grid grid-cols-2 gap-3">
						<div className="space-y-1">
							<label className="block text-sm text-muted-foreground">预设</label>
							<Select value={preset} onValueChange={setPreset}>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="dev">Dev (编码)</SelectItem>
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<label className="block text-sm text-muted-foreground">Agent</label>
							<Select value={agentId} onValueChange={setAgentId}>
								<SelectTrigger>
									<SelectValue placeholder="选择..." />
								</SelectTrigger>
								<SelectContent>
									{agents.map((a) => (
										<SelectItem key={a.id} value={a.id}>
											{a.name || a.id}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>

					{/* Prompt */}
					<div className="space-y-1">
						<label className="block text-sm text-muted-foreground">任务描述</label>
						<Textarea
							value={prompt}
							onChange={(e) => setPrompt(e.target.value)}
							placeholder="描述你希望完成的任务..."
							rows={3}
						/>
					</div>

					{/* Work dir */}
					<div className="space-y-1">
						<label className="block text-sm text-muted-foreground">
							工作目录 <span className="text-destructive">*</span>
						</label>
						<Input
							value={workDir}
							onChange={(e) => setWorkDir(e.target.value)}
							placeholder="/path/to/project（必填）"
						/>
					</div>

					{/* Worktree + Max iterations */}
					<div className="flex items-center gap-4">
						<div className="flex items-center gap-2">
							<Switch checked={worktree} onCheckedChange={setWorktree} />
							<span className="text-sm">Worktree 隔离</span>
						</div>
						<div className="flex items-center gap-2">
							<label className="text-sm text-muted-foreground">最大迭代</label>
							<Input
								type="number"
								value={maxIterations}
								onChange={(e) => setMaxIterations(e.target.value)}
								className="w-16 h-8"
								min={1}
								max={50}
							/>
						</div>
					</div>

					{/* Dev: verify commands */}
					{preset === "dev" && (
						<div className="space-y-1">
							<label className="block text-sm text-muted-foreground">
								验证命令 (每行一条，留空自动检测)
							</label>
							<Textarea
								value={verifyCommands}
								onChange={(e) => setVerifyCommands(e.target.value)}
								placeholder={"bun test\nbun run check"}
								rows={2}
								className="font-mono text-xs"
							/>
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						取消
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!agentId || !prompt.trim() || !workDir.trim() || spawning}
					>
						{spawning && <Loader2 className="size-4 animate-spin" />}
						启动
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
