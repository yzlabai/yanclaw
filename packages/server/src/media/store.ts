import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { resolveDataDir } from "../config/store";
import { mediaFiles } from "../db/schema";
import { getDb } from "../db/sqlite";

export interface MediaFile {
	id: string;
	sessionKey: string | null;
	filename: string;
	mimeType: string;
	size: number;
	path: string;
	source: string | null;
	createdAt: number;
	expiresAt: number | null;
}

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
const PROCESS_TIMEOUT = 30_000; // 30s timeout for image/PDF processing

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
		),
	]);
}

/** Manages media file storage on disk + metadata in DB. */
export class MediaStore {
	private mediaDir: string;

	constructor(mediaDir?: string) {
		this.mediaDir = mediaDir ?? join(resolveDataDir(), "media");
	}

	/** Ensure the media directory exists. */
	async init(): Promise<void> {
		await mkdir(this.mediaDir, { recursive: true });
	}

	/** Store a file from a Buffer/Uint8Array. Returns the media ID. */
	async store(params: {
		filename: string;
		mimeType: string;
		data: Uint8Array;
		sessionKey?: string;
		source?: string;
		expiresIn?: number; // ms from now
	}): Promise<MediaFile> {
		if (params.data.byteLength > MAX_UPLOAD_SIZE) {
			throw new Error(`File too large: ${params.data.byteLength} bytes (max ${MAX_UPLOAD_SIZE})`);
		}

		await this.init();

		const id = nanoid();
		const ext = extFromMime(params.mimeType) || extFromFilename(params.filename);
		const storedName = `${id}${ext}`;
		const filePath = join(this.mediaDir, storedName);

		await Bun.write(filePath, params.data);

		const now = Date.now();
		const record = {
			id,
			sessionKey: params.sessionKey ?? null,
			filename: params.filename,
			mimeType: params.mimeType,
			size: params.data.byteLength,
			path: filePath,
			source: params.source ?? null,
			createdAt: now,
			expiresAt: params.expiresIn ? now + params.expiresIn : null,
		};

		const db = getDb();
		await db.insert(mediaFiles).values(record);

		return record;
	}

	/** Store a file from a URL (downloads it first). */
	async storeFromUrl(params: {
		url: string;
		filename?: string;
		mimeType?: string;
		sessionKey?: string;
		source?: string;
	}): Promise<MediaFile> {
		const res = await fetch(params.url);
		if (!res.ok) {
			throw new Error(`Failed to fetch ${params.url}: ${res.status}`);
		}

		const data = new Uint8Array(await res.arrayBuffer());
		const contentType = res.headers.get("content-type") ?? "application/octet-stream";
		const mimeType = params.mimeType ?? contentType.split(";")[0].trim();

		// Extract filename from URL or Content-Disposition
		let filename = params.filename ?? "";
		if (!filename) {
			const disposition = res.headers.get("content-disposition");
			if (disposition) {
				const match = disposition.match(/filename="?([^";\n]+)"?/);
				if (match) filename = match[1];
			}
		}
		if (!filename) {
			const urlPath = new URL(params.url).pathname;
			filename = urlPath.split("/").pop() || `download${extFromMime(mimeType)}`;
		}

