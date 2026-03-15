import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			"@yanclaw/server": resolve(__dirname, "packages/server/src"),
			"@yanclaw/shared": resolve(__dirname, "packages/shared/src"),
		},
	},
	test: {
		include: ["packages/server/src/**/*.test.ts"],
		exclude: ["packages/server/src/**/*.bun.test.ts"],
	},
});
