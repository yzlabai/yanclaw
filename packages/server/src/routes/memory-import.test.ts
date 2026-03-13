import { describe, expect, it } from "vitest";
import { chunkCsv, chunkJson, chunkMarkdown, chunkPlainText } from "../memory/chunker";

describe("chunkMarkdown", () => {
	it("splits by ## headings", () => {
		const md = `# Title

Intro paragraph.

## Section One

Content of section one.

## Section Two

Content of section two.
`;
		const chunks = chunkMarkdown(md);
		expect(chunks).toHaveLength(3); // preamble + 2 sections
		expect(chunks[0].content).toContain("Intro paragraph");
		expect(chunks[0].title).toBeUndefined();
		expect(chunks[1].title).toBe("Section One");
		expect(chunks[1].content).toContain("Content of section one");
		expect(chunks[2].title).toBe("Section Two");
		expect(chunks[2].content).toContain("Content of section two");
	});

	it("falls through to plain text if no ## headings", () => {
		const md = "Paragraph one.\n\nParagraph two.\n\nParagraph three.";
		const chunks = chunkMarkdown(md);
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		// Should use plain text chunking — all content merged into one chunk
		expect(chunks[0].content).toContain("Paragraph one");
	});

	it("handles markdown with only headings and no preamble", () => {
		const md = `## First

Content A.

## Second

Content B.
`;
		const chunks = chunkMarkdown(md);
		expect(chunks).toHaveLength(2);
		expect(chunks[0].title).toBe("First");
		expect(chunks[1].title).toBe("Second");
	});
});

describe("chunkPlainText", () => {
	it("splits by double newlines", () => {
		const text = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
		const chunks = chunkPlainText(text);
		// All under 4000 chars, so merged into one chunk
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toContain("First paragraph");
		expect(chunks[0].content).toContain("Third paragraph");
	});

	it("splits large content into multiple chunks", () => {
		const para = "A".repeat(2000);
		const text = `${para}\n\n${para}\n\n${para}`;
		const chunks = chunkPlainText(text);
		expect(chunks.length).toBeGreaterThanOrEqual(2);
		for (const chunk of chunks) {
			expect(chunk.content.length).toBeLessThanOrEqual(4002); // 4000 + possible \n\n
		}
	});

	it("handles empty text", () => {
		expect(chunkPlainText("")).toHaveLength(0);
		expect(chunkPlainText("   ")).toHaveLength(0);
	});
});

describe("chunkJson", () => {
	it("handles JSON array of strings", () => {
		const json = JSON.stringify(["fact one", "fact two", "fact three"]);
		const chunks = chunkJson(json);
		expect(chunks).toHaveLength(3);
		expect(chunks[0].content).toBe("fact one");
		expect(chunks[1].content).toBe("fact two");
	});

	it("handles JSON array of objects with content field", () => {
		const json = JSON.stringify([
			{ title: "Note 1", content: "Content of note 1" },
			{ title: "Note 2", content: "Content of note 2" },
		]);
		const chunks = chunkJson(json);
		expect(chunks).toHaveLength(2);
		expect(chunks[0].title).toBe("Note 1");
		expect(chunks[0].content).toBe("Content of note 1");
	});

	it("handles JSON object with text field", () => {
		const json = JSON.stringify({ text: "Some knowledge text", title: "My Doc" });
		const chunks = chunkJson(json);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toBe("Some knowledge text");
		expect(chunks[0].title).toBe("My Doc");
	});

	it("stringifies objects without content/text/body field", () => {
		const json = JSON.stringify({ foo: "bar", num: 42 });
		const chunks = chunkJson(json);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toContain('"foo"');
	});
});

describe("chunkCsv", () => {
	it("parses CSV rows with headers", () => {
		const csv = "name,description\nAlice,Engineer\nBob,Designer";
		const chunks = chunkCsv(csv);
		expect(chunks).toHaveLength(2);
		expect(chunks[0].content).toBe("name: Alice\ndescription: Engineer");
		expect(chunks[1].content).toBe("name: Bob\ndescription: Designer");
	});

	it("handles quoted fields with commas", () => {
		const csv = 'title,body\n"Hello, World","A greeting"';
		const chunks = chunkCsv(csv);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toContain("title: Hello, World");
		expect(chunks[0].content).toContain("body: A greeting");
	});

	it("returns empty for header-only CSV", () => {
		const csv = "col1,col2";
		const chunks = chunkCsv(csv);
		expect(chunks).toHaveLength(0);
	});

	it("handles escaped quotes in CSV", () => {
		const csv = 'name,note\nAlice,"She said ""hi"""';
		const chunks = chunkCsv(csv);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toContain('note: She said "hi"');
	});
});
