import { embed, embedMany } from "ai";
import { ModelManager } from "../agents/model-manager";
import type { Config } from "../config/schema";

// Shared ModelManager instance for embedding resolution
let sharedModelManager: ModelManager | null = null;

/** Set the shared ModelManager instance (called from gateway init). */
export function setEmbeddingModelManager(mm: ModelManager): void {
	sharedModelManager = mm;
}

function getModelManager(): ModelManager {
	if (!sharedModelManager) {
		// Fallback: create a standalone instance (for backward compat)
		sharedModelManager = new ModelManager();
	}
	return sharedModelManager;
}

/** Generate embedding for a single text. */
export async function generateEmbedding(text: string, config: Config): Promise<Float32Array> {
	const mm = getModelManager();
	const model = mm.resolveEmbedding(config, config.memory.embeddingModel);
	const { embedding } = await embed({ model, value: text });
	return new Float32Array(embedding);
}

/** Generate embeddings for multiple texts in batch. */
export async function generateEmbeddings(texts: string[], config: Config): Promise<Float32Array[]> {
	if (texts.length === 0) return [];
	const mm = getModelManager();
	const model = mm.resolveEmbedding(config, config.memory.embeddingModel);
	const { embeddings } = await embedMany({ model, values: texts });
	return embeddings.map((e) => new Float32Array(e));
}