		return this.store({
			filename,
			mimeType,
			data,
			sessionKey: params.sessionKey,
			source: params.source ?? params.url,
		});
	}

	/** Get a media file by ID. */
	async get(id: string): Promise<MediaFile | null> {
		const db = getDb();
		const rows = await db.select().from(mediaFiles).where(eq(mediaFiles.id, id)).limit(1);

		return rows[0] ?? null;
	}

	/** Read file contents. */
	async readFile(
		id: string,
	): Promise<{ data: Uint8Array; mimeType: string; filename: string } | null> {
		const record = await this.get(id);
		if (!record) return null;

		try {
			const file = Bun.file(record.path);
			const data = new Uint8Array(await file.arrayBuffer());
			return { data, mimeType: record.mimeType, filename: record.filename };
		} catch {
			return null;
		}
	}

	/** Delete a media file (DB + disk). */
	async delete(id: string): Promise<boolean> {
		const record = await this.get(id);
		if (!record) return false;

		const db = getDb();
		await db.delete(mediaFiles).where(eq(mediaFiles.id, id));

		try {
			await rm(record.path, { force: true });
		} catch {
			// File may already be gone
		}

		return true;
	}

	/** Clean up expired files. Returns count of deleted files. */
	async cleanup(): Promise<number> {
		const db = getDb();
		const now = Date.now();

		const expired = await db
			.select()
			.from(mediaFiles)
			.where(and(isNotNull(mediaFiles.expiresAt), lt(mediaFiles.expiresAt, now)));

		for (const record of expired) {
			try {
				await rm(record.path, { force: true });
			} catch {
				// ignore
			}
		}

		if (expired.length > 0) {
			await db
				.delete(mediaFiles)
				.where(and(isNotNull(mediaFiles.expiresAt), lt(mediaFiles.expiresAt, now)));
		}

		return expired.length;
	}

	/** Generate a thumbnail for an image. */
	async thumbnail(
		id: string,
		opts?: { width?: number; height?: number; format?: "webp" | "jpeg" | "png" },
	): Promise<{ data: Uint8Array; mimeType: string } | null> {
		const file = await this.readFile(id);
		if (!file || !file.mimeType.startsWith("image/")) return null;

		try {
			const sharp = (await import("sharp")).default;
			const width = opts?.width ?? 200;
			const height = opts?.height ?? 200;
			const format = opts?.format ?? "webp";

			const processed = await withTimeout(
				sharp(file.data)
					.resize(width, height, { fit: "inside", withoutEnlargement: true })
					.toFormat(format)
					.toBuffer(),
				PROCESS_TIMEOUT,
				"Thumbnail generation",
			);

			return { data: new Uint8Array(processed), mimeType: `image/${format}` };
		} catch (err) {
			console.warn(`[media] Thumbnail generation failed for ${id}:`, err);
			return null;
		}
	}

	/** Process/optimize an image (resize, convert format). */
	async processImage(
		id: string,
		opts: {
			maxWidth?: number;
			maxHeight?: number;
			format?: "webp" | "jpeg" | "png";
			quality?: number;
		},
	): Promise<MediaFile | null> {
		const file = await this.readFile(id);
		if (!file || !file.mimeType.startsWith("image/")) return null;

		try {
			const sharp = (await import("sharp")).default;
			const format = opts.format ?? "webp";

			let pipeline = sharp(file.data);
			if (opts.maxWidth || opts.maxHeight) {
				pipeline = pipeline.resize(opts.maxWidth, opts.maxHeight, {
					fit: "inside",
					withoutEnlargement: true,
				});
			}

			const processed = await withTimeout(
				pipeline.toFormat(format, { quality: opts.quality ?? 80 }).toBuffer(),
				PROCESS_TIMEOUT,
				"Image processing",
			);
			const ext = `.${format}`;
			const baseName = file.filename.replace(/\.[^.]+$/, "");

			return this.store({
				filename: `${baseName}_processed${ext}`,
				mimeType: `image/${format}`,
				data: new Uint8Array(processed),
			});
		} catch (err) {
			console.warn(`[media] Image processing failed for ${id}:`, err);
			return null;
		}
	}

	/** Extract text from a PDF file. */
	async extractPdfText(id: string): Promise<string | null> {
		const file = await this.readFile(id);
		if (!file || file.mimeType !== "application/pdf") return null;

		try {
			const pdfParse = (await import("pdf-parse")).default;
			const result = await withTimeout(
				pdfParse(Buffer.from(file.data)),
				PROCESS_TIMEOUT,
				"PDF text extraction",
			);
			return result.text;
		} catch (err) {
			console.warn(`[media] PDF text extraction failed for ${id}:`, err);
			return null;
		}
	}
}

function extFromMime(mimeType: string): string {
	const map: Record<string, string> = {
		"image/jpeg": ".jpg",
		"image/png": ".png",
		"image/gif": ".gif",
		"image/webp": ".webp",
		"image/svg+xml": ".svg",
		"audio/mpeg": ".mp3",
		"audio/ogg": ".ogg",
		"audio/wav": ".wav",
		"video/mp4": ".mp4",
		"video/webm": ".webm",
		"application/pdf": ".pdf",
		"text/plain": ".txt",
		"application/json": ".json",
	};
	return map[mimeType] ?? "";
}

function extFromFilename(filename: string): string {
	const idx = filename.lastIndexOf(".");
	return idx > 0 ? filename.slice(idx) : "";
}
