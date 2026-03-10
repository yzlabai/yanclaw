import { ArrowUp, Menu, Paperclip, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatContainerContent, ChatContainerRoot } from "../components/prompt-kit/chat-container";
import { FileAttachment } from "../components/prompt-kit/file-attachment";
import { TypingLoader } from "../components/prompt-kit/loader";
import { Message, MessageAvatar, MessageContent } from "../components/prompt-kit/message";
import {
	PromptInput,
	PromptInputActions,
	PromptInputTextarea,
} from "../components/prompt-kit/prompt-input";
import { ScrollButton } from "../components/prompt-kit/scroll-button";
import { ThinkingPanel } from "../components/prompt-kit/thinking-panel";
import { ToolCall } from "../components/prompt-kit/tool-call";
import { Button } from "../components/ui/button";
import {
	type AgentEvent,
	API_BASE,
	apiFetch,
	cancelChat,
	sendChatMessage,
	steerChat,
	uploadMedia,
} from "../lib/api";

interface AttachmentInfo {
	filename: string;
	size: number;
	mimeType: string;
	url: string;
}

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	toolCalls?: { name: string; args: unknown; result?: unknown }[];
	attachments?: AttachmentInfo[];
	thinking?: string;
	thinkingStartedAt?: number;
	thinkingDurationMs?: number;
	isStreaming?: boolean;
	isPending?: boolean;
	isAborted?: boolean;
}

interface SessionInfo {
	key: string;
	agentId: string;
	title: string | null;
	messageCount: number;
	updatedAt: number;
}

interface AgentInfo {
	id: string;
	name: string;
	model: string;
}

