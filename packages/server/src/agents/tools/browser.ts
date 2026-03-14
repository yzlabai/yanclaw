import { tool } from "ai";
import { z } from "zod";
import { truncateOutput } from "./common";

export interface BrowserOpts {
	maxOutput: number;
	/** CDP endpoint URL (e.g. "http://127.0.0.1:9222"). Connects to user's running browser with auth sessions. */
	cdpUrl?: string;
}

let browserInstance: import("playwright").Browser | null = null;
let pageInstance: import("playwright").Page | null = null;
let currentCdpUrl: string | undefined;

async function ensureBrowser(cdpUrl?: string) {
	// Reconnect if CDP URL changed or browser disconnected
	if (browserInstance && (!browserInstance.isConnected() || currentCdpUrl !== cdpUrl)) {
		await closeBrowser();
	}

	if (!browserInstance) {
		const { chromium } = await import("playwright");

		if (cdpUrl) {
			// Connect to user's running browser via CDP — inherits all login sessions
			try {
				browserInstance = await chromium.connectOverCDP(cdpUrl);
			} catch (err) {
				throw new Error(
					`Failed to connect to Chrome CDP at ${cdpUrl}. ` +
						`Ensure Chrome is running with --remote-debugging-port. ` +
						`Original error: ${err instanceof Error ? err.message : err}`,
				);
			}
			currentCdpUrl = cdpUrl;
		} else {
			browserInstance = await chromium.launch({ headless: true });
			currentCdpUrl = undefined;
		}
	}

	if (!pageInstance || pageInstance.isClosed()) {
		if (cdpUrl) {
			// CDP mode: use the browser's default context (has user's cookies)
			const contexts = browserInstance.contexts();
			const ctx = contexts[0] ?? (await browserInstance.newContext());
			// Create a new tab in the user's browser
			pageInstance = await ctx.newPage();
		} else {
			// Headless mode: create isolated context
			const context = await browserInstance.newContext({
				viewport: { width: 1280, height: 720 },
				userAgent:
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			});
			pageInstance = await context.newPage();
		}
	}
	return pageInstance;
}

/** Shut down the browser (called on gateway shutdown). */
export async function closeBrowser(): Promise<void> {
	if (pageInstance && !pageInstance.isClosed()) {
		await pageInstance.close().catch(() => {});
	}
	// CDP mode: close() disconnects without killing user's browser
	// Headless mode: close() terminates the browser process we launched
	if (browserInstance?.isConnected()) {
		await browserInstance.close().catch(() => {});
	}
	browserInstance = null;
	pageInstance = null;
	currentCdpUrl = undefined;
}

export function createBrowserNavigateTool(opts: BrowserOpts) {
	const cdpHint = opts.cdpUrl
		? " Connected to user's browser with existing login sessions — can access authenticated pages."
		: "";
	return tool({
		description: `Navigate the browser to a URL and extract the visible text content. Use this for reading JavaScript-rendered web pages that web_fetch cannot handle.${cdpHint}`,
		parameters: z.object({
			url: z.string().describe("The URL to navigate to"),
			waitFor: z
				.enum(["load", "domcontentloaded", "networkidle"])
				.optional()
				.default("domcontentloaded")
				.describe("Wait condition before extracting content"),
		}),
		execute: async ({ url, waitFor }) => {
			try {
				const page = await ensureBrowser(opts.cdpUrl);
				await page.goto(url, {
					waitUntil: waitFor,
					timeout: 30_000,
				});

				const title = await page.title();
				const text = await page.evaluate(() => {
					// Remove script, style, and hidden elements
					const remove = document.querySelectorAll(
						"script, style, noscript, [hidden], [aria-hidden='true']",
					);
					for (const el of remove) el.remove();
					return document.body.innerText;
				});

				const currentUrl = page.url();
				const output = `Title: ${title}\nURL: ${currentUrl}\n\n${text}`;
				return truncateOutput(output, opts.maxOutput);
			} catch (err) {
				return `Navigation error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}

export function createBrowserScreenshotTool(opts?: Pick<BrowserOpts, "cdpUrl">) {
	return tool({
		description:
			"Take a screenshot of the current browser page. Returns the screenshot as a base64 data URL. Use browser_navigate first to open a page.",
		parameters: z.object({
			fullPage: z
				.boolean()
				.optional()
				.default(false)
				.describe("Capture the full scrollable page instead of just the viewport"),
			selector: z.string().optional().describe("CSS selector to screenshot a specific element"),
		}),
		execute: async ({ fullPage, selector }) => {
			try {
				const page = await ensureBrowser(opts?.cdpUrl);

				let buffer: Buffer;
				if (selector) {
					const element = await page.$(selector);
					if (!element) {
						return `Element not found: ${selector}`;
					}
					buffer = await element.screenshot({ type: "png" });
				} else {
					buffer = await page.screenshot({ type: "png", fullPage });
				}

				const base64 = buffer.toString("base64");
				const dataUrl = `data:image/png;base64,${base64}`;
				return `Screenshot captured (${buffer.byteLength} bytes). Data URL: ${dataUrl}`;
			} catch (err) {
				return `Screenshot error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}

export function createBrowserActionTool(opts?: Pick<BrowserOpts, "cdpUrl">) {
	return tool({
		description:
			"Perform an action on the current browser page: click, type text, press keys, or scroll. Use browser_navigate first.",
		parameters: z.object({
			action: z.enum(["click", "type", "press", "scroll", "select"]).describe("Action type"),
			selector: z.string().optional().describe("CSS selector for click/type/select target"),
			text: z
				.string()
				.optional()
				.describe("Text to type (for 'type' action) or key to press (for 'press' action)"),
			direction: z
				.enum(["up", "down"])
				.optional()
				.default("down")
				.describe("Scroll direction (for 'scroll' action)"),
			amount: z.number().optional().default(500).describe("Scroll amount in pixels"),
		}),
		execute: async ({ action, selector, text, direction, amount }) => {
			try {
				const page = await ensureBrowser(opts?.cdpUrl);

				switch (action) {
					case "click": {
						if (!selector) return "Error: selector is required for click action";
						await page.click(selector, { timeout: 10_000 });
						return `Clicked: ${selector}`;
					}
					case "type": {
						if (!selector) return "Error: selector is required for type action";
						if (!text) return "Error: text is required for type action";
						await page.fill(selector, text, { timeout: 10_000 });
						return `Typed "${text}" into ${selector}`;
					}
					case "press": {
						if (!text) return "Error: text (key name) is required for press action";
						await page.keyboard.press(text);
						return `Pressed key: ${text}`;
					}
					case "scroll": {
						const delta = direction === "up" ? -(amount ?? 500) : (amount ?? 500);
						await page.mouse.wheel(0, delta);
						return `Scrolled ${direction} by ${Math.abs(delta)}px`;
					}
					case "select": {
						if (!selector) return "Error: selector is required for select action";
						if (!text) return "Error: text (option value) is required for select action";
						await page.selectOption(selector, text, { timeout: 10_000 });
						return `Selected "${text}" in ${selector}`;
					}
				}
			} catch (err) {
				return `Action error: ${err instanceof Error ? err.message : String(err)}`;
			}
		},
	});
}
