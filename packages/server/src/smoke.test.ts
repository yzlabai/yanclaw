import { describe, expect, it } from "vitest";

/**
 * Smoke tests — verify critical modules can be imported and initialized
 * without runtime errors. Catches issues like missing dependencies,
 * broken transport resolution, or import-time failures.
 */
describe("smoke: module imports", () => {
	it("logger initializes without error", async () => {
		const { initLogger, getLogger } = await import("./logger");
		const logger = initLogger({
			level: "silent",
			file: { enabled: false, maxSize: 0, maxFiles: 0 },
			pretty: false,
		});
		expect(logger).toBeDefined();
		expect(getLogger()).toBe(logger);
	});

	it("config schema validates defaults", async () => {
		const { configSchema } = await import("./config/schema");
		expect(configSchema).toBeDefined();
		const result = configSchema.safeParse({});
		expect(result.success).toBe(true);
	});
});
