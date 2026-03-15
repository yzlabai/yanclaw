/**
 * Bun-native smoke tests — run with `bun run packages/server/src/smoke.bun.test.ts`
 *
 * These tests run under the real Bun runtime (not Vitest's Node.js workers),
 * validating that Bun-specific APIs and critical startup modules work in
 * the production runtime. Exits with code 1 on any failure.
 */

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
	try {
		await fn();
		passed++;
		console.log(`  \x1b[32m✓\x1b[0m ${name}`);
	} catch (err) {
		failed++;
		console.error(`  \x1b[31m✗\x1b[0m ${name}`);
		console.error(`    ${err}`);
	}
}

function assert(condition: boolean, msg: string) {
	if (!condition) throw new Error(msg);
}

console.log("\n\x1b[1mBun Runtime Smoke Tests\x1b[0m\n");

// ── Runtime ────────────────────────────────────────────

await test("running in Bun runtime", () => {
	assert(typeof Bun === "object", "Bun global not found");
	assert(!!Bun.version, "Bun.version is empty");
});

// ── bun:sqlite ─────────────────────────────────────────

await test("bun:sqlite is available", async () => {
	const { Database } = await import("bun:sqlite");
	const db = new Database(":memory:");
	const row = db.query("SELECT 1 as v").get() as { v: number };
	assert(row.v === 1, `expected 1, got ${row.v}`);
	db.close();
});

// ── import.meta.resolve ────────────────────────────────

await test("import.meta.resolve works for pino transports", () => {
	const prettyPath = import.meta.resolve("pino-pretty");
	const rollPath = import.meta.resolve("pino-roll");
	assert(!!prettyPath, "pino-pretty resolved to empty");
	assert(!!rollPath, "pino-roll resolved to empty");
});

// ── Logger ─────────────────────────────────────────────

await test("logger initializes with pino transports", async () => {
	const { initLogger, getLogger } = await import("./logger");
	const logger = initLogger({
		level: "silent",
		file: { enabled: false, maxSize: 0, maxFiles: 0 },
		pretty: false,
	});
	assert(!!logger, "logger is falsy");
	assert(getLogger() === logger, "getLogger() !== logger");
});

// ── Config ─────────────────────────────────────────────

await test("config schema parses defaults", async () => {
	const { configSchema } = await import("./config/schema");
	const result = configSchema.safeParse({});
	assert(result.success, `schema parse failed: ${JSON.stringify((result as any).error?.issues)}`);
});

// ── Database ───────────────────────────────────────────

await test("database initializes in-memory", async () => {
	const { initDatabase, getDb } = await import("./db");
	initDatabase(":memory:");
	const db = getDb();
	assert(!!db, "db is falsy");
});

// ── Hono App ───────────────────────────────────────────

await test("hono app constructs and routes load", async () => {
	const { app } = await import("./app");
	assert(!!app, "app is falsy");
});

// ── Summary ────────────────────────────────────────────

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
