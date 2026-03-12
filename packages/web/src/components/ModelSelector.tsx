import { useCallback, useEffect, useState } from "react";
import { API_BASE, apiFetch } from "../lib/api";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectLabel,
	SelectSeparator,
	SelectTrigger,
	SelectValue,
} from "./ui/select";

interface ModelEntry {
	id: string;
	name: string;
	status: "available" | "cooldown" | "failed";
}

interface ProviderModels {
	provider: string;
	type: string;
	models: ModelEntry[];
	error?: string;
}

interface ModelSelectorProps {
	sessionKey: string | null;
	disabled?: boolean;
	className?: string;
}

export function ModelSelector({ sessionKey, disabled, className }: ModelSelectorProps) {
	const [providers, setProviders] = useState<ProviderModels[]>([]);
	const [selectedModel, setSelectedModel] = useState<string>("");
	const [loading, setLoading] = useState(false);

	// Fetch available models
	useEffect(() => {
		setLoading(true);
		apiFetch(`${API_BASE}/api/models/available`)
			.then((r) => r.json())
			.then((data: { providers: ProviderModels[] }) => {
				setProviders(data.providers ?? []);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	// Load session's current model override when session changes
	useEffect(() => {
		if (!sessionKey) {
			setSelectedModel("");
			return;
		}
		apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionKey)}`)
			.then((r) => r.json())
			.then((data: { modelOverride?: string | null }) => {
				setSelectedModel(data.modelOverride ?? "");
			})
			.catch(() => {});
	}, [sessionKey]);

	const handleChange = useCallback(
		(value: string) => {
			const modelId = value === "__default__" ? null : value;
			setSelectedModel(modelId ?? "");

			if (!sessionKey) return;
			apiFetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionKey)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ modelOverride: modelId }),
			}).catch(() => {});
		},
		[sessionKey],
	);

	const allModels = providers.flatMap((p) => p.models);
	if (allModels.length === 0 && !loading) return null;

	const displayValue = selectedModel
		? (allModels.find((m) => m.id === selectedModel)?.name ?? selectedModel)
		: undefined;

	return (
		<Select
			value={selectedModel || "__default__"}
			onValueChange={handleChange}
			disabled={disabled || loading}
		>
			<SelectTrigger size="sm" className={className}>
				<SelectValue placeholder={loading ? "Loading..." : "Default model"}>
					{displayValue ?? "Default model"}
				</SelectValue>
			</SelectTrigger>
			<SelectContent position="popper" align="start">
				<SelectItem value="__default__">Default model</SelectItem>
				{providers.map((p, i) => (
					<SelectGroup key={p.provider}>
						{i > 0 && <SelectSeparator />}
						<SelectLabel>{p.provider}</SelectLabel>
						{p.error ? (
							<SelectItem value={`__error_${p.provider}__`} disabled>
								{p.error}
							</SelectItem>
						) : (
							p.models.map((m) => (
								<SelectItem key={m.id} value={m.id} disabled={m.status === "failed"}>
									<span className="flex items-center gap-2">
										{m.name}
										{m.status === "cooldown" && (
											<span className="text-xs text-yellow-500">cooldown</span>
										)}
										{m.status === "failed" && (
											<span className="text-xs text-red-500">unavailable</span>
										)}
									</span>
								</SelectItem>
							))
						)}
					</SelectGroup>
				))}
			</SelectContent>
		</Select>
	);
}
