export const PIM_CATEGORIES = [
	"person",
	"event",
	"thing",
	"place",
	"time",
	"info",
	"org",
	"ledger",
] as const;

export type PimCategory = (typeof PIM_CATEGORIES)[number];

/** Subtype suggestions per category (not enforced — open for extension). */
export const PIM_SUBTYPES: Record<PimCategory, string[]> = {
	person: ["contact", "colleague", "client", "family", "other"],
	event: ["meeting", "interaction", "task", "trip", "purchase", "reading", "other"],
	thing: ["product", "project", "book", "tool", "concept", "other"],
	place: ["city", "office", "venue", "address", "other"],
	time: ["deadline", "period", "milestone", "recurring", "other"],
	info: ["article", "paper", "bookmark", "quote", "reference", "note", "other"],
	org: ["company", "department", "team", "community", "institution", "other"],
	ledger: ["expense", "income", "transfer", "reimbursement", "other"],
};

export const COMMON_LINK_TYPES = [
	// person ↔ person
	"同事",
	"朋友",
	"家人",
	"上下级",
	"客户",
	"合作伙伴",
	// person ↔ org
	"属于",
	"任职于",
	"创立",
	// person ↔ event
	"参与",
	"负责",
	"发起",
	"被提及",
	// person ↔ thing
	"拥有",
	"感兴趣",
	"购买",
	"使用",
	// org ↔ org
	"子级",
	"上游",
	"合作方",
	"竞争",
	// org ↔ place/thing
	"总部位于",
	"生产",
	"提供",
	// entity ↔ place
	"位于",
	"发生于",
	"居住",
	"工作于",
	// event ↔ thing
	"涉及",
	"交付",
	"产出",
	// entity ↔ time
	"计划于",
	"截止于",
	// entity ↔ info
	"参考",
	"来源于",
	"描述",
	// ledger ↔ entity
	"付款方",
	"收款方",
	"关联",
] as const;

/** A PIM item as stored in the database. */
export interface PimItem {
	id: string;
	category: PimCategory;
	subtype: string | null;
	title: string;
	content: string | null;
	properties: Record<string, unknown>;
	tags: string[];
	status: string | null;
	datetime: string | null;
	confidence: number;
	sourceIds: string[];
	agentId: string | null;
	reminded: boolean;
	createdAt: number;
	updatedAt: number;
}

/** A link between two PIM items. */
export interface PimLink {
	id: string;
	fromId: string;
	toId: string;
	type: string;
	properties: Record<string, unknown>;
	confidence: number;
	createdAt: number;
}

/** Item with its linked items (for inspect results). */
export interface PimItemDetail extends PimItem {
	links: Array<PimLink & { item: PimItem }>;
}
