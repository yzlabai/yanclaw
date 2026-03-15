import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveDataDir } from "../config/store";
import { log } from "../logger";
import type { SkillManifest } from "./skill-loader";

/** Install, uninstall, and list skills in ~/.yanclaw/skills/. */
export class SkillInstaller {
	private skillsDir: string;

	constructor() {
		this.skillsDir = join(resolveDataDir(), "skills");
	}

	/** Ensure skills directory exists. */
	private async ensureDir(): Promise<void> {
		await mkdir(this.skillsDir, { recursive: true });
	}

	/** Install a skill from a local directory (copies to skills dir). */
	async installLocal(sourcePath: string): Promise<SkillManifest> {
		await this.ensureDir();

		// Validate source has skill.json
		const manifestPath = join(sourcePath, "skill.json");
		const raw = await readFile(manifestPath, "utf-8");
		const manifest = JSON.parse(raw) as SkillManifest;

		if (!manifest.id) {
			throw new Error("Invalid skill.json: missing id");
		}

		const destDir = join(this.skillsDir, manifest.id);

		// Copy directory
		const proc = Bun.spawnSync(["cp", "-r", sourcePath, destDir]);
		if (proc.exitCode !== 0) {
			throw new Error(`Failed to copy skill: ${proc.stderr.toString()}`);
		}

		log
			.plugin()
			.info(
				{ skillName: manifest.name, version: manifest.version, source: "local" },
				"skill installed",
			);
		return manifest;
	}

	/** Install a skill from a Git URL. */
	async installGit(url: string, ref?: string): Promise<SkillManifest> {
		await this.ensureDir();

		// Clone to temp, then move
		const tmpDir = join(this.skillsDir, `.tmp-${Date.now()}`);
		try {
			const args = ["git", "clone", "--depth", "1"];
			if (ref) args.push("--branch", ref);
			args.push(url, tmpDir);

			const proc = Bun.spawnSync(args);
			if (proc.exitCode !== 0) {
				throw new Error(`Git clone failed: ${proc.stderr.toString()}`);
			}

			// Read manifest
			const manifestPath = join(tmpDir, "skill.json");
			const raw = await readFile(manifestPath, "utf-8");
			const manifest = JSON.parse(raw) as SkillManifest;

			if (!manifest.id) {
				throw new Error("Invalid skill.json: missing id");
			}

			// Remove .git directory
			await rm(join(tmpDir, ".git"), { recursive: true, force: true });

			// Move to final location
			const destDir = join(this.skillsDir, manifest.id);
			await rm(destDir, { recursive: true, force: true });
			const mvProc = Bun.spawnSync(["mv", tmpDir, destDir]);
			if (mvProc.exitCode !== 0) {
				throw new Error(`Failed to move skill: ${mvProc.stderr.toString()}`);
			}

			// Install dependencies if package.json exists
			try {
				await stat(join(destDir, "package.json"));
				Bun.spawnSync(["bun", "install"], { cwd: destDir });
			} catch {
				// No package.json, skip
			}

			log
				.plugin()
				.info(
					{ skillName: manifest.name, version: manifest.version, source: "git" },
					"skill installed",
				);
			return manifest;
		} catch (err) {
			// Cleanup temp dir on failure
			await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
			throw err;
		}
	}

	/** Install a skill from an npm package. */
	async installNpm(packageName: string, version?: string): Promise<SkillManifest> {
		await this.ensureDir();

		const spec = version ? `${packageName}@${version}` : packageName;
		const tmpDir = join(this.skillsDir, `.tmp-npm-${Date.now()}`);
		await mkdir(tmpDir, { recursive: true });

		try {
			// Initialize and install the package
			Bun.spawnSync(["bun", "init", "-y"], { cwd: tmpDir });
			const proc = Bun.spawnSync(["bun", "add", spec], { cwd: tmpDir });
			if (proc.exitCode !== 0) {
				throw new Error(`npm install failed: ${proc.stderr.toString()}`);
			}

			// Find the installed package's skill.json
			const pkgDir = join(tmpDir, "node_modules", packageName);
			const manifestPath = join(pkgDir, "skill.json");
			const raw = await readFile(manifestPath, "utf-8");
			const manifest = JSON.parse(raw) as SkillManifest;

			if (!manifest.id) {
				throw new Error("Package does not contain a valid skill.json");
			}

			// Copy package to skills dir
			const destDir = join(this.skillsDir, manifest.id);
			await rm(destDir, { recursive: true, force: true });
			Bun.spawnSync(["cp", "-r", pkgDir, destDir]);

			log
				.plugin()
				.info(
					{ skillName: manifest.name, version: manifest.version, source: "npm" },
					"skill installed",
				);
			return manifest;
		} finally {
			await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
		}
	}

	/** Uninstall a skill by ID. */
	async uninstall(skillId: string): Promise<void> {
		const skillDir = join(this.skillsDir, skillId);
		try {
			await stat(skillDir);
		} catch {
			throw new Error(`Skill "${skillId}" not found`);
		}

		await rm(skillDir, { recursive: true, force: true });
		log.plugin().info({ skillId }, "skill uninstalled");
	}

	/** List all installed skill manifests. */
	async listInstalled(): Promise<SkillManifest[]> {
		await this.ensureDir();
		const manifests: SkillManifest[] = [];

		let entries: string[];
		try {
			entries = await readdir(this.skillsDir);
		} catch {
			return [];
		}

		for (const entry of entries) {
			if (entry.startsWith(".")) continue;
			const skillDir = join(this.skillsDir, entry);
			try {
				const info = await stat(skillDir);
				if (!info.isDirectory()) continue;

				const manifestPath = join(skillDir, "skill.json");
				const raw = await readFile(manifestPath, "utf-8");
				manifests.push(JSON.parse(raw) as SkillManifest);
			} catch {
				// Not a valid skill directory, skip
			}
		}

		return manifests;
	}

	/** Get the skills directory path. */
	getSkillsDir(): string {
		return this.skillsDir;
	}
}
