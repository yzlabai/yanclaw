import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

const listModelsSchema = z.object({
	providerType: z.enum(["anthropic", "openai", "google", "ollama", "openai-compatible"]),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
});

type ModelEntry = { id: string; name: string };

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs = 10_000,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function fetchAnthropic(apiKey: string): Promise<ModelEntry[]> {
	const res = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
		method: "GET",
		headers: {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
		},
	});
	if (!res.ok) throw new Error(`Anthropic API returned ${res.status}`);
	const body = (await res.json()) as { data: Array<{ id: string; display_name: string }> };
	return body.data
		.filter((m) => m.id.startsWith("claude-"))
		.map((m) => ({ id: m.id, name: m.display_name || m.id }));
}

async function fetchOpenAI(apiKey: string): Promise<ModelEntry[]> {
	const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
		method: "GET",
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!res.ok) throw new Error(`OpenAI API returned ${res.status}`);
	const body = (await res.json()) as { data: Array<{ id: string }> };
	return body.data
		.filter((m) => /^(gpt-|o1-|o3-|o4-)/.test(m.id))
		.map((m) => ({ id: m.id, name: m.id }));
}

async function fetchGoogle(apiKey: string): Promise<ModelEntry[]> {
	const res = await fetchWithTimeout(
		`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
		{ method: "GET" },
	);
	if (!res.ok) throw new Error(`Google API returned ${res.status}`);
	const body = (await res.json()) as {
		models: Array<{ name: string; displayName: string }>;
	};
	return body.models
		.filter((m) => m.name.includes("gemini-"))
		.map((m) => {
			const id = m.name.replace(/^models\//, "");
			return { id, name: m.displayName || id };
		});
}

async function fetchOllama(baseUrl?: string): Promise<ModelEntry[]> {
	const base = baseUrl?.replace(/\/v1\/?$/, "") || "http://localhost:11434";
	const res = await fetchWithTimeout(`${base}/api/tags`, { method: "GET" });
	if (!res.ok) throw new Error(`Ollama API returned ${res.status}`);
	const body = (await res.json()) as { models: Array<{ name: string }> };
	return (body.models || []).map((m) => ({ id: m.name, name: m.name }));
}

async function fetchOpenAICompatible(apiKey?: string, baseUrl?: string): Promise<ModelEntry[]> {
	if (!baseUrl) throw new Error("baseUrl is required for openai-compatible providers");
	const headers: Record<string, string> = {};
	if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
	const res = await fetchWithTimeout(`${baseUrl}/models`, { method: "GET", headers });
	if (!res.ok) throw new Error(`API returned ${res.status}`);
	const body = (await res.json()) as { data: Array<{ id: string }> };
	return (body.data || []).map((m) => ({ id: m.id, name: m.id }));
}

async function fetchByType(type: string, apiKey: string, baseUrl?: string): Promise<ModelEntry[]> {
	switch (type) {
		case "anthropic":
			return fetchAnthropic(apiKey);
		case "openai":
			return fetchOpenAI(apiKey);
		case "google":
			return fetchGoogle(apiKey);
		case "ollama":
			return fetchOllama(baseUrl);
		case "openai-compatible":
			return fetchOpenAICompatible(apiKey, baseUrl);
		default:
			return [];
	}
}

// Server-side cache for /available endpoint
let modelsCache: { data: ProviderModels[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

interface ProviderModels {
	provider: string;
	type: string;
	models: Array<ModelEntry & { status: "available" | "cooldown" | "failed" }>;
	error?: string;
}

export const modelsRoute = new Hono()
	.post("/list", zValidator("json", listModelsSchema), async (c) => {
		const { providerType, apiKey, baseUrl } = c.req.valid("json");

		try {
			const models = await fetchByType(providerType, apiKey || "", baseUrl);
			return c.json({ models });
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			return c.json({ models: [], error: `Failed to fetch models: ${message}` });
		}
	})
	.get("/available", async (c) => {
		const { getGateway } = await import("../gateway");
		const gw = getGateway();
		const config = gw.config.get();
		const modelManager = gw.modelManager;

		// Return cached result if fresh
		if (modelsCache && Date.now() - modelsCache.fetchedAt < CACHE_TTL) {
			return c.json({ providers: modelsCache.data, cached: true });
		}

		const results: ProviderModels[] = [];
		for (const [name, provider] of Object.entries(config.models.providers)) {
			const apiKey = provider.profiles[0]?.apiKey;
			if (!apiKey && provider.type !== "ollama") continue;
			try {
				const models = await fetchByType(provider.type, apiKey ?? "", provider.baseUrl);
				const profileId = provider.profiles[0]?.id ?? "default";
				const modelsWithStatus = models.map((m) => ({
					...m,
					status: modelManager.getProfileStatus(name, profileId),
				}));
				results.push({ provider: name, type: provider.type, models: modelsWithStatus });
			} catch {
				results.push({ provider: name, type: provider.type, models: [], error: "unreachable" });
			}
		}

		modelsCache = { data: results, fetchedAt: Date.now() };
		return c.json({ providers: results });
	});
