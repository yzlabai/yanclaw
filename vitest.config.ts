import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
	resolve: {
		alias: {
			"@yanclaw/server": resolve(__dirname, "packages/server/src"),
			"@yanclaw/shared": resolve(__dirname, "packages/shared/src"),
		},
	},
	test: {
		include: ["packages/server/src/**/*.test.ts"],
	},
});
