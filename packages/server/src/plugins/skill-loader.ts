import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { version as yanclawVersion } from "../../../package.json";
import { detectInjection } from "../security/sanitize";
import type { PluginDefinition } from "./types";

/** Simple semver range check (supports >=x.y.z, ^x.y.z, ~x.y.z, x.y.z). */
function satisfiesRange(version: string, range: string): boolean {
	const parse = (v: string) => {
		const m = v.match(/(\d+)\.(\d+)\.(\d+)/);
		return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
	};

	const cur = parse(version);
	const req = parse(range);
	if (!cur || !req) return true; // Can't parse → skip check

	const [cM, cm, cp] = cur;
	const [rM, rm, rp] = req;

	if (range.startsWith(">=")) return cM > rM || (cM === rM && (cm > rm || (cm === rm && cp >= rp)));
	if (range.startsWith("^")) {
		// ^0.y.z locks minor (semver spec), ^x.y.z (x>0) locks major
		if (rM === 0) return cM === 0 && cm === rm && cp >= rp;
		return cM === rM && (cm > rm || (cm === rm && cp >= rp));
	}
	if (range.startsWith("~")) return cM === rM && cm === rm && cp >= rp;
	// Exact match
	return cM === rM && cm === rm && cp === rp;
}

/** Skill manifest schema — validated from skill.json. */
const skillConfigFieldSchema = z.object({
	type: z.enum(["string", "number", "boolean"]),
	default: z.unknown().optional(),
	description: z.string().optional(),
	enum: z.array(z.unknown()).optional(),
});

const skillManifestSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	version: z.string().min(1),
	description: z.string().default(""),
	author: z.string().optional(),
	license: z.string().optional(),
	tags: z.array(z.string()).default([]),
	icon: z.string().optional(),
	requires: z
		.object({
			env: z.array(z.string()).default([]),
			bins: z.array(z.string()).default([]),
			yanclaw: z.string().optional(),
		})
		.default({}),
	capabilities: z.array(z.string()).default([]),
	isolated: z.boolean().default(false),
	ownerOnly: z.boolean().default(false),
	config: z.record(skillConfigFieldSchema).default({}),
	prompt: z.string().optional(),
	tools: z.array(z.string()).default([]),
	main: z.string().default("index.ts"),
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillConfigField = z.infer<typeof skillConfigFieldSchema>;

export interface SkillDefinition extends PluginDefinition {
	/** Skill manifest metadata. */
	manifest: SkillManifest;
	/** Sanitized prompt text (already wrapped in boundary markers). */
	sanitizedPrompt?: string;
	/** Warnings from dependency checks or prompt sanitization. */
	warnings: string[];
}

/** Max length for skill prompt.md content. */
const MAX_PROMPT_LENGTH = 2000;

/** Load a Skill from a directory containing skill.json. */
export class SkillLoader {
	/**
	 * Try to load a skill from a directory.
	 * Returns null if no skill.json found (fallback to regular plugin loading).
	 */
	async loadSkill(skillPath: string): Promise<SkillDefinition | null> {
		const manifestPath = join(skillPath, "skill.json");
		let manifestRaw: string;

		try {
			manifestRaw = await readFile(manifestPath, "utf-8");
		} catch {
			return null; // No skill.json → not a skill
		}

		const warnings: string[] = [];

		// Parse and validate manifest
		let manifest: SkillManifest;
		try {
			const parsed = JSON.parse(manifestRaw);
			manifest = skillManifestSchema.parse(parsed);
		} catch (err) {
			console.error(`[skill] Invalid skill.json at ${skillPath}:`, err);
			return null;
		}

		// Check dependencies
		this.checkDependencies(manifest, warnings);

		// Load and sanitize prompt
		let sanitizedPrompt: string | undefined;
		if (manifest.prompt) {
			sanitizedPrompt = await this.loadPrompt(skillPath, manifest, warnings);
		}

		// Import the plugin module
		const entryPath = join(skillPath, manifest.main);
		try {
			await stat(entryPath);
		} catch {
			console.error(`[skill] Entry file not found: ${entryPath}`);
			return null;
		}

		let pluginDef: PluginDefinition;
		try {
			const mod = await import(entryPath);
			pluginDef = mod.default ?? mod;
		} catch (err) {
			console.error(`[skill] Failed to import ${entryPath}:`, err);
			return null;
		}

		// Merge manifest metadata into plugin definition
		const skillDef: SkillDefinition = {
			...pluginDef,
			id: manifest.id,
			name: manifest.name,
			version: manifest.version,
			isolated: manifest.isolated,
			capabilities: manifest.capabilities.length > 0 ? manifest.capabilities : undefined,
			ownerOnly: manifest.ownerOnly,
			manifest,
			sanitizedPrompt,
			warnings,
		};

		if (warnings.length > 0) {
			console.warn(`[skill] "${manifest.name}" loaded with warnings:`, warnings);
		}

		return skillDef;
	}

	/** Check environment variables, binary dependencies, and version. */
	private checkDependencies(manifest: SkillManifest, warnings: string[]): void {
		// Check required env vars
		for (const envVar of manifest.requires.env) {
			if (!process.env[envVar]) {
				warnings.push(`Missing environment variable: ${envVar}`);
			}
		}

		// Check required binaries
		for (const bin of manifest.requires.bins) {
			try {
				Bun.spawnSync(["which", bin]);
			} catch {
				warnings.push(`Missing binary: ${bin}`);
			}
		}

		// Version compatibility check (informational — warns but does not block loading)
		if (manifest.requires.yanclaw) {
			if (!satisfiesRange(yanclawVersion, manifest.requires.yanclaw)) {
				warnings.push(`Requires YanClaw ${manifest.requires.yanclaw}, current ${yanclawVersion}`);
			}
		}
	}

	/** Load and sanitize prompt.md. */
	private async loadPrompt(
		skillPath: string,
		manifest: SkillManifest,
		warnings: string[],
	): Promise<string | undefined> {
		if (!manifest.prompt) return undefined;

		const promptPath = join(skillPath, manifest.prompt);
		let raw: string;
		try {
			raw = await readFile(promptPath, "utf-8");
		} catch {
			warnings.push(`Prompt file not found: ${manifest.prompt}`);
			return undefined;
		}

		// Length limit
		let text = raw;
		if (text.length > MAX_PROMPT_LENGTH) {
			text = text.slice(0, MAX_PROMPT_LENGTH);
			warnings.push(`Prompt truncated from ${raw.length} to ${MAX_PROMPT_LENGTH} chars`);
		}

		// Injection detection
		const injection = detectInjection(text);
		if (injection.detected) {
			warnings.push(`Injection patterns detected: ${injection.patterns.join(", ")}`);
			// Remove detected patterns
			for (const pattern of injection.patterns) {
				text = text.replace(new RegExp(pattern, "gi"), "[REMOVED]");
			}
		}

		// Wrap in boundary markers
		return `[SKILL:${manifest.id}]\n${text.trim()}\n[/SKILL:${manifest.id}]`;
	}
}
