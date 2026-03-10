import { createOpenAI, openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";
import type { Config } from "../config/schema";

/** Generate embedding for a single text. */
export async function generateEmbedding(text: string, config: Config): Promise<Float32Array> {
	const model = resolveEmbeddingModel(config);
	const { embedding } = await embed({ model, value: text });
	return new Float32Array(embedding);
}

/** Generate embeddings for multiple texts in batch. */
export async function generateEmbeddings(texts: string[], config: Config): Promise<Float32Array[]> {
	if (texts.length === 0) return [];
	const model = resolveEmbeddingModel(config);
	const { embeddings } = await embedMany({ model, values: texts });
	return embeddings.map((e) => new Float32Array(e));
}

function resolveEmbeddingModel(config: Config) {
	const modelId = config.memory.embeddingModel;
	const profiles = config.models.openai?.profiles ?? [];

	if (profiles.length > 0) {
		const profile = profiles[0];
		if (profile.baseUrl) {
			const client = createOpenAI({
				apiKey: profile.apiKey,
				baseURL: profile.baseUrl,
			});
			return client.embedding(modelId);
		}
	}

	return openai.embedding(modelId);
}
