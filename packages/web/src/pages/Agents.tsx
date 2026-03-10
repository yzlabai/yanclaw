import { useCallback, useEffect, useState } from "react";
import { API_BASE, apiFetch } from "../lib/api";

interface AgentData {
	id: string;
	name: string;
	model: string;
	systemPrompt: string;
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
		});
	};

	const handleEdit = (agent: AgentData) => {
		setIsNew(false);
		setEditing({ ...agent });
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
					alert(err.error || "Failed to create agent");
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
					alert(err.error || "Failed to update agent");
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
		if (!confirm(`Delete agent "${id}"?`)) return;
		const res = await apiFetch(`${API_BASE}/api/agents/${id}`, { method: "DELETE" });
		if (res.ok) fetchAgents();
		else {
			const err = await res.json();
			alert(err.error || "Failed to delete");
		}
	};

	return (
		<div className="p-6">
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-lg font-semibold">Agents</h2>
				<button
					type="button"
					onClick={handleCreate}
					className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-lg text-sm transition-colors"
				>
					+ New Agent
				</button>
			</div>

			{/* Agent list */}
			<div className="space-y-3 max-w-2xl">
				{agents.map((agent) => (
					<div
						key={agent.id}
						className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-start justify-between"
					>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<span className="font-medium text-white">{agent.name}</span>
								<span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded">
									{agent.id}
								</span>
							</div>
							<div className="text-sm text-gray-400 mt-1">{agent.model}</div>
							<div className="text-xs text-gray-500 mt-1 truncate">{agent.systemPrompt}</div>
						</div>
						<div className="flex gap-2 ml-4">
							<button
								type="button"
								onClick={() => handleEdit(agent)}
								className="text-gray-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
							>
								Edit
							</button>
							{agent.id !== "main" && (
								<button
									type="button"
									onClick={() => handleDelete(agent.id)}
									className="text-red-400 hover:text-red-300 text-sm px-2 py-1 rounded hover:bg-gray-800 transition-colors"
								>
									Delete
								</button>
							)}
						</div>
					</div>
				))}
				{agents.length === 0 && <p className="text-gray-500">No agents configured.</p>}
			</div>

			{/* Edit modal */}
			{editing && (
				<div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
					<div className="bg-gray-900 border border-gray-700 rounded-xl p-6 w-full max-w-lg">
						<h3 className="text-lg font-semibold mb-4">
							{isNew ? "Create Agent" : `Edit: ${editing.name}`}
						</h3>
						<div className="space-y-4">
							<div>
								<label className="block text-sm text-gray-400 mb-1">ID</label>
								<input
									type="text"
									value={editing.id}
									onChange={(e) => setEditing({ ...editing, id: e.target.value })}
									disabled={!isNew}
									placeholder="my-agent"
									className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
								/>
							</div>
							<div>
								<label className="block text-sm text-gray-400 mb-1">Name</label>
								<input
									type="text"
									value={editing.name}
									onChange={(e) => setEditing({ ...editing, name: e.target.value })}
									placeholder="My Assistant"
									className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
								/>
							</div>
							<div>
								<label className="block text-sm text-gray-400 mb-1">Model</label>
								<select
									value={editing.model}
									onChange={(e) => setEditing({ ...editing, model: e.target.value })}
									className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
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
							<div>
								<label className="block text-sm text-gray-400 mb-1">System Prompt</label>
								<textarea
									value={editing.systemPrompt}
									onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
									rows={4}
									className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 resize-y"
								/>
							</div>
						</div>
						<div className="flex justify-end gap-3 mt-6">
							<button
								type="button"
								onClick={() => setEditing(null)}
								className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
							>
								Cancel
							</button>
							<button
								type="button"
								onClick={handleSave}
								disabled={saving || !editing.id || !editing.name}
								className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg transition-colors"
							>
								{saving ? "Saving..." : isNew ? "Create" : "Save"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