export function Chat() {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [attachments, setAttachments] = useState<File[]>([]);
	const [isDragOver, setIsDragOver] = useState(false);
	const [uploading, setUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const [sessions, setSessions] = useState<SessionInfo[]>([]);
	const [agents, setAgents] = useState<AgentInfo[]>([]);
	const [currentAgent, setCurrentAgent] = useState("main");
	const [currentSession, setCurrentSession] = useState<string | null>(null);
	const [showSidebar, setShowSidebar] = useState(false);

	useEffect(() => {
		apiFetch(`${API_BASE}/api/agents`)
			.then((r) => r.json())
			.then((data: AgentInfo[]) => setAgents(data))
			.catch(() => {});
	}, []);

	const fetchSessions = useCallback(() => {
		apiFetch(`${API_BASE}/api/sessions?agentId=${currentAgent}&limit=50`)
			.then((r) => r.json())
			.then((data: { sessions: SessionInfo[] }) => setSessions(data.sessions))
			.catch(() => {});
	}, [currentAgent]);

	useEffect(() => {
		fetchSessions();
	}, [fetchSessions]);

	const loadSession = useCallback(
		(sessionKey: string) => {
			if (sessionKey === currentSession) return;
			setCurrentSession(sessionKey);
			setMessages([]);

			apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionKey)}`)
				.then((r) => r.json())
				.then(
					(data: {
						messages?: Array<{
							role: string;
							content: string | null;
							toolCalls: string | null;
						}>;
					}) => {
						if (data.messages) {
							const loaded: ChatMessage[] = data.messages
								.filter((m) => m.role === "user" || m.role === "assistant")
								.map((m) => ({
									role: m.role as "user" | "assistant",
									content: m.content ?? "",
									toolCalls: m.toolCalls
										? (() => {
												try {
													return JSON.parse(m.toolCalls);
												} catch {
													return undefined;
												}
											})()
										: undefined,
								}));
							setMessages(loaded);
						}
					},
				)
				.catch(() => {});
		},
		[currentSession],
	);

	const startNewSession = () => {
		setCurrentSession(null);
		setMessages([]);
		setInput("");
	};

	const deleteSession = async (key: string) => {
		const res = await apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(key)}`, {
			method: "DELETE",
		});
		if (res.ok) {
			if (currentSession === key) startNewSession();
			fetchSessions();
		}
	};

	const addFiles = (files: FileList | File[]) => {
		const MAX_FILES = 10;
		const MAX_SIZE = 50 * 1024 * 1024; // 50MB
		const arr = Array.from(files).filter((f) => {
			if (f.size > MAX_SIZE) {
				console.warn(`File too large: ${f.name} (${f.size} bytes)`);
				return false;
			}
			return true;
		});
		setAttachments((prev) => [...prev, ...arr].slice(0, MAX_FILES));
	};

	const removeAttachment = (index: number) => {
		setAttachments((prev) => prev.filter((_, i) => i !== index));
	};

	const handleDrop = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
		if (e.dataTransfer.files.length > 0) {
			addFiles(e.dataTransfer.files);
		}
	};

	const handleDragOver = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(true);
	};

	const handleDragLeave = (e: React.DragEvent) => {
		e.preventDefault();
		setIsDragOver(false);
	};

	const getSessionKey = () => {
		if (currentSession) return currentSession;
		const ts = Date.now().toString(36);
		return `agent:${currentAgent}:${ts}`;
	};

	const handleSubmit = async () => {
		const text = input.trim();
		if (!text && attachments.length === 0) return;

		const sessionKey = getSessionKey();
		if (!currentSession) setCurrentSession(sessionKey);

		// If streaming, send as steering message instead
		if (isStreaming && text) {
			setInput("");
			// Add user message as pending
			setMessages((prev) => [...prev, { role: "user", content: text, isPending: true }]);
			try {
				const result = await steerChat(sessionKey, text);
				if (result.intent === "cancel") {
					// Mark the pending message as no longer pending
					setMessages((prev) => {
						const updated = [...prev];
						const last = updated[updated.length - 1];
						if (last?.role === "user" && last.isPending) {
							updated[updated.length - 1] = { ...last, isPending: false };
						}
						return updated;
					});
				}
				// For supplement/redirect, the message is queued server-side
				// and will be processed after current run finishes
			} catch {
				// If steer fails, remove the pending message
				setMessages((prev) => {
					if (prev[prev.length - 1]?.isPending) return prev.slice(0, -1);
					return prev;
				});
			}
			return;
		}

		const filesToUpload = [...attachments];
		setInput("");
		setAttachments([]);
		setMessages((prev) => [
			...prev,
			{ role: "user", content: text },
			{ role: "assistant", content: "", isStreaming: true, toolCalls: [] },
		]);
		setIsStreaming(true);

		// Upload attachments
		let imageUrls: string[] | undefined;
		let uploadedAttachments: AttachmentInfo[] | undefined;
		if (filesToUpload.length > 0) {
			setUploading(true);
			try {
				const results = await Promise.all(filesToUpload.map((f) => uploadMedia(f, sessionKey)));
				imageUrls = results.map((r) => `${API_BASE}/api/media/${r.id}`);
				uploadedAttachments = results.map((r) => ({
					filename: r.filename,
					size: r.size,
					mimeType: r.mimeType,
					url: `${API_BASE}/api/media/${r.id}`,
				}));
			} catch {
				setMessages((prev) => {
					const updated = [...prev];
					const last = updated[updated.length - 1];
					if (last?.role === "assistant") {
						updated[updated.length - 1] = {
							...last,
							content: "Failed to upload attachments.",
							isStreaming: false,
						};
					}
					return updated;
				});
				setIsStreaming(false);
				setUploading(false);
				return;
			}
			setUploading(false);
		}

		// Attach uploaded files to user message
		if (uploadedAttachments) {
			setMessages((prev) => {
				const updated = [...prev];
				const userMsgIdx = updated.length - 2;
				if (userMsgIdx >= 0 && updated[userMsgIdx].role === "user") {
					updated[userMsgIdx] = { ...updated[userMsgIdx], attachments: uploadedAttachments };
				}
				return updated;
			});
		}

		try {
			await sendChatMessage(
				currentAgent,
				sessionKey,
				text || "(see attached files)",
				(event: AgentEvent) => {
					switch (event.type) {
						case "delta":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant") {
									updated[updated.length - 1] = {
										...last,
										content: last.content + event.text,
									};
								}
								return updated;
							});
							break;

						case "thinking":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant") {
									updated[updated.length - 1] = {
										...last,
										thinking: (last.thinking ?? "") + event.text,
										thinkingStartedAt: last.thinkingStartedAt ?? Date.now(),
									};
								}
								return updated;
							});
							break;

						case "tool_call":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant") {
									updated[updated.length - 1] = {
										...last,
										toolCalls: [...(last.toolCalls ?? []), { name: event.name, args: event.args }],
									};
								}
								return updated;
							});
							break;

						case "tool_result":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant" && last.toolCalls) {
									const calls = [...last.toolCalls];
									const callIdx = calls.findIndex((c) => c.name === event.name && !c.result);
									if (callIdx >= 0) {
										calls[callIdx] = { ...calls[callIdx], result: event.result };
									}

									// Extract media attachment from file_write results
									let newAttachments = last.attachments;
									if (event.name === "file_write" && typeof event.result === "string") {
										try {
											const parsed = JSON.parse(event.result) as {
												mediaUrl?: string;
												filename?: string;
												mimeType?: string;
												size?: number;
											};
											if (parsed.mediaUrl) {
												newAttachments = [
													...(newAttachments ?? []),
													{
														filename: parsed.filename ?? "file",
														size: parsed.size ?? 0,
														mimeType: parsed.mimeType ?? "application/octet-stream",
														url: `${API_BASE}${parsed.mediaUrl}`,
													},
												];
											}
										} catch {
											// Not JSON — ignore
										}
									}

									updated[updated.length - 1] = {
										...last,
										toolCalls: calls,
										attachments: newAttachments,
									};
								}
								return updated;
							});
							break;

						case "aborted":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant") {
									updated[updated.length - 1] = {
										...last,
										isStreaming: false,
										isAborted: true,
										thinkingDurationMs: last.thinkingStartedAt
											? Date.now() - last.thinkingStartedAt
											: undefined,
									};
								}
								return updated;
							});
							break;

						case "steering_resume":
							// A queued message is now being processed — clear pending flag
							// and add new assistant response placeholder
							setMessages((prev) => {
								const updated = [...prev];
								// Find and un-flag the pending user message
								for (let k = updated.length - 1; k >= 0; k--) {
									if (updated[k].role === "user" && updated[k].isPending) {
										updated[k] = { ...updated[k], isPending: false };
										break;
									}
								}
								// Add new assistant placeholder
								updated.push({
									role: "assistant",
									content: "",
									isStreaming: true,
									toolCalls: [],
								});
								return updated;
							});
							break;

						case "done":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant") {
									updated[updated.length - 1] = {
										...last,
										isStreaming: false,
										thinkingDurationMs: last.thinkingStartedAt
											? Date.now() - last.thinkingStartedAt
											: undefined,
									};
								}
								return updated;
							});
							fetchSessions();
							break;

						case "error":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant") {
									updated[updated.length - 1] = {
										...last,
										content: last.content || `Error: ${event.message}`,
										isStreaming: false,
									};
								}
								return updated;
							});
							break;
					}
				},
				imageUrls,
			);
		} catch (err) {
			setMessages((prev) => {
				const updated = [...prev];
				const last = updated[updated.length - 1];
				if (last?.role === "assistant") {
					updated[updated.length - 1] = {
						...last,
						content: `Connection error: ${err instanceof Error ? err.message : "Unknown"}`,
						isStreaming: false,
					};
				}
				return updated;
			});
		} finally {
			setIsStreaming(false);
		}
	};

	const formatTime = (ts: number) => {
		const d = new Date(ts);
		const now = new Date();
		if (d.toDateString() === now.toDateString()) {
			return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
		}
		return d.toLocaleDateString([], { month: "short", day: "numeric" });
	};

	const currentAgentName = agents.find((a) => a.id === currentAgent)?.name ?? currentAgent;

	const sidebarContent = (
		<>
			<div className="p-3 border-b border-border">
				<select
					value={currentAgent}
					onChange={(e) => {
						setCurrentAgent(e.target.value);
						startNewSession();
					}}
					className="w-full bg-muted rounded-lg px-3 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
				>
					{agents.map((a) => (
						<option key={a.id} value={a.id}>
							{a.name}
						</option>
					))}
				</select>
			</div>

			<div className="p-3 border-b border-border">
				<button
					type="button"
					onClick={() => {
						startNewSession();
						setShowSidebar(false);
					}}
					className="w-full bg-muted hover:bg-accent text-foreground text-sm px-3 py-1.5 rounded-lg transition-colors"
				>
					+ New Chat
				</button>
			</div>

			<div className="flex-1 overflow-y-auto">
				{sessions.map((s) => (
					<div
						key={s.key}
						className={`group flex items-center gap-1 px-3 py-2 cursor-pointer border-b border-border/50 transition-colors ${
							currentSession === s.key
								? "bg-muted text-foreground"
								: "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
						}`}
					>
						<button
							type="button"
							onClick={() => {
								loadSession(s.key);
								setShowSidebar(false);
							}}
							className="flex-1 min-w-0 text-left"
						>
							<div className="text-sm truncate">{s.title || s.key.split(":").pop()}</div>
							<div className="text-xs text-muted-foreground flex gap-2">
								<span>{s.messageCount} msgs</span>
								<span>{formatTime(s.updatedAt)}</span>
							</div>
						</button>
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								deleteSession(s.key);
							}}
							className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-400 text-xs px-1 transition-opacity"
						>
							x
						</button>
					</div>
				))}
			</div>
		</>
	);

	return (
		<div className="flex h-full">
			{/* Desktop session sidebar */}
			<div className="hidden md:flex w-64 border-r border-border flex-col">{sidebarContent}</div>

			{/* Mobile session sidebar overlay */}
			{showSidebar && (
				<div
					className="fixed inset-0 bg-black/50 z-40 md:hidden"
					onClick={() => setShowSidebar(false)}
					onKeyDown={(e) => e.key === "Escape" && setShowSidebar(false)}
					role="presentation"
				/>
			)}
			<div
				className={`fixed inset-y-0 left-0 w-72 bg-background border-r border-border flex flex-col z-50 transition-transform duration-200 md:hidden ${
					showSidebar ? "translate-x-0" : "-translate-x-full"
				}`}
			>
				<div className="flex items-center justify-between p-3 border-b border-border">
					<span className="text-sm font-semibold">Sessions</span>
					<button
						type="button"
						onClick={() => setShowSidebar(false)}
						className="p-1 text-muted-foreground hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				{sidebarContent}
			</div>

			{/* Chat area */}
			<div
				className={`flex-1 flex flex-col relative ${isDragOver ? "ring-2 ring-primary ring-inset" : ""}`}
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
			>
				{isDragOver && (
					<div className="absolute inset-0 bg-primary/10 z-50 flex items-center justify-center pointer-events-none">
						<div className="text-primary text-lg font-medium">Drop files here</div>
					</div>
				)}

				<header className="border-b border-border px-4 md:px-6 py-3 flex items-center justify-between gap-2">
					<div className="flex items-center gap-2">
						<button
							type="button"
							onClick={() => setShowSidebar(true)}
							className="md:hidden p-1 text-muted-foreground hover:text-foreground"
						>
							<Menu className="h-5 w-5" />
						</button>
						<h2 className="text-lg font-semibold">{currentAgentName}</h2>
					</div>
					<span className="text-xs text-muted-foreground truncate">
						{currentSession ?? "New conversation"}
					</span>
				</header>

				<ChatContainerRoot className="flex-1">
					<ChatContainerContent className="p-6 space-y-4">
						{messages.length === 0 && (
							<div className="text-muted-foreground text-center mt-20">
								Start a conversation with {currentAgentName}
							</div>
						)}

						{messages.map((msg, i) =>
							msg.role === "user" ? (
								<Message key={i} className="justify-end">
									<div className="max-w-2xl space-y-2">
										<MessageContent
											className={`bg-primary text-primary-foreground ${msg.isPending ? "opacity-60" : ""}`}
										>
											{msg.content}
											{msg.isPending && (
												<span className="block text-xs opacity-70 mt-1 italic">
													Queued — waiting for current response...
												</span>
											)}
										</MessageContent>
										{msg.attachments && msg.attachments.length > 0 && (
											<div className="flex flex-wrap gap-2 justify-end">
												{msg.attachments.map((att) => (
													<FileAttachment key={att.url} {...att} />
												))}
											</div>
										)}
									</div>
								</Message>
							) : (
								<Message key={i}>
									<MessageAvatar alt={currentAgentName} fallback="AI" />
									<div className="flex-1 min-w-0 max-w-2xl space-y-2">
										{/* Thinking panel */}
										{msg.thinking && (
											<ThinkingPanel
												content={msg.thinking}
												isStreaming={msg.isStreaming && !msg.content}
												durationMs={msg.thinkingDurationMs}
											/>
										)}

										{/* Tool calls */}
										{msg.toolCalls && msg.toolCalls.length > 0 && (
											<div className="space-y-1">
												{msg.toolCalls.map((tc, j) => (
													<ToolCall
														key={j}
														name={tc.name}
														args={tc.args}
														result={tc.result}
														isStreaming={!tc.result && msg.isStreaming}
													/>
												))}
											</div>
										)}

										{/* Message content */}
										{msg.content ? (
											<MessageContent
												markdown
												className="bg-muted text-foreground prose dark:prose-invert prose-sm max-w-none prose-pre:bg-card prose-pre:border prose-pre:border-border prose-code:text-primary"
											>
												{msg.content}
											</MessageContent>
										) : msg.isStreaming &&
											(!msg.toolCalls || msg.toolCalls.length === 0) &&
											!msg.thinking ? (
											<div className="bg-muted rounded-2xl px-4 py-3">
												<TypingLoader />
											</div>
										) : null}

										{/* Attachments from assistant */}
										{msg.attachments && msg.attachments.length > 0 && (
											<div className="flex flex-wrap gap-2">
												{msg.attachments.map((att) => (
													<FileAttachment key={att.url} {...att} />
												))}
											</div>
										)}

										{/* Aborted indicator */}
										{msg.isAborted && (
											<div className="text-xs text-muted-foreground italic">
												Response interrupted
											</div>
										)}

										{/* Streaming cursor */}
										{msg.isStreaming && msg.content && (
											<span className="inline-block w-2 h-4 bg-muted-foreground animate-pulse rounded-sm" />
										)}
									</div>
								</Message>
							),
						)}
					</ChatContainerContent>
					<ScrollButton />
				</ChatContainerRoot>

				{/* Input */}
				<div className="border-t border-border p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
					{/* Attachment preview */}
					{attachments.length > 0 && (
						<div className="flex flex-wrap gap-2 mb-2">
							{attachments.map((file, i) => (
								<div
									key={`${file.name}-${i}`}
									className="flex items-center gap-1.5 bg-muted rounded-lg px-3 py-1.5 text-sm text-foreground/80"
								>
									<span className="truncate max-w-[150px]">{file.name}</span>
									<span className="text-muted-foreground text-xs">
										{file.size < 1024 ? `${file.size}B` : `${Math.round(file.size / 1024)}KB`}
									</span>
									<button
										type="button"
										onClick={() => removeAttachment(i)}
										className="text-muted-foreground hover:text-red-400 ml-1"
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							))}
						</div>
					)}

					<input
						ref={fileInputRef}
						type="file"
						multiple
						className="hidden"
						onChange={(e) => {
							if (e.target.files) addFiles(e.target.files);
							e.target.value = "";
						}}
					/>

					<PromptInput
						value={input}
						onValueChange={setInput}
						isLoading={uploading}
						onSubmit={handleSubmit}
						disabled={uploading}
						className="border-border bg-card"
					>
						<PromptInputTextarea
							placeholder={
								isStreaming
									? "Send a follow-up while the agent is responding..."
									: "Type a message... (Enter to send, Shift+Enter for new line)"
							}
							className="text-foreground placeholder-muted-foreground"
						/>
						<PromptInputActions className="justify-between pt-1 px-1">
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
									onClick={() => fileInputRef.current?.click()}
									disabled={isStreaming || uploading}
								>
									<Paperclip className="h-4 w-4" />
								</Button>
								{isStreaming && (
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 rounded-full text-muted-foreground hover:text-red-400"
										onClick={() => {
											if (currentSession) cancelChat(currentSession);
										}}
										title="Stop generating"
									>
										<Square className="h-4 w-4" />
									</Button>
								)}
							</div>
							<Button
								variant="default"
								size="icon"
								className="h-8 w-8 rounded-full bg-primary hover:bg-primary/90"
								onClick={handleSubmit}
								disabled={!input.trim() && attachments.length === 0}
							>
								<ArrowUp className="h-4 w-4" />
							</Button>
						</PromptInputActions>
					</PromptInput>
				</div>
			</div>
		</div>
	);
}
