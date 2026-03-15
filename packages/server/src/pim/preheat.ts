import type { PimStore } from "./store";
import type { PimItem, PimLink } from "./types";

/**
 * Preheat PIM context: extract keywords from the user message,
 * find matching entities, and format as a system prompt section.
 */
export async function preheatPim(message: string, store: PimStore): Promise<string> {
	const keywords = extractKeywords(message);
	if (keywords.length === 0) return "";

	const sections: string[] = [];

	// Match people
	const people = await store.matchByKeywords(keywords, "person", 5);
	for (const p of people) {
		const links = await store.getLinks(p.id);
		sections.push(formatPersonContext(p, links));
	}

	// Match organizations
	const orgs = await store.matchByKeywords(keywords, "org", 3);
	for (const o of orgs) {
		const links = await store.getLinks(o.id);
		sections.push(formatOrgContext(o, links));
	}

	// Match things (products, projects)
	const things = await store.matchByKeywords(keywords, "thing", 3);
	for (const t of things) {
		sections.push(formatThingContext(t));
	}

	// Check for time references → pull upcoming events and pending tasks
	if (hasTimeReference(message)) {
		const events = await store.query({
			category: "event",
			limit: 5,
		});
		const upcoming = events.filter(
			(e) => e.datetime && e.subtype !== "task" && new Date(e.datetime) >= new Date(),
		);
		const pendingTasks = await store.query({
			category: "event",
			subtype: "task",
			status: "pending",
			limit: 5,
		});

		if (upcoming.length > 0) {
			sections.push(
				`### 近期日程\n${upcoming.map((e) => `- ${e.datetime}: ${e.title}`).join("\n")}`,
			);
		}
		if (pendingTasks.length > 0) {
			sections.push(
				`### 待办事项\n${pendingTasks.map((t) => `- ${t.title}${t.datetime ? ` (截止: ${t.datetime})` : ""}`).join("\n")}`,
			);
		}
	}

	if (sections.length === 0) return "";
	return `## 个人信息系统 — 相关上下文\n\n${sections.join("\n\n")}`;
}

/** Extract meaningful keywords from a message (Chinese + English). */
function extractKeywords(message: string): string[] {
	// Remove common stop words and short tokens
	const cleaned = message
		.replace(/[，。！？、；：""''（）[\]{}<>,.!?;:'"()=+*/\\@#$%^&_~`-]/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	const tokens = cleaned.split(" ").filter((t) => t.length >= 2);

	// Remove common Chinese stop words
	const stopWords = new Set([
		"的",
		"了",
		"在",
		"是",
		"我",
		"有",
		"和",
		"就",
		"不",
		"人",
		"都",
		"一",
		"一个",
		"上",
		"也",
		"很",
		"到",
		"说",
		"要",
		"去",
		"你",
		"会",
		"着",
		"没有",
		"看",
		"好",
		"自己",
		"这",
		"他",
		"她",
		"它",
		"们",
		"那",
		"些",
		"什么",
		"怎么",
		"这个",
		"那个",
		"可以",
		"吗",
		"吧",
		"呢",
		"啊",
		"嗯",
		"哦",
		// English stop words
		"the",
		"is",
		"at",
		"which",
		"on",
		"and",
		"or",
		"but",
		"in",
		"with",
		"for",
		"to",
		"of",
		"it",
		"this",
		"that",
		"are",
		"was",
		"be",
		"have",
		"has",
		"do",
		"did",
		"not",
		"from",
	]);

	return tokens.filter((t) => !stopWords.has(t)).slice(0, 8);
}

/** Check if the message contains time-related references. */
function hasTimeReference(message: string): boolean {
	return /今天|明天|后天|昨天|下周|上周|这周|本周|这个月|下个月|日程|安排|待办|deadline|schedule|tomorrow|next week|today/i.test(
		message,
	);
}

function formatPersonContext(person: PimItem, links: Array<PimLink & { item: PimItem }>): string {
	const props = person.properties as Record<string, unknown>;
	const lines = [`### ${person.title}`];

	const meta: string[] = [];
	if (props.org || props.orgRef) meta.push(String(props.org ?? props.orgRef));
	if (props.role) meta.push(String(props.role));
	if (props.relation) meta.push(String(props.relation));
	if (meta.length > 0) lines.push(meta.join(" · "));

	// Recent interactions
	const interactions = links.filter((l) => l.item.category === "event").slice(0, 3);
	if (interactions.length > 0) {
		for (const i of interactions) {
			lines.push(`- ${i.item.datetime ?? "?"}: ${i.item.title} (${i.type})`);
		}
	}

	// Pending tasks related to this person
	const tasks = links.filter(
		(l) => l.item.category === "event" && l.item.subtype === "task" && l.item.status === "pending",
	);
	if (tasks.length > 0) {
		for (const t of tasks) {
			lines.push(`- 待办: ${t.item.title}${t.item.datetime ? ` (截止: ${t.item.datetime})` : ""}`);
		}
	}

	return lines.join("\n");
}

function formatOrgContext(org: PimItem, links: Array<PimLink & { item: PimItem }>): string {
	const props = org.properties as Record<string, unknown>;
	const lines = [`### ${org.title}${org.subtype ? ` (${org.subtype})` : ""}`];

	if (props.industry) lines.push(`行业: ${props.industry}`);
	if (props.relation) lines.push(`关系: ${props.relation}`);

	// Members
	const members = links.filter((l) => l.item.category === "person").slice(0, 5);
	if (members.length > 0) {
		lines.push(`成员: ${members.map((m) => m.item.title).join(", ")}`);
	}

	return lines.join("\n");
}

function formatThingContext(thing: PimItem): string {
	const props = thing.properties as Record<string, unknown>;
	const parts = [`### ${thing.title}${thing.subtype ? ` (${thing.subtype})` : ""}`];
	if (props.url) parts.push(`链接: ${props.url}`);
	return parts.join("\n");
}
