import { ArrowUp, Paperclip, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChatContainerContent, ChatContainerRoot } from "../components/prompt-kit/chat-container";
import { TypingLoader } from "../components/prompt-kit/loader";
import { Message, MessageAvatar, MessageContent } from "../components/prompt-kit/message";
import {
	PromptInput,
	PromptInputActions,
	PromptInputTextarea,
} from "../components/prompt-kit/prompt-input";
import { ScrollButton } from "../components/prompt-kit/scroll-button";
import { ToolCall } from "../components/prompt-kit/tool-call";
import { Button } from "../components/ui/button";
import { type AgentEvent, API_BASE, apiFetch, sendChatMessage, uploadMedia } from "../lib/api";

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	toolCalls?: { name: string; args: unknown; result?: unknown }[];
	isStreaming?: boolean;
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
		if ((!text && attachments.length === 0) || isStreaming) return;

		const sessionKey = getSessionKey();
		if (!currentSession) setCurrentSession(sessionKey);

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
		if (filesToUpload.length > 0) {
			setUploading(true);
			try {
				const results = await Promise.all(filesToUpload.map((f) => uploadMedia(f, sessionKey)));
				imageUrls = results.map((r) => `${API_BASE}/api/media/${r.id}`);
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
									updated[updated.length - 1] = { ...last, toolCalls: calls };
								}
								return updated;
							});
							break;

						case "done":
							setMessages((prev) => {
								const updated = [...prev];
								const last = updated[updated.length - 1];
								if (last?.role === "assistant") {
									updated[updated.length - 1] = { ...last, isStreaming: false };
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

	return (
		<div className="flex h-full">
			{/* Session sidebar */}
			<div className="w-64 border-r border-gray-800 flex flex-col">
				<div className="p-3 border-b border-gray-800">
					<select
						value={currentAgent}
						onChange={(e) => {
							setCurrentAgent(e.target.value);
							startNewSession();
						}}
						className="w-full bg-gray-800 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-blue-500"
					>
						{agents.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
				</div>

				<div className="p-3 border-b border-gray-800">
					<button
						type="button"
						onClick={startNewSession}
						className="w-full bg-gray-800 hover:bg-gray-700 text-white text-sm px-3 py-1.5 rounded-lg transition-colors"
					>
						+ New Chat
					</button>
				</div>

				<div className="flex-1 overflow-y-auto">
					{sessions.map((s) => (
						<div
							key={s.key}
							className={`group flex items-center gap-1 px-3 py-2 cursor-pointer border-b border-gray-800/50 transition-colors ${
								currentSession === s.key
									? "bg-gray-800 text-white"
									: "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200"
							}`}
						>
							<button
								type="button"
								onClick={() => loadSession(s.key)}
								className="flex-1 min-w-0 text-left"
							>
								<div className="text-sm truncate">{s.title || s.key.split(":").pop()}</div>
								<div className="text-xs text-gray-500 flex gap-2">
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
								className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 text-xs px-1 transition-opacity"
							>
								x
							</button>
						</div>
					))}
				</div>
			</div>

			{/* Chat area */}
			<div
				className={`flex-1 flex flex-col relative ${isDragOver ? "ring-2 ring-blue-500 ring-inset" : ""}`}
				onDrop={handleDrop}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
			>
				{isDragOver && (
					<div className="absolute inset-0 bg-blue-500/10 z-50 flex items-center justify-center pointer-events-none">
						<div className="text-blue-400 text-lg font-medium">Drop files here</div>
					</div>
				)}

				<header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
					<h2 className="text-lg font-semibold">{currentAgentName}</h2>
					<span className="text-xs text-gray-500">{currentSession ?? "New conversation"}</span>
				</header>

				<ChatContainerRoot className="flex-1">
					<ChatContainerContent className="p-6 space-y-4">
						{messages.length === 0 && (
							<div className="text-gray-500 text-center mt-20">
								Start a conversation with {currentAgentName}
							</div>
						)}

						{messages.map((msg, i) =>
							msg.role === "user" ? (
								<Message key={i} className="justify-end">
									<MessageContent className="bg-blue-600 text-white max-w-2xl">
										{msg.content}
									</MessageContent>
								</Message>
							) : (
								<Message key={i}>
									<MessageAvatar alt={currentAgentName} fallback="AI" />
									<div className="flex-1 min-w-0 max-w-2xl space-y-2">
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
												className="bg-gray-800 text-gray-100 prose prose-invert prose-sm max-w-none prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-700 prose-code:text-blue-300"
											>
												{msg.content}
											</MessageContent>
										) : msg.isStreaming && (!msg.toolCalls || msg.toolCalls.length === 0) ? (
											<div className="bg-gray-800 rounded-2xl px-4 py-3">
												<TypingLoader />
											</div>
										) : null}

										{/* Streaming cursor */}
										{msg.isStreaming && msg.content && (
											<span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-sm" />
										)}
									</div>
								</Message>
							),
						)}
					</ChatContainerContent>
					<ScrollButton />
				</ChatContainerRoot>

				{/* Input */}
				<div className="border-t border-gray-800 p-4">
					{/* Attachment preview */}
					{attachments.length > 0 && (
						<div className="flex flex-wrap gap-2 mb-2">
							{attachments.map((file, i) => (
								<div
									key={`${file.name}-${i}`}
									className="flex items-center gap-1.5 bg-gray-800 rounded-lg px-3 py-1.5 text-sm text-gray-300"
								>
									<span className="truncate max-w-[150px]">{file.name}</span>
									<span className="text-gray-500 text-xs">
										{file.size < 1024 ? `${file.size}B` : `${Math.round(file.size / 1024)}KB`}
									</span>
									<button
										type="button"
										onClick={() => removeAttachment(i)}
										className="text-gray-500 hover:text-red-400 ml-1"
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
						isLoading={isStreaming || uploading}
						onSubmit={handleSubmit}
						disabled={isStreaming || uploading}
						className="border-gray-700 bg-gray-900"
					>
						<PromptInputTextarea
							placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
							className="text-white placeholder-gray-500"
						/>
						<PromptInputActions className="justify-between pt-1 px-1">
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 rounded-full text-gray-400 hover:text-white"
								onClick={() => fileInputRef.current?.click()}
								disabled={isStreaming || uploading}
							>
								<Paperclip className="h-4 w-4" />
							</Button>
							{isStreaming ? (
								<Button
									variant="ghost"
									size="icon"
									className="h-8 w-8 rounded-full"
									onClick={() => {
										/* TODO: cancel */
									}}
								>
									<Square className="h-4 w-4 text-gray-400" />
								</Button>
							) : (
								<Button
									variant="default"
									size="icon"
									className="h-8 w-8 rounded-full bg-blue-600 hover:bg-blue-700"
									onClick={handleSubmit}
									disabled={!input.trim() && attachments.length === 0}
								>
									<ArrowUp className="h-4 w-4" />
								</Button>
							)}
						</PromptInputActions>
					</PromptInput>
				</div>
			</div>
		</div>
	);
}
