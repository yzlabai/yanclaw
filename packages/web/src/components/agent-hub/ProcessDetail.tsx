import {
	ChatContainerContent,
	ChatContainerRoot,
} from "@yanclaw/web/components/prompt-kit/chat-container";
import { Markdown } from "@yanclaw/web/components/prompt-kit/markdown";
import {
	PromptInput,
	PromptInputActions,
	PromptInputTextarea,
} from "@yanclaw/web/components/prompt-kit/prompt-input";
import { ToolCall } from "@yanclaw/web/components/prompt-kit/tool-call";
import { Badge } from "@yanclaw/web/components/ui/badge";
import { Button } from "@yanclaw/web/components/ui/button";
import type { AgentProcess } from "@yanclaw/web/hooks/useAgentHub";
import { type StreamMessage, useProcessEvents } from "@yanclaw/web/hooks/useProcessEvents";
import { API_BASE, apiFetch } from "@yanclaw/web/lib/api";
import { cn } from "@yanclaw/web/lib/utils";
import { ArrowLeft, GitBranch, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

function formatTokens(n: number): string {
	if (n < 1000) return String(n);
	return `${(n / 1000).toFixed(1)}k`;
}

interface ProcessDetailProps {
	process: AgentProcess;
	onStop: () => void;
	onSend: (message: string) => void;
	onBack?: () => void;
}

interface WorktreeInfo {
	path: string;
	branch: string;
	commitCount: number;
	changedFiles: number;
}

export function ProcessDetail({ process, onStop, onSend, onBack }: ProcessDetailProps) {
	const { messages, connected, addUserMessage } = useProcessEvents(process.id);
	const [input, setInput] = useState("");
	const [worktreeInfo, setWorktreeInfo] = useState<WorktreeInfo | null>(null);
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

	// Fetch worktree info if process has a worktree
	useEffect(() => {
		if (!process.worktreePath) return;
		apiFetch(`${API_BASE}/api/agent-hub/processes/${process.id}/worktree`)
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => {
				if (data?.worktree) setWorktreeInfo(data.worktree);
			})
			.catch(() => {});
	}, [process.id, process.worktreePath]);

	const handleSubmit = useCallback(() => {
		const text = input.trim();
		if (!text) return;
		addUserMessage(text);
		onSend(text);
		setInput("");
	}, [input, onSend, addUserMessage]);

	return (
		<div className="flex flex-col h-full">
			{/* Top info bar */}
			<div className="border-b border-border bg-card p-4 space-y-2">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						{onBack && (
							<Button variant="ghost" size="icon-xs" onClick={onBack}>
								<ArrowLeft className="size-4" />
							</Button>
						)}
						<span className="font-medium">{process.agentId}</span>
						<StatusDot status={process.status} />
					</div>
					<div className="flex items-center gap-1">
						{process.status !== "stopped" && process.status !== "error" && (
							<Button variant="ghost" size="icon-sm" onClick={onStop}>
								<Square className="size-4" />
							</Button>
						)}
					</div>
				</div>

				{process.task && <p className="text-sm text-muted-foreground">任务: {process.task}</p>}

				<div className="flex items-center gap-4 text-xs text-muted-foreground">
					<span className="font-mono truncate max-w-xs">{process.workDir}</span>
					<span className="tabular-nums">
						Token: {formatTokens(process.tokenUsage.input)} 输入 /{" "}
						{formatTokens(process.tokenUsage.output)} 输出
					</span>
					<span className="tabular-nums">
						{Math.floor(elapsed / 60000)}m {Math.floor((elapsed % 60000) / 1000)}s
					</span>
					{!connected && (
						<Badge variant="outline" className="bg-red-500/20 text-red-400 border-red-500/30">
							断开
						</Badge>
					)}
				</div>

				{worktreeInfo && (
					<div className="flex items-center gap-3 text-xs">
						<span className="flex items-center gap-1 text-muted-foreground">
							<GitBranch className="size-3" />
							<span className="font-mono">{worktreeInfo.branch}</span>
						</span>
						{worktreeInfo.commitCount > 0 && (
							<Badge variant="secondary" className="text-xs">
								{worktreeInfo.commitCount} commit{worktreeInfo.commitCount !== 1 ? "s" : ""}
							</Badge>
						)}
						{worktreeInfo.changedFiles > 0 && (
							<Badge variant="outline" className="text-xs text-amber-400 border-amber-500/30">
								{worktreeInfo.changedFiles} 文件变更
							</Badge>
						)}
						{(process.status === "stopped" || process.status === "idle") && (
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={() => {
									apiFetch(`${API_BASE}/api/agent-hub/processes/${process.id}/worktree`, {
										method: "DELETE",
									}).then(() => setWorktreeInfo(null));
								}}
								title="清理 Worktree"
							>
								<Trash2 className="size-3" />
							</Button>
						)}
					</div>
				)}

				{process.error && (
					<div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
						{process.error}
					</div>
				)}
			</div>

			{/* Output stream */}
			<ChatContainerRoot className="flex-1 min-h-0">
				<ChatContainerContent className="p-4 space-y-3">
					{messages.length === 0 && (
						<div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
							等待 Agent 输出...
						</div>
					)}
					{messages.map((msg) => (
						<MessageBubble key={msg.id} message={msg} />
					))}
				</ChatContainerContent>
			</ChatContainerRoot>

			{/* Input area */}
			<div className="border-t border-border bg-card p-3">
				<PromptInput
					value={input}
					onValueChange={setInput}
					onSubmit={handleSubmit}
					className="rounded-xl border border-input bg-background"
				>
					<PromptInputTextarea placeholder="向此 Agent 发送指令..." />
					<PromptInputActions>
						<Button
							size="sm"
							onClick={handleSubmit}
							disabled={!input.trim() || process.status === "stopped"}
						>
							发送
						</Button>
					</PromptInputActions>
				</PromptInput>
			</div>
		</div>
	);
}

function StatusDot({ status }: { status: string }) {
	const colors: Record<string, string> = {
		starting: "bg-blue-500 animate-pulse",
		running: "bg-green-500 animate-pulse",
		"waiting-approval": "bg-amber-500 animate-pulse",
		idle: "bg-gray-400",
		stopped: "bg-gray-500",
		error: "bg-red-500",
	};
	return <span className={cn("size-2 rounded-full", colors[status] ?? "bg-gray-400")} />;
}

function MessageBubble({ message }: { message: StreamMessage }) {
	if (message.role === "user") {
		return (
			<div className="flex justify-end">
				<div className="rounded-2xl bg-primary px-4 py-2 text-primary-foreground max-w-[80%]">
					<p className="text-sm whitespace-pre-wrap">{message.content}</p>
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-2 max-w-[90%]">
			{message.thinking && (
				<div className="text-sm text-muted-foreground italic border-l-2 border-muted pl-3">
					{message.thinking.slice(0, 200)}
					{message.thinking.length > 200 && "..."}
				</div>
			)}

			{message.content && (
				<div className="rounded-2xl bg-muted px-4 py-2">
					<Markdown>{message.content}</Markdown>
				</div>
			)}

			{message.toolCalls.map((tc, i) => (
				<ToolCall
					key={`${message.id}-tc-${i}`}
					name={tc.name}
					input={JSON.stringify(tc.args, null, 2)}
					output={tc.result != null ? String(tc.result) : undefined}
					status={tc.status === "done" ? "done" : "running"}
				/>
			))}
		</div>
	);
}
