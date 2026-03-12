import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { resolveDataDir } from "../config/store";
import { getGateway } from "../gateway";
import { SkillInstaller } from "../plugins/skill-installer";
import type { SkillDefinition } from "../plugins/skill-loader";

const installer = new SkillInstaller();

export const skillsRoute = new Hono()
	// List all skills (installed manifests + runtime status)
	.get("/", async (c) => {
		const gw = getGateway();
		const cfg = gw.config.get();
		const installed = await installer.listInstalled();
		const loadedPlugins = gw.pluginRegistry.getAllPlugins();

		const skills = installed.map((manifest) => {
			const loaded = loadedPlugins.find((p) => p.id === manifest.id);
			const skillCfg = cfg.plugins.skills?.[manifest.id];
			const skillDef = loaded as SkillDefinition | undefined;

			return {
				id: manifest.id,
				name: manifest.name,
				version: manifest.version,
				description: manifest.description,
				author: manifest.author,
				tags: manifest.tags,
				icon: manifest.icon,
				capabilities: manifest.capabilities,
				isolated: manifest.isolated,
				ownerOnly: manifest.ownerOnly,
				tools: manifest.tools,
				requires: manifest.requires,
				config: manifest.config,
				// Runtime status
				loaded: !!loaded,
				enabled: skillCfg?.enabled !== false && cfg.plugins.enabled[manifest.id] !== false,
				warnings: skillDef?.warnings ?? [],
				agents: skillCfg?.agents ?? [],
				userConfig: skillCfg?.config ?? {},
			};
		});

		return c.json(skills);
	})

	// Get single skill details
	.get("/:skillId", async (c) => {
		const { skillId } = c.req.param();
		const gw = getGateway();
		const cfg = gw.config.get();

		// Read manifest from disk
		const skillDir = join(resolveDataDir(), "skills", skillId);
		let manifest: Record<string, unknown>;
		try {
			const raw = await readFile(join(skillDir, "skill.json"), "utf-8");
			manifest = JSON.parse(raw);
		} catch {
			return c.json({ error: "Skill not found" }, 404);
		}

		const loaded = gw.pluginRegistry.getPlugin(skillId);
		const skillDef = loaded as SkillDefinition | undefined;
		const skillCfg = cfg.plugins.skills?.[skillId];

		return c.json({
			...manifest,
			loaded: !!loaded,
			enabled: skillCfg?.enabled !== false && cfg.plugins.enabled[skillId] !== false,
			warnings: skillDef?.warnings ?? [],
			sanitizedPrompt: skillDef?.sanitizedPrompt ?? null,
			agents: skillCfg?.agents ?? [],
			userConfig: skillCfg?.config ?? {},
		});
	})

	// Install a skill
	.post(
		"/install",
		zValidator(
			"json",
			z.object({
				source: z.enum(["local", "git", "npm"]),
				url: z.string().min(1),
				ref: z.string().optional(),
			}),
		),
		async (c) => {
			const { source, url, ref } = c.req.valid("json");

			try {
				let manifest: Awaited<ReturnType<typeof installer.installLocal>>;
				switch (source) {
					case "local":
						manifest = await installer.installLocal(url);
						break;
					case "git":
						manifest = await installer.installGit(url, ref);
						break;
					case "npm":
						manifest = await installer.installNpm(url, ref);
						break;
				}

				return c.json({
					ok: true,
					manifest,
					message: `Skill "${manifest.name}" installed. Restart gateway to activate.`,
				});
			} catch (err) {
				return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
			}
		},
	)

	// Uninstall a skill
	.delete("/:skillId", async (c) => {
		const { skillId } = c.req.param();

		try {
			await installer.uninstall(skillId);
			return c.json({
				ok: true,
				message: `Skill "${skillId}" uninstalled. Restart gateway to take effect.`,
			});
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 404);
		}
	})

	// Update skill config (enable/disable, config values, agent assignment)
	.patch(
		"/:skillId",
		zValidator(
			"json",
			z.object({
				enabled: z.boolean().optional(),
				config: z.record(z.unknown()).optional(),
				agents: z.array(z.string()).optional(),
			}),
		),
		async (c) => {
			const { skillId } = c.req.param();
			const updates = c.req.valid("json");
			const gw = getGateway();

			const cfg = gw.config.get();
			const skills = { ...cfg.plugins.skills };
			const current = skills[skillId] ?? { enabled: true, config: {}, agents: [] };

			if (updates.enabled !== undefined) current.enabled = updates.enabled;
			if (updates.config !== undefined) current.config = updates.config;
			if (updates.agents !== undefined) current.agents = updates.agents;

			skills[skillId] = current;
			cfg.plugins.skills = skills;

			// Persist through config store
			gw.config.set({ ...cfg, plugins: { ...cfg.plugins, skills } });

			return c.json({ ok: true, skill: current });
		},
	)

	// Get skill's sanitized prompt preview
	.get("/:skillId/prompt", async (c) => {
		const { skillId } = c.req.param();
		const gw = getGateway();

		const loaded = gw.pluginRegistry.getPlugin(skillId);
		const skillDef = loaded as SkillDefinition | undefined;

		if (!skillDef?.sanitizedPrompt) {
			return c.json({ prompt: null });
		}

		return c.json({ prompt: skillDef.sanitizedPrompt });
	});
