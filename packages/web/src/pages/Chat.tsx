import { useEffect, useRef, useState } from "react";
import { type AgentEvent, sendChatMessage } from "../lib/api";

interface ChatMessage {
	role: "user" | "assistant";
	content: string;
	toolCalls?: { name: string; args: unknown; result?: unknown }[];
	isStreaming?: boolean;
}

export function Chat() {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
	}, []);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		const text = input.trim();
		if (!text || isStreaming) return;

		setInput("");
		setMessages((prev) => [...prev, { role: "user", content: text }]);

		// Add streaming placeholder
		setMessages((prev) => [
			...prev,
			{ role: "assistant", content: "", isStreaming: true, toolCalls: [] },
		]);
		setIsStreaming(true);

		try {
			await sendChatMessage("main", "agent:main:main", text, (event: AgentEvent) => {
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
			});
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

	return (
		<div className="flex flex-col h-full">
			<header className="border-b border-gray-800 px-6 py-3 flex items-center justify-between">
				<h2 className="text-lg font-semibold">Chat</h2>
				<span className="text-xs text-gray-500">agent:main</span>
			</header>

			<div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-4">
				{messages.length === 0 && (
					<div className="text-gray-500 text-center mt-20">
						Start a conversation with your AI assistant
					</div>
				)}
				{messages.map((msg, i) => (
					<div key={i} className={`max-w-2xl ${msg.role === "user" ? "ml-auto" : "mr-auto"}`}>
						{/* Tool calls */}
						{msg.toolCalls && msg.toolCalls.length > 0 && (
							<div className="mb-2 space-y-1">
								{msg.toolCalls.map((tc, j) => (
									<details
										key={j}
										className="bg-gray-900 border border-gray-700 rounded-lg text-xs"
									>
										<summary className="px-3 py-1.5 cursor-pointer text-gray-400 hover:text-gray-200">
											Tool: {tc.name}
											{tc.result ? " ✓" : " ⏳"}
										</summary>
										<div className="px-3 py-2 border-t border-gray-700">
											<div className="text-gray-500 mb-1">Args:</div>
											<pre className="text-gray-300 whitespace-pre-wrap break-all">
												{JSON.stringify(tc.args, null, 2)}
											</pre>
											{tc.result && (
												<>
													<div className="text-gray-500 mt-2 mb-1">Result:</div>
													<pre className="text-gray-300 whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
														{typeof tc.result === "string"
															? tc.result
															: JSON.stringify(tc.result, null, 2)}
													</pre>
												</>
											)}
										</div>
									</details>
								))}
							</div>
						)}

						{/* Message bubble */}
						{(msg.content || msg.role === "user") && (
							<div
								className={`px-4 py-2 rounded-2xl whitespace-pre-wrap ${
									msg.role === "user" ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-100"
								}`}
							>
								{msg.content}
								{msg.isStreaming && (
									<span className="inline-block w-2 h-4 ml-0.5 bg-gray-400 animate-pulse" />
								)}
							</div>
						)}
					</div>
				))}
			</div>

			<form onSubmit={handleSubmit} className="border-t border-gray-800 p-4 flex gap-3">
				<input
					type="text"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="Type a message..."
					disabled={isStreaming}
					className="flex-1 bg-gray-800 rounded-xl px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
				/>
				<button
					type="submit"
					disabled={isStreaming || !input.trim()}
					className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-xl transition-colors"
				>
					{isStreaming ? "..." : "Send"}
				</button>
			</form>
		</div>
	);
}
