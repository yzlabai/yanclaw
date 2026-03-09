import { useState } from "react";

export function Chat() {
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<
		{ role: "user" | "assistant"; content: string }[]
	>([]);

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!input.trim()) return;

		setMessages((prev) => [...prev, { role: "user", content: input }]);
		// TODO: send to agent via API, stream response
		setMessages((prev) => [
			...prev,
			{ role: "assistant", content: "Agent response coming soon..." },
		]);
		setInput("");
	};

	return (
		<div className="flex flex-col h-full">
			<header className="border-b border-gray-800 px-6 py-3">
				<h2 className="text-lg font-semibold">Chat</h2>
			</header>

			<div className="flex-1 overflow-y-auto p-6 space-y-4">
				{messages.length === 0 && (
					<div className="text-gray-500 text-center mt-20">
						Start a conversation with your AI assistant
					</div>
				)}
				{messages.map((msg, i) => (
					<div
						key={i}
						className={`max-w-2xl ${msg.role === "user" ? "ml-auto" : "mr-auto"}`}
					>
						<div
							className={`px-4 py-2 rounded-2xl ${
								msg.role === "user"
									? "bg-blue-600 text-white"
									: "bg-gray-800 text-gray-100"
							}`}
						>
							{msg.content}
						</div>
					</div>
				))}
			</div>

			<form
				onSubmit={handleSubmit}
				className="border-t border-gray-800 p-4 flex gap-3"
			>
				<input
					type="text"
					value={input}
					onChange={(e) => setInput(e.target.value)}
					placeholder="Type a message..."
					className="flex-1 bg-gray-800 rounded-xl px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
				/>
				<button
					type="submit"
					className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-xl transition-colors"
				>
					Send
				</button>
			</form>
		</div>
	);
}
