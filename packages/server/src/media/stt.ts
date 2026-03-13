import type { ModelManager } from "../agents/model-manager";
import type { Config } from "../config/schema";

/** Speech-to-text service using OpenAI-compatible /audio/transcriptions endpoint. */
export class SttService {
	constructor(private modelManager: ModelManager) {}

	/**
	 * Transcribe audio from a URL to text.
	 * Requires systemModels.stt to be configured.
	 */
	async transcribe(audioUrl: string, config: Config): Promise<string> {
		// Download audio
		const audioResp = await fetch(audioUrl);
		if (!audioResp.ok) {
			throw new Error(`Failed to download audio: ${audioResp.status}`);
		}
		const audioBlob = await audioResp.blob();

		return this.transcribeBlob(audioBlob, "audio.ogg", config);
	}

	/**
	 * Transcribe audio from a buffer/blob directly.
	 * Avoids HTTP round-trip when the file is already in memory.
	 */
	async transcribeBlob(data: Blob | Uint8Array, filename: string, config: Config): Promise<string> {
		const modelId = this.resolveModelId(config);
		if (!modelId) {
			throw new Error("systemModels.stt not configured");
		}

		const { providerConfig, profile } = this.modelManager.findProviderForModel(modelId, config);
		const baseUrl = profile.baseUrl ?? providerConfig.baseUrl ?? "https://api.openai.com/v1";

		const blob = data instanceof Blob ? data : new Blob([data]);

		// Build form data for OpenAI-compatible transcription API
		const form = new FormData();
		form.append("file", blob, filename);
		form.append("model", modelId);

		const resp = await fetch(`${baseUrl}/audio/transcriptions`, {
			method: "POST",
			headers: { Authorization: `Bearer ${profile.apiKey}` },
			body: form,
		});

		if (!resp.ok) {
			const errText = await resp.text().catch(() => "unknown error");
			throw new Error(`STT API error ${resp.status}: ${errText}`);
		}

		const result = (await resp.json()) as { text: string };
		return result.text;
	}

	/** Check if STT is configured and available. */
	isAvailable(config: Config): boolean {
		return !!this.resolveModelId(config);
	}

	private resolveModelId(config: Config): string | null {
		const sttConfig = config.systemModels?.stt;
		if (!sttConfig) return null;
		return typeof sttConfig === "string" ? sttConfig : sttConfig.default;
	}
}
