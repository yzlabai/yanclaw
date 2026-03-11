import { describe, expect, it, vi } from "vitest";
import { createDesktopScreenshotTool } from "./screenshot";

describe("createDesktopScreenshotTool", () => {
	it("creates a tool with the correct name and parameters schema", () => {
		const tool = createDesktopScreenshotTool();
		expect(tool).toBeDefined();
		expect(typeof tool.execute).toBe("function");

		// Verify parameter schema shape
		const schema = tool.parameters;
		expect(schema).toBeDefined();
		const parsed = schema.parse({});
		expect(parsed.mode).toBe("fullscreen");
	});

	it("schema accepts fullscreen mode", () => {
		const tool = createDesktopScreenshotTool();
		const parsed = tool.parameters.parse({ mode: "fullscreen" });
		expect(parsed.mode).toBe("fullscreen");
	});

	it("schema accepts region mode with coordinates", () => {
		const tool = createDesktopScreenshotTool();
		const parsed = tool.parameters.parse({ mode: "region", x: 0, y: 0, width: 800, height: 600 });
		expect(parsed.mode).toBe("region");
		expect(parsed.x).toBe(0);
		expect(parsed.y).toBe(0);
		expect(parsed.width).toBe(800);
		expect(parsed.height).toBe(600);
	});

	it("schema rejects invalid mode", () => {
		const tool = createDesktopScreenshotTool();
		expect(() => tool.parameters.parse({ mode: "window" })).toThrow();
	});

	it("schema rejects non-positive width/height", () => {
		const tool = createDesktopScreenshotTool();
		expect(() =>
			tool.parameters.parse({ mode: "region", x: 0, y: 0, width: -1, height: 600 }),
		).toThrow();
		expect(() =>
			tool.parameters.parse({ mode: "region", x: 0, y: 0, width: 800, height: 0 }),
		).toThrow();
	});

	it("returns error when region mode is missing coordinates", async () => {
		const tool = createDesktopScreenshotTool();
		const result = await tool.execute(
			{ mode: "region" },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toMatch(/Error:.*region mode requires/);
	});

	it("returns error when region mode is missing some coordinates", async () => {
		const tool = createDesktopScreenshotTool();
		const result = await tool.execute(
			{ mode: "region", x: 0, y: 0 },
			{ toolCallId: "t1", messages: [] },
		);
		expect(result).toMatch(/Error:.*region mode requires/);
	});
});

// Integration tests require macOS with a real display (screencapture fails in headless environments).
// Run manually: ENABLE_SCREENSHOT_INTEGRATION=1 vitest run screenshot.test.ts
describe("createDesktopScreenshotTool — integration (requires macOS screencapture)", () => {
	const shouldRun = process.platform === "darwin" && process.env.ENABLE_SCREENSHOT_INTEGRATION === "1";

	it.skipIf(!shouldRun)(
		"captures a fullscreen screenshot and returns a data URL",
		async () => {
			const tool = createDesktopScreenshotTool();
			const result = await tool.execute({ mode: "fullscreen" }, { toolCallId: "t1", messages: [] });
			expect(typeof result).toBe("string");
			expect(result as string).toMatch(/^data:image\/png;base64,/);
		},
	);

	it.skipIf(!shouldRun)(
		"captures a region screenshot and returns a data URL",
		async () => {
			const tool = createDesktopScreenshotTool();
			const result = await tool.execute(
				{ mode: "region", x: 0, y: 0, width: 100, height: 100 },
				{ toolCallId: "t1", messages: [] },
			);
			expect(typeof result).toBe("string");
			expect(result as string).toMatch(/^data:image\/png;base64,/);
		},
	);
});
