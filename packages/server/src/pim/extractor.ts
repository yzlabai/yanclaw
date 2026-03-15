import { generateText, type LanguageModel } from "ai";
import { log } from "../logger";
import type { PimStore } from "./store";
import type { PimCategory } from "./types";

/** Extracted item from LLM output. */
export interface ExtractedItem {
	category: PimCategory;
	subtype?: string;
	title: string;
	content?: string;
	properties?: Record<string, unknown>;
	datetime?: string;
	status?: string;
	confidence: number;
}

/** Extracted link from LLM output. */
export interface ExtractedLink {
	from: string; // title of source item
	to: string; // title of target item
	type: string;
}

export interface ExtractionResult {
	items: ExtractedItem[];
	links: ExtractedLink[];
}

const VALID_CATEGORIES = new Set([
	"person",
	"event",
	"thing",
	"place",
	"time",
	"info",
	"org",
	"ledger",
]);

/** Pre-filter: skip messages not worth extracting. */
export function shouldExtract(message: string): boolean {
	if (!message || message.length < 20) return false;
	// Pure emoji / sticker
	if (/^[\p{Emoji}\s]+$/u.test(message)) return false;
	// Slash commands
	if (/^\/\w+/.test(message.trim())) return false;
	return true;
}

/**
 * Build the extraction prompt with existing entity names to avoid duplicates.
 */
function buildPrompt(messages: string[], existingEntities: string[], today: string): string {
	const existing = existingEntities.length > 0 ? existingEntities.join(", ") : "(none yet)";

	return `You are a structured information extractor. Extract entities and relationships from the conversation below.

## Entity types

1. **person** — People mentioned. Properties: role, relation (to user), aliases[]
2. **event** — Things that happened or will happen. Subtypes: meeting, interaction, task, trip, purchase, reading. Properties: priority, followUp, outcome
3. **thing** — Products, projects, books, tools, concepts. Properties: brand, price, url
4. **place** — Locations. Properties: address, city
5. **time** — Meaningful time anchors like "Q2", "project phase 1". Simple dates ("tomorrow 2pm") go into an entity's datetime field instead.
6. **info** — Knowledge with provenance: articles, papers, bookmarks. Properties: sourceUrl, author
7. **org** — Companies, departments, teams. Properties: industry, location, relation (to user: 我司/客户公司/供应商)
8. **ledger** — Financial transactions. Properties: amount (number), direction (income/expense/transfer), category (餐饮/差旅/采购/...), payer, payee, method

## Known entities (do NOT recreate these — reference them by title)
${existing}

## Today's date
${today}

## Conversation
${messages.join("\n")}

## Output
Return a JSON object with "items" and "links" arrays. If nothing to extract, return empty arrays.
- Only extract what is **explicitly mentioned**. Do not guess.
- Convert relative dates to absolute (e.g. "明天" → actual date).
- confidence: 1.0 = explicit statement, 0.8 = reasonable inference, < 0.7 = uncertain.
- For links, use the item's title as "from" and "to".

Respond with ONLY valid JSON, no markdown fences.`;
}

/**
 * Run the LLM extraction pipeline on recent messages.
 */
export async function extractFromMessages(
	model: LanguageModel,
	recentMessages: string[],
	store: PimStore,
	opts?: { confidenceThreshold?: number },
): Promise<ExtractionResult> {
	const threshold = opts?.confidenceThreshold ?? 0.7;

	// Fetch existing entity titles for dedup context
	const existingItems = await store.query({ limit: 100 });
	const existingTitles = existingItems.map((i) => `[${i.category}] ${i.title}`);

	const today = new Date().toISOString().split("T")[0];
	const prompt = buildPrompt(recentMessages, existingTitles, today);

	let text: string;
	try {
		const result = await generateText({
			model,
			messages: [{ role: "user", content: prompt }],
			maxTokens: 2000,
		});
		text = result.text;
	} catch (err) {
		log.agent().warn({ err }, "PIM extraction LLM call failed");
		return { items: [], links: [] };
	}

	// Parse JSON from response
	const parsed = parseExtractionJson(text);
	if (!parsed) return { items: [], links: [] };

	// Filter by confidence and validate categories
	parsed.items = parsed.items.filter(
		(item) => item.confidence >= threshold && VALID_CATEGORIES.has(item.category),
	);

	return parsed;
}

/** Parse LLM output JSON, handling common formatting issues. */
function parseExtractionJson(text: string): ExtractionResult | null {
	try {
		// Strip markdown fences if present
		let cleaned = text.trim();
		if (cleaned.startsWith("```")) {
			cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
		}
		const parsed = JSON.parse(cleaned);

		const items: ExtractedItem[] = Array.isArray(parsed.items)
			? parsed.items.filter(
					(i: unknown) =>
						typeof i === "object" &&
						i !== null &&
						"category" in i &&
						"title" in i &&
						"confidence" in i,
				)
			: [];

		const links: ExtractedLink[] = Array.isArray(parsed.links)
			? parsed.links.filter(
					(l: unknown) =>
						typeof l === "object" && l !== null && "from" in l && "to" in l && "type" in l,
				)
			: [];

		return { items, links };
	} catch {
		log.agent().warn("PIM extraction: failed to parse LLM JSON output");
		return null;
	}
}

/**
 * Full extraction pipeline: extract → dedup → store.
 * Designed to be called asynchronously after agent reply.
 */
export async function runExtractionPipeline(
	model: LanguageModel,
	recentMessages: string[],
	store: PimStore,
	opts?: { confidenceThreshold?: number },
): Promise<void> {
	try {
		const result = await extractFromMessages(model, recentMessages, store, opts);
		if (result.items.length === 0) return;

		// Store items, collecting title→id mapping for link resolution
		const titleToId = new Map<string, string>();

		for (const item of result.items) {
			// Dedup: check existing by title + category
			if (item.category !== "ledger") {
				const existing = await store.findByTitle(item.title, item.category);
				if (existing) {
					await store.mergeProperties(existing.id, item.properties ?? {});
					if (item.status) await store.update(existing.id, { status: item.status });
					if (item.datetime) await store.update(existing.id, { datetime: item.datetime });
					titleToId.set(item.title, existing.id);
					continue;
				}

				// Also check by alias (person/org)
				if (item.category === "person" || item.category === "org") {
					const byAlias = await store.findByAlias(item.title, item.category);
					if (byAlias) {
						await store.mergeProperties(byAlias.id, item.properties ?? {});
						titleToId.set(item.title, byAlias.id);
						continue;
					}
				}
			}

			const id = await store.create({
				category: item.category,
				subtype: item.subtype,
				title: item.title,
				content: item.content,
				properties: item.properties,
				datetime: item.datetime,
				status: item.status,
				confidence: item.confidence,
			});
			titleToId.set(item.title, id);
		}

		// Resolve and create links
		for (const link of result.links) {
			const fromId = titleToId.get(link.from);
			const toId = titleToId.get(link.to);
			if (fromId && toId && fromId !== toId) {
				// Avoid duplicate links
				const existing = await store.getLinksBetween(fromId, toId);
				if (!existing.some((l) => l.type === link.type)) {
					await store.createLink({ fromId, toId, type: link.type });
				}
			}
		}

		log
			.agent()
			.debug(
				{ items: result.items.length, links: result.links.length },
				"PIM extraction completed",
			);
	} catch (err) {
		log.agent().warn({ err }, "PIM extraction pipeline error");
	}
}
