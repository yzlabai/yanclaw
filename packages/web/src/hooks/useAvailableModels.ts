import { useCallback, useEffect, useState } from "react";
import { API_BASE, apiFetch } from "../lib/api";

export interface ModelEntry {
	id: string;
	name: string;
	status: "available" | "cooldown" | "failed";
}

export interface ProviderModels {
	provider: string;
	type: string;
	models: ModelEntry[];
	error?: string;
}

export function useAvailableModels() {
	const [providers, setProviders] = useState<ProviderModels[]>([]);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(() => {
		setLoading(true);
		apiFetch(`${API_BASE}/api/models/available`)
			.then((r) => (r.ok ? r.json() : Promise.reject()))
			.then((data: { providers: ProviderModels[] }) => {
				if (Array.isArray(data.providers)) setProviders(data.providers);
			})
			.catch(() => {})
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return { providers, loading, refresh };
}
