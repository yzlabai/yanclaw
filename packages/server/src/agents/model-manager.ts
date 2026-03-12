import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";
import type { AuthProfile, Config, Preference, ProviderConfig } from "../config/schema";

interface ProfileState {
	failCount: number;
	cooldownUntil: number;
}

interface ProviderLookup {
	providerName: string;
	providerConfig: ProviderConfig;
	resolvedModelId: string;
}

interface ResolveResult {
	model: LanguageModel;
	provider: string;
	profileId: string;
}

/** Manages model resolution with generic providers, 2D scene×preference, and round-robin. */
export class ModelManager {
	private profileStates = new Map<string, ProfileState>();
	private roundRobinIndex = new Map<string, number>();
	private readonly cooldownMs: number;
	private readonly maxFails: number;

	constructor(opts?: { cooldownMs?: number; maxFails?: number }) {
		this.cooldownMs = opts?.cooldownMs ?? 60_000;
		this.maxFails = opts?.maxFails ?? 3;
	}

	// --- Public API (new 2D) ---

	/**
	 * Resolve a model by scene and preference using systemModels config.
	 * Falls back to scene defaults, then cross-scene fallback.
	 */
	resolve(scene: string, preference: Preference | undefined, config: Config): LanguageModel {
		return this.resolveWithMeta(scene, preference, config).model;
	}

	/**
	 * Resolve a model with metadata (provider, profileId) for failure tracking.
	 */
	resolveWithMeta(
		scene: string,
		preference: Preference | undefined,
		config: Config,
	): ResolveResult {
		const modelId = this.resolveModelId(scene, preference ?? "default", config);
		return this.resolveByModelId(modelId, config);
	}

	// --- Public API (legacy compat) ---

	/**
	 * Legacy: resolve by explicit model ID string.
	 * @deprecated Use resolve(scene, preference, config) instead.
	 */
	resolveById(modelId: string, config: Config): LanguageModel {
		return this.resolveByModelId(modelId, config).model;
	}

	/**
	 * Legacy: resolve by explicit model ID with metadata.
	 * @deprecated Use resolveWithMeta(scene, preference, config) instead.
	 */
	resolveByIdWithMeta(modelId: string, config: Config): ResolveResult {
		return this.resolveByModelId(modelId, config);
	}

	/**
	 * Resolve an embedding model from systemModels or by explicit model ID.
	 */
	resolveEmbedding(config: Config, modelId?: string): EmbeddingModel<string> {
		const id = modelId ?? this.resolveModelId("embedding", "default", config);
		const lookup = this.findProvider(id, config);
		const profile = this.selectProfile(lookup.providerName, lookup.providerConfig.profiles);
		const baseUrl = profile.baseUrl ?? lookup.providerConfig.baseUrl;

		switch (lookup.providerConfig.type) {
			case "openai":
			case "openai-compatible": {
				if (baseUrl) {
					return createOpenAI({ apiKey: profile.apiKey, baseURL: baseUrl }).embedding(
						lookup.resolvedModelId,
					);
				}
				return openai.embedding(lookup.resolvedModelId);
			}
			case "google": {
				if (baseUrl) {
					return createGoogleGenerativeAI({
						apiKey: profile.apiKey,
						baseURL: baseUrl,
					}).textEmbeddingModel(lookup.resolvedModelId);
				}
				return google.textEmbeddingModel(lookup.resolvedModelId);
			}
			case "ollama": {
				const ollamaUrl = baseUrl ?? "http://localhost:11434/v1";
				return createOpenAI({ apiKey: "ollama", baseURL: ollamaUrl }).embedding(
					lookup.resolvedModelId,
				);
			}
			default:
				throw new Error(
					`Embedding not supported for provider type "${lookup.providerConfig.type}"`,
				);
		}
	}

	/** Get the health status of a specific profile. */
	getProfileStatus(providerName: string, profileId: string): "available" | "cooldown" | "failed" {
		const key = `${providerName}:${profileId}`;
		const state = this.profileStates.get(key);
		if (!state) return "available";
		if (state.cooldownUntil > Date.now()) return "cooldown";
		return "available";
	}

	/** Report a failure for a profile (triggers cooldown after maxFails). */
	reportFailure(provider: string, profileId: string): void {
		const key = `${provider}:${profileId}`;
		const state = this.profileStates.get(key) ?? { failCount: 0, cooldownUntil: 0 };
		state.failCount++;

		if (state.failCount >= this.maxFails) {
			state.cooldownUntil = Date.now() + this.cooldownMs;
			console.warn(
				`[model] Profile ${key} in cooldown for ${this.cooldownMs}ms after ${state.failCount} failures`,
			);
		}

		this.profileStates.set(key, state);
	}

	/** Report success for a profile (resets failure count). */
	reportSuccess(provider: string, profileId: string): void {
		const key = `${provider}:${profileId}`;
		this.profileStates.delete(key);
	}

