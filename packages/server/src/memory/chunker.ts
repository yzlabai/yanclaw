/**
 * Document chunking utilities for batch memory import.
 * Splits documents into appropriately sized chunks for memory storage.
 */

const MAX_CHUNK_SIZE = 4000;

export interface Chunk {
	title?: string;
	content: string;
}

/**
 * Chunk a markdown document by ## headings.
 * If no headings found, falls through to plain text chunking.
 */
export function chunkMarkdown(text: string): Chunk[] {
	const headingRegex = /^## (.+)$/gm;
	const matches: { index: number; title: string }[] = [];

	let match = headingRegex.exec(text);
	while (match !== null) {
		matches.push({ index: match.index, title: match[1].trim() });
		match = headingRegex.exec(text);
	}

	if (matches.length === 0) {
		return chunkPlainText(text);
	}

	const chunks: Chunk[] = [];

	// Content before the first heading (preamble)
	if (matches[0].index > 0) {
		const preamble = text.slice(0, matches[0].index).trim();
		if (preamble) {
			chunks.push({ content: preamble });
		}
	}

	for (let i = 0; i < matches.length; i++) {
		const start = matches[i].index;
		const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
		const sectionText = text.slice(start, end).trim();
		if (sectionText) {
			chunks.push({ title: matches[i].title, content: sectionText });
		}
	}

	return chunks.filter((c) => c.content.length > 0);
}

/**
 * Chunk plain text by double newlines, merging small paragraphs
 * to stay under MAX_CHUNK_SIZE chars each.
 */
export function chunkPlainText(text: string): Chunk[] {
	const paragraphs = text
		.split(/\n\n+/)
		.map((p) => p.trim())
		.filter(Boolean);

	if (paragraphs.length === 0) return [];

	const chunks: Chunk[] = [];
	let current = "";

	for (const para of paragraphs) {
		if (current && current.length + para.length + 2 > MAX_CHUNK_SIZE) {
			chunks.push({ content: current });
			current = para;
		} else {
			current = current ? `${current}\n\n${para}` : para;
		}
	}

	if (current) {
		chunks.push({ content: current });
	}

	return chunks;
}

/**
 * Chunk a JSON document.
 * - Array: each element becomes a chunk
 * - Object with content/text/body field: extract that field
 * - Otherwise: stringify the whole object
 */
export function chunkJson(text: string): Chunk[] {
	const parsed = JSON.parse(text);

	if (Array.isArray(parsed)) {
		return parsed
			.map((item) => {
				if (typeof item === "string") {
					return { content: item };
				}
				const contentField = item.content ?? item.text ?? item.body;
				if (typeof contentField === "string") {
					return {
						title: item.title ?? item.name ?? undefined,
						content: contentField,
					};
				}
				return { content: JSON.stringify(item, null, 2) };
			})
			.filter((c) => c.content.length > 0);
	}

	if (typeof parsed === "object" && parsed !== null) {
		const contentField = parsed.content ?? parsed.text ?? parsed.body;
		if (typeof contentField === "string") {
			return [{ title: parsed.title ?? parsed.name ?? undefined, content: contentField }];
		}
		return [{ content: JSON.stringify(parsed, null, 2) }];
	}

	return [{ content: String(parsed) }];
}

/**
 * Parse CSV text into chunks. First row is headers.
 * Each subsequent row becomes a memory entry with header-keyed content.
 */
export function chunkCsv(text: string): Chunk[] {
	const lines = text
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean);

	if (lines.length < 2) return [];

	const headers = parseCsvRow(lines[0]);
	const chunks: Chunk[] = [];

	for (let i = 1; i < lines.length; i++) {
		const values = parseCsvRow(lines[i]);
		const pairs: string[] = [];
		for (let j = 0; j < headers.length; j++) {
			const val = values[j] ?? "";
			if (val) {
				pairs.push(`${headers[j]}: ${val}`);
			}
		}
		if (pairs.length > 0) {
			chunks.push({ content: pairs.join("\n") });
		}
	}

	return chunks;
}

/**
 * Parse a single CSV row, handling quoted fields.
 */
function parseCsvRow(line: string): string[] {
	const fields: string[] = [];
	let current = "";
	let inQuotes = false;

	for (let i = 0; i < line.length; i++) {
		const ch = line[i];

		if (inQuotes) {
			if (ch === '"') {
				if (i + 1 < line.length && line[i + 1] === '"') {
					current += '"';
					i++; // skip escaped quote
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === ",") {
			fields.push(current.trim());
			current = "";
		} else {
			current += ch;
		}
	}

	fields.push(current.trim());
	return fields;
}
