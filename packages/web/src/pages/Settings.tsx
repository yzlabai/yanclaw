import { useEffect, useState } from "react";
import { API_BASE, apiFetch } from "../lib/api";

export function Settings() {
	const [anthropicKey, setAnthropicKey] = useState("");
	const [openaiKey, setOpenaiKey] = useState("");
	const [googleKey, setGoogleKey] = useState("");
	const [port, setPort] = useState(18789);
	const [model, setModel] = useState("claude-sonnet-4-20250514");
	const [systemPrompt, setSystemPrompt] = useState("");
	const [saving, setSaving] = useState(false);
	const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");

	useEffect(() => {
		apiFetch(`${API_BASE}/api/config`)
			.then((r) => r.json())
			.then((config: Record<string, unknown>) => {
				const gw = config.gateway as { port?: number } | undefined;
				if (gw?.port) setPort(gw.port);

				const agents = config.agents as { model?: string; systemPrompt?: string }[] | undefined;
				if (agents?.[0]) {
					if (agents[0].model) setModel(agents[0].model);
					if (agents[0].systemPrompt) setSystemPrompt(agents[0].systemPrompt);
				}
			})
			.catch(() => {});
	}, []);

	const handleSave = async () => {
		setSaving(true);
		setStatus("idle");

		try {
			const patch: Record<string, unknown> = {};

			// Models config
			const models: Record<string, unknown> = {};
			if (anthropicKey) {
				models.anthropic = {
					profiles: [{ id: "default", apiKey: anthropicKey }],
				};
			}
			if (openaiKey) {
				models.openai = {
					profiles: [{ id: "default", apiKey: openaiKey }],
				};
			}
			if (googleKey) {
				models.google = {
					profiles: [{ id: "default", apiKey: googleKey }],
				};
			}
			if (Object.keys(models).length > 0) {
				patch.models = models;
			}

			// Gateway config
			if (port !== 18789) {
				patch.gateway = { port };
			}

			// Agent config
			patch.agents = [
				{
					id: "main",
					name: "默认助手",
					model,
					systemPrompt: systemPrompt || "You are a helpful assistant.",
				},
			];

			const res = await apiFetch(`${API_BASE}/api/config`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(patch),
			});

			if (res.ok) {
				setStatus("saved");
				setTimeout(() => setStatus("idle"), 2000);
			} else {
				setStatus("error");
			}
		} catch {
			setStatus("error");
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className="p-6">
			<h2 className="text-lg font-semibold mb-6">Settings</h2>
			<div className="space-y-6 max-w-xl">
				<section>
					<h3 className="text-sm font-medium text-gray-300 mb-3">Model API Keys</h3>
					<div className="space-y-4">
						<div>
							<label className="block text-sm text-gray-400 mb-1">Anthropic API Key</label>
							<input
								type="password"
								value={anthropicKey}
								onChange={(e) => setAnthropicKey(e.target.value)}
								placeholder="sk-ant-..."
								className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
						<div>
							<label className="block text-sm text-gray-400 mb-1">OpenAI API Key</label>
							<input
								type="password"
								value={openaiKey}
								onChange={(e) => setOpenaiKey(e.target.value)}
								placeholder="sk-..."
								className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
						<div>
							<label className="block text-sm text-gray-400 mb-1">Google AI API Key</label>
							<input
								type="password"
								value={googleKey}
								onChange={(e) => setGoogleKey(e.target.value)}
								placeholder="AIza..."
								className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500"
							/>
						</div>
					</div>
				</section>

				<section>
					<h3 className="text-sm font-medium text-gray-300 mb-3">Default Agent</h3>
					<div className="space-y-4">
						<div>
							<label className="block text-sm text-gray-400 mb-1">Model</label>
							<select
								value={model}
								onChange={(e) => setModel(e.target.value)}
								className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
							>
								<optgroup label="Anthropic">
									<option value="claude-sonnet-4-20250514">Claude Sonnet 4</option>
									<option value="claude-opus-4-20250514">Claude Opus 4</option>
									<option value="claude-haiku-4-5-20251001">Claude Haiku 4.5</option>
								</optgroup>
								<optgroup label="OpenAI">
									<option value="gpt-4o">GPT-4o</option>
									<option value="gpt-4o-mini">GPT-4o Mini</option>
									<option value="o3-mini">o3-mini</option>
								</optgroup>
								<optgroup label="Google">
									<option value="gemini-2.5-pro-preview-05-06">Gemini 2.5 Pro</option>
									<option value="gemini-2.5-flash-preview-04-17">Gemini 2.5 Flash</option>
									<option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
								</optgroup>
							</select>
						</div>
						<div>
							<label className="block text-sm text-gray-400 mb-1">System Prompt</label>
							<textarea
								value={systemPrompt}
								onChange={(e) => setSystemPrompt(e.target.value)}
								placeholder="You are a helpful assistant."
								rows={4}
								className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white placeholder-gray-500 outline-none focus:ring-2 focus:ring-blue-500 resize-y"
							/>
						</div>
					</div>
				</section>

				<section>
					<h3 className="text-sm font-medium text-gray-300 mb-3">Gateway</h3>
					<div>
						<label className="block text-sm text-gray-400 mb-1">Port</label>
						<input
							type="number"
							value={port}
							onChange={(e) => setPort(Number(e.target.value))}
							className="w-full bg-gray-800 rounded-lg px-4 py-2 text-white outline-none focus:ring-2 focus:ring-blue-500"
						/>
					</div>
				</section>

				<button
					type="button"
					onClick={handleSave}
					disabled={saving}
					className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-6 py-2 rounded-lg transition-colors"
				>
					{saving ? "Saving..." : "Save Settings"}
				</button>

				{status === "saved" && (
					<p className="text-green-400 text-sm">Settings saved successfully.</p>
				)}
				{status === "error" && <p className="text-red-400 text-sm">Failed to save settings.</p>}
			</div>
		</div>
	);
}