	/**
	 * Find the provider config for a given model ID. Exposed for SttService.
	 */
	findProviderForModel(
		modelId: string,
		config: Config,
	): { providerConfig: ProviderConfig; profile: AuthProfile } {
		const lookup = this.findProvider(modelId, config);
		const profile = this.selectProfile(lookup.providerName, lookup.providerConfig.profiles);
		return { providerConfig: lookup.providerConfig, profile };
	}

	// --- Internal ---

	private resolveModelId(scene: string, preference: Preference, config: Config): string {
		const sceneConfig = config.systemModels?.[scene];

		if (sceneConfig) {
			if (typeof sceneConfig === "string") return sceneConfig;
			if (sceneConfig[preference]) return sceneConfig[preference] as string;
			if (sceneConfig.default) return sceneConfig.default;
		}

		// Scene fallback: vision → chat, summary → chat
		if (scene !== "chat" && scene !== "embedding" && scene !== "stt") {
			return this.resolveModelId("chat", preference, config);
		}

		throw new Error(`No model configured for scene="${scene}" preference="${preference}"`);
	}

	private resolveByModelId(modelId: string, config: Config): ResolveResult {
		const lookup = this.findProvider(modelId, config);
		const profile = this.selectProfile(lookup.providerName, lookup.providerConfig.profiles);

		return {
			model: this.createModel(lookup.providerConfig, profile, lookup.resolvedModelId),
			provider: lookup.providerName,
			profileId: profile.id,
		};
	}

	private findProvider(modelId: string, config: Config): ProviderLookup {
		const providers = config.models.providers;

		// 1. Check alias mappings in all providers
		for (const [name, prov] of Object.entries(providers)) {
			if (prov.models?.[modelId]) {
				return {
					providerName: name,
					providerConfig: prov,
					resolvedModelId: prov.models[modelId],
				};
			}
		}

		// 2. Check if modelId directly matches — prefix-based inference
		const prefixMap: Array<{ prefix: string; type: string }> = [
			{ prefix: "claude-", type: "anthropic" },
			{ prefix: "gpt-", type: "openai" },
			{ prefix: "o1", type: "openai" },
			{ prefix: "o3", type: "openai" },
			{ prefix: "o4", type: "openai" },
			{ prefix: "gemini-", type: "google" },
		];

		for (const { prefix, type } of prefixMap) {
			if (modelId.startsWith(prefix)) {
				// Find a provider with matching type
				for (const [name, prov] of Object.entries(providers)) {
					if (prov.type === type) {
						return { providerName: name, providerConfig: prov, resolvedModelId: modelId };
					}
				}
			}
		}

		// 3. If only one provider configured, use it as fallback
		const providerEntries = Object.entries(providers);
		if (providerEntries.length === 1) {
			const [name, prov] = providerEntries[0];
			return { providerName: name, providerConfig: prov, resolvedModelId: modelId };
		}

		throw new Error(
			`Cannot determine provider for model "${modelId}". Configure it in models.providers or use model aliases.`,
		);
	}

	private createModel(
		providerConfig: ProviderConfig,
		profile: AuthProfile,
		modelId: string,
	): LanguageModel {
		const baseUrl = profile.baseUrl ?? providerConfig.baseUrl;

		switch (providerConfig.type) {
			case "anthropic":
				return baseUrl
					? createAnthropic({ apiKey: profile.apiKey, baseURL: baseUrl })(modelId)
					: anthropic(modelId, { headers: { "x-api-key": profile.apiKey } });

			case "openai":
			case "openai-compatible":
				if (baseUrl) {
					return createOpenAI({ apiKey: profile.apiKey, baseURL: baseUrl })(modelId);
				}
				return openai(modelId, { headers: { Authorization: `Bearer ${profile.apiKey}` } });

			case "google":
				return baseUrl
					? createGoogleGenerativeAI({ apiKey: profile.apiKey, baseURL: baseUrl })(modelId)
					: google(modelId, { apiKey: profile.apiKey });

			case "ollama":
				return createOpenAI({
					apiKey: "ollama",
					baseURL: baseUrl ?? "http://localhost:11434/v1",
				})(modelId);
		}
	}

	private selectProfile(providerName: string, profiles: AuthProfile[]): AuthProfile {
		if (profiles.length === 0) {
			throw new Error(`No auth profiles configured for provider "${providerName}"`);
		}

		const available = profiles.filter((p) => this.isAvailable(providerName, p.id));
		if (available.length === 0) {
			console.warn(`[model] All ${providerName} profiles in cooldown, using first`);
			return profiles[0];
		}
		if (available.length === 1) return available[0];

		// Round-robin across available profiles
		const idx = (this.roundRobinIndex.get(providerName) ?? 0) % available.length;
		this.roundRobinIndex.set(providerName, idx + 1);
		return available[idx];
	}

	private isAvailable(provider: string, profileId: string): boolean {
		const key = `${provider}:${profileId}`;
		const state = this.profileStates.get(key);
		if (!state) return true;
		if (state.cooldownUntil > Date.now()) return false;
		// Cooldown expired, reset
		this.profileStates.delete(key);
		return true;
	}
}
