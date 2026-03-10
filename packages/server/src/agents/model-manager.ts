import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, google } from "@ai-sdk/google";
import { createOpenAI, openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { Config } from "../config/schema";

interface ProfileState {
	failCount: number;
	cooldownUntil: number;
}

/** Manages model resolution with auth profile failover and cooldown. */
export class ModelManager {
	private profileStates = new Map<string, ProfileState>();
	private readonly cooldownMs: number;
	private readonly maxFails: number;

	constructor(opts?: { cooldownMs?: number; maxFails?: number }) {
		this.cooldownMs = opts?.cooldownMs ?? 60_000; // 1 minute cooldown
		this.maxFails = opts?.maxFails ?? 3;
	}

	/** Resolve a model by ID, selecting the best available auth profile. */
	resolve(modelId: string, config: Config): LanguageModel {
		return this.resolveWithMeta(modelId, config).model;
	}

	/** Resolve a model with metadata about which provider/profile was selected. */
	resolveWithMeta(
		modelId: string,
		config: Config,
	): { model: LanguageModel; provider: string; profileId: string } {
		const isOpenAI =
			modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3");
		const isGoogle = modelId.startsWith("gemini-");

		if (isOpenAI) {
			return this.resolveOpenAIWithMeta(modelId, config);
		}
		if (isGoogle) {
			return this.resolveGoogleWithMeta(modelId, config);
		}
		return this.resolveAnthropicWithMeta(modelId, config);
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

	private isAvailable(provider: string, profileId: string): boolean {
		const key = `${provider}:${profileId}`;
		const state = this.profileStates.get(key);
		if (!state) return true;
		if (state.cooldownUntil > Date.now()) return false;
		// Cooldown expired, reset
		this.profileStates.delete(key);
		return true;
	}

	private resolveAnthropicWithMeta(
		modelId: string,
		config: Config,
	): { model: LanguageModel; provider: string; profileId: string } {
		const profiles = config.models.anthropic?.profiles ?? [];
		if (profiles.length === 0) {
			throw new Error("Anthropic API key not configured");
		}

		// Find first available profile
		for (const profile of profiles) {
			if (this.isAvailable("anthropic", profile.id)) {
				return {
					model: this.createAnthropicModel(modelId, profile),
					provider: "anthropic",
					profileId: profile.id,
				};
			}
		}

		// All profiles in cooldown, use first one anyway
		console.warn("[model] All Anthropic profiles in cooldown, using first profile");
		const fallback = profiles[0];
		return {
			model: this.createAnthropicModel(modelId, fallback),
			provider: "anthropic",
			profileId: fallback.id,
		};
	}

	private resolveOpenAIWithMeta(
		modelId: string,
		config: Config,
	): { model: LanguageModel; provider: string; profileId: string } {
		const profiles = config.models.openai?.profiles ?? [];
		if (profiles.length === 0) {
			throw new Error("OpenAI API key not configured");
		}

		for (const profile of profiles) {
			if (this.isAvailable("openai", profile.id)) {
				return {
					model: this.createOpenAIModel(modelId, profile),
					provider: "openai",
					profileId: profile.id,
				};
			}
		}

		console.warn("[model] All OpenAI profiles in cooldown, using first profile");
		const fallback = profiles[0];
		return {
			model: this.createOpenAIModel(modelId, fallback),
			provider: "openai",
			profileId: fallback.id,
		};
	}

	private resolveGoogleWithMeta(
		modelId: string,
		config: Config,
	): { model: LanguageModel; provider: string; profileId: string } {
		const profiles = config.models.google?.profiles ?? [];
		if (profiles.length === 0) {
			throw new Error("Google AI API key not configured");
		}

		for (const profile of profiles) {
			if (this.isAvailable("google", profile.id)) {
				return {
					model: this.createGoogleModel(modelId, profile),
					provider: "google",
					profileId: profile.id,
				};
			}
		}

		console.warn("[model] All Google profiles in cooldown, using first profile");
		const fallback = profiles[0];
		return {
			model: this.createGoogleModel(modelId, fallback),
			provider: "google",
			profileId: fallback.id,
		};
	}

	private createGoogleModel(
		modelId: string,
		profile: { apiKey: string; baseUrl?: string },
	): LanguageModel {
		if (profile.baseUrl) {
			const client = createGoogleGenerativeAI({
				apiKey: profile.apiKey,
				baseURL: profile.baseUrl,
			});
			return client(modelId);
		}
		return google(modelId, { apiKey: profile.apiKey });
	}

	private createAnthropicModel(
		modelId: string,
		profile: { apiKey: string; baseUrl?: string },
	): LanguageModel {
		if (profile.baseUrl) {
			const client = createAnthropic({
				apiKey: profile.apiKey,
				baseURL: profile.baseUrl,
			});
			return client(modelId);
		}
		return anthropic(modelId, { headers: { "x-api-key": profile.apiKey } });
	}

	private createOpenAIModel(
		modelId: string,
		profile: { apiKey: string; baseUrl?: string },
	): LanguageModel {
		if (profile.baseUrl) {
			const client = createOpenAI({
				apiKey: profile.apiKey,
				baseURL: profile.baseUrl,
			});
			return client(modelId);
		}
		return openai(modelId, { headers: { Authorization: `Bearer ${profile.apiKey}` } });
	}
}
