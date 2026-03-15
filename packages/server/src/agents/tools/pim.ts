import { tool } from "ai";
import { z } from "zod";
import type { PimStore } from "../../pim/store";
import { PIM_CATEGORIES } from "../../pim/types";

const categoryEnum = z.enum(PIM_CATEGORIES as unknown as [string, ...string[]]);

export function createPimQueryTool(opts: { pimStore: PimStore }) {
	return tool({
		description: `Query the personal information system. Supports people, events, things, places, time, info, organizations, and ledger entries.
Examples:
- "我的客户有哪些" → category=person, q=客户
- "下周的安排" → category=event
- "ABC公司有哪些人" → category=person, q=ABC
- "这个月花了多少钱" → category=ledger`,
		parameters: z.object({
			query: z.string().describe("Search keyword"),
			category: categoryEnum.optional().describe("Filter by category"),
			subtype: z.string().optional().describe("Filter by subtype"),
			status: z.string().optional().describe("Filter by status (e.g. pending, done)"),
			limit: z.number().optional().default(20),
		}),
		execute: async ({ query, category, subtype, status, limit }) => {
			const items = await opts.pimStore.query({
				category: category as Parameters<typeof opts.pimStore.query>[0]["category"],
				subtype,
				status,
				q: query,
				limit,
			});

			if (items.length === 0) return "No items found.";

			return items
				.map((item) => {
					const props = Object.entries(item.properties)
						.filter(([, v]) => v !== null && v !== undefined && v !== "")
						.map(([k, v]) => `${k}=${v}`)
						.join(", ");
					const parts = [
						`[${item.category}${item.subtype ? `:${item.subtype}` : ""}] ${item.title}`,
					];
					if (props) parts.push(`  ${props}`);
					if (item.datetime) parts.push(`  datetime: ${item.datetime}`);
					if (item.status) parts.push(`  status: ${item.status}`);
					parts.push(`  id: ${item.id}`);
					return parts.join("\n");
				})
				.join("\n\n");
		},
	});
}

export function createPimSaveTool(opts: { pimStore: PimStore }) {
	return tool({
		description: `Save an entity to the personal information system. Supports: person, event, thing, place, time, info, org, ledger.
If a same-name same-category item exists, merges properties instead of duplicating.`,
		parameters: z.object({
			category: categoryEnum,
			subtype: z.string().optional(),
			title: z.string(),
			content: z.string().optional(),
			properties: z.record(z.unknown()).optional(),
			tags: z.array(z.string()).optional(),
			datetime: z.string().optional(),
			status: z.string().optional(),
			linkTo: z.string().optional().describe("ID of an existing item to link to"),
			linkType: z.string().optional().describe("Link type (e.g. 参与, 任职于, 关联)"),
		}),
		execute: async ({
			category,
			subtype,
			title,
			content,
			properties,
			tags,
			datetime,
			status,
			linkTo,
			linkType,
		}) => {
			const cat = category as Parameters<typeof opts.pimStore.create>[0]["category"];

			// Ledger items are never deduplicated — each is a unique record
			if (cat !== "ledger") {
				const existing = await opts.pimStore.findByTitle(title, cat);
				if (existing) {
					await opts.pimStore.mergeProperties(existing.id, properties ?? {});
					if (status) await opts.pimStore.update(existing.id, { status });
					if (datetime) await opts.pimStore.update(existing.id, { datetime });

					if (linkTo && linkType) {
						await opts.pimStore.createLink({
							fromId: existing.id,
							toId: linkTo,
							type: linkType,
						});
					}
					return `Updated existing ${category}: "${title}" (id: ${existing.id})`;
				}
			}

			const id = await opts.pimStore.create({
				category: cat,
				subtype,
				title,
				content,
				properties,
				tags,
				datetime,
				status,
			});

			if (linkTo && linkType) {
				await opts.pimStore.createLink({ fromId: id, toId: linkTo, type: linkType });
			}

			return `Created ${category}: "${title}" (id: ${id})`;
		},
	});
}

export function createPimUpdateTool(opts: { pimStore: PimStore }) {
	return tool({
		description:
			"Update an item's status or properties. Use for marking todos as done, updating contact info, etc.",
		parameters: z.object({
			id: z.string().describe("Item ID to update"),
			status: z.string().optional().describe("New status (e.g. done, cancelled)"),
			properties: z.record(z.unknown()).optional().describe("Properties to merge"),
			title: z.string().optional(),
			content: z.string().optional(),
		}),
		execute: async ({ id, status, properties, title, content }) => {
			const item = await opts.pimStore.get(id);
			if (!item) return `Item not found: ${id}`;

			const patch: Parameters<typeof opts.pimStore.update>[1] = {};
			if (status !== undefined) patch.status = status;
			if (title !== undefined) patch.title = title;
			if (content !== undefined) patch.content = content;
			if (properties) {
				patch.properties = { ...item.properties, ...properties };
			}

			await opts.pimStore.update(id, patch);
			return `Updated ${item.category}: "${item.title}" (${Object.keys(patch).join(", ")})`;
		},
	});
}

export function createPimInspectTool(opts: { pimStore: PimStore }) {
	return tool({
		description:
			"Inspect a specific item with full details and all linked items. Use to see a contact's interactions, an org's members, etc.",
		parameters: z.object({
			id: z.string().describe("Item ID to inspect"),
		}),
		execute: async ({ id }) => {
			const detail = await opts.pimStore.inspect(id);
			if (!detail) return `Item not found: ${id}`;

			const lines = [
				`[${detail.category}${detail.subtype ? `:${detail.subtype}` : ""}] ${detail.title}`,
				`id: ${detail.id}`,
			];
			if (detail.content) lines.push(`content: ${detail.content}`);
			if (detail.datetime) lines.push(`datetime: ${detail.datetime}`);
			if (detail.status) lines.push(`status: ${detail.status}`);

			const props = Object.entries(detail.properties).filter(
				([, v]) => v !== null && v !== undefined && v !== "",
			);
			if (props.length > 0) {
				lines.push("properties:");
				for (const [k, v] of props) lines.push(`  ${k}: ${JSON.stringify(v)}`);
			}

			if (detail.tags.length > 0) lines.push(`tags: ${detail.tags.join(", ")}`);

			if (detail.links.length > 0) {
				lines.push(`\nLinked items (${detail.links.length}):`);
				for (const link of detail.links) {
					lines.push(
						`  → [${link.item.category}] ${link.item.title} (${link.type}) id:${link.item.id}`,
					);
				}
			}

			return lines.join("\n");
		},
	});
}
