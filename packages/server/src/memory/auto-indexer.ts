import type { FSWatcher } from "node:fs";
import { watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type { Config } from "../config/schema";
import type { MemoryStore } from "../db/memories";
import { log } from "../logger";
import { generateEmbedding } from "./embeddings";

const TEXT_EXTENSIONS = new Set([
	".txt",
	".md",
	".markdown",
	".json",
	".csv",
	".log",
	".yaml",
	".yml",
	".toml",
	".xml",
	".html",
	".htm",
]);

const MAX_FILE_SIZE = 100 * 1024; // 100KB max for auto-indexing
const MAX_INDEXED_CACHE = 10_000; // Max entries in indexed set

/** Watches directories for file changes and auto-indexes into memory store. */
export class MemoryAutoIndexer {
	private watchers: FSWatcher[] = [];
	private indexed = new Set<string>();
	private memoryStore: MemoryStore;
	private config: Config;
	private agentId: string;

	constructor(memoryStore: MemoryStore, config: Config, agentId = "main") {
		this.memoryStore = memoryStore;
		this.config = config;
		this.agentId = agentId;
	}

	/** Start watching configured directories. */
	async start(): Promise<void> {
		const dirs = this.resolveDirs();
		if (dirs.length === 0) return;

		for (const dir of dirs) {
			try {
				await stat(dir);
				const watcher = watch(dir, { recursive: true }, (event, filename) => {
					if (!filename) return;
					const dotIdx = filename.lastIndexOf(".");
					if (dotIdx < 0) return;
					const ext = filename.substring(dotIdx).toLowerCase();
					if (!TEXT_EXTENSIONS.has(ext)) return;

					const filePath = join(dir, filename);
					if (event === "rename" || event === "change") {
						this.indexFile(filePath).catch((err) => {
							log.agent().warn({ err, filename }, "failed to index file");
						});
					}
				});
				this.watchers.push(watcher);
				log.agent().info({ dir }, "memory indexer watching directory");

				// Initial scan
				await this.scanDirectory(dir);
			} catch {
				log.agent().warn({ dir }, "memory indexer directory not found");
			}
		}
	}

	/** Stop all watchers. */
	stop(): void {
		for (const w of this.watchers) {
			w.close();
		}
		this.watchers = [];
		log.agent().info("memory indexer stopped");
	}

	private resolveDirs(): string[] {
		const dirs = [...this.config.memory.indexDirs];
		return dirs;
	}

	private async scanDirectory(dir: string): Promise<void> {
		const { readdir } = await import("node:fs/promises");
		try {
			const entries = await readdir(dir, { withFileTypes: true, recursive: true });
			for (const entry of entries) {
				if (!entry.isFile()) continue;
				const dotIdx = entry.name.lastIndexOf(".");
				if (dotIdx < 0) continue;
				const ext = entry.name.substring(dotIdx).toLowerCase();
				if (!TEXT_EXTENSIONS.has(ext)) continue;
				const filePath = join(entry.parentPath ?? dir, entry.name);
				await this.indexFile(filePath);
			}
		} catch (err) {
			log.agent().warn({ err, dir }, "memory indexer scan failed");
		}
	}

	private async indexFile(filePath: string): Promise<void> {
		if (this.indexed.has(filePath)) return;
		if (this.indexed.size >= MAX_INDEXED_CACHE) {
			// Evict oldest entries by clearing half the set
			const entries = [...this.indexed];
			this.indexed = new Set(entries.slice(entries.length / 2));
		}

		try {
			const info = await stat(filePath);
			if (!info.isFile() || info.size > MAX_FILE_SIZE || info.size === 0) return;

			const content = await readFile(filePath, "utf-8");
			const filename = basename(filePath);

			// Check if already stored (by content match)
			const existing = await this.memoryStore.searchFts(this.agentId, filename, 1);
			if (existing.length > 0 && existing[0].content.includes(content.slice(0, 100))) {
				this.indexed.add(filePath);
				return;
			}

			// Generate embedding if possible
			let embedding: Float32Array | undefined;
			try {
				embedding = await generateEmbedding(content.slice(0, 8000), this.config);
			} catch {
				// Store without embedding
			}

			this.memoryStore.store({
				agentId: this.agentId,
				content: `[File: ${filename}]\n${content}`,
				tags: ["auto-indexed", "file"],
				source: "auto",
				embedding,
			});

			this.indexed.add(filePath);
			log.agent().info({ filename }, "memory indexer indexed file");
		} catch {
			// File may have been deleted between detection and read
		}
	}
}
