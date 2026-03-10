#!/usr/bin/env bun
/**
 * Vault migration script: encrypts plaintext credentials in config.json5
 * into the vault store and replaces them with $vault:key_name references.
 *
 * Usage: bun run packages/server/src/security/vault-migrate.ts
 */

import { copyFile, readFile, writeFile } from "node:fs/promises";
import JSON5 from "json5";
import { resolveConfigPath, resolveDataDir } from "../config/store";
import { CredentialVault } from "./vault";

/** Fields that likely contain credentials. */
const CREDENTIAL_FIELDS = new Set(["apiKey", "token", "botToken", "appToken", "signingSecret"]);

interface FoundCredential {
	path: string; // e.g. "models.anthropic.profiles[0].apiKey"
	key: string; // e.g. "anthropic_default_apiKey"
	value: string;
}

function findCredentials(obj: unknown, path: string, results: FoundCredential[]): void {
	if (obj === null || obj === undefined) return;

	if (Array.isArray(obj)) {
		for (let i = 0; i < obj.length; i++) {
			findCredentials(obj[i], `${path}[${i}]`, results);
		}
		return;
	}

	if (typeof obj === "object") {
		for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
			const fieldPath = path ? `${path}.${key}` : key;

			if (CREDENTIAL_FIELDS.has(key) && typeof value === "string" && value.length > 0) {
				// Skip already-encrypted references and env var references
				if (value.startsWith("$vault:") || value.startsWith("${")) continue;

				// Generate a vault key name from the path
				const vaultKey = fieldPath
					.replace(/\[(\d+)\]/g, "_$1")
					.replace(/\./g, "_")
					.replace(/[^a-zA-Z0-9_]/g, "");

				results.push({ path: fieldPath, key: vaultKey, value });
			}

			findCredentials(value, fieldPath, results);
		}
	}
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): void {
	const parts = path.split(/\.|\[(\d+)\]/).filter(Boolean);
	let current: unknown = obj;

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		const index = Number(part);
		if (!Number.isNaN(index) && Array.isArray(current)) {
			current = current[index];
		} else {
			current = (current as Record<string, unknown>)[part];
		}
	}

	const lastPart = parts[parts.length - 1];
	const lastIndex = Number(lastPart);
	if (!Number.isNaN(lastIndex) && Array.isArray(current)) {
		current[lastIndex] = value;
	} else {
		(current as Record<string, unknown>)[lastPart] = value;
	}
}

async function main(): Promise<void> {
	const configPath = resolveConfigPath();
	const dataDir = resolveDataDir();

	console.log(`[vault-migrate] Config: ${configPath}`);
	console.log(`[vault-migrate] Data dir: ${dataDir}`);

	// Read config
	const content = await readFile(configPath, "utf-8");
	const raw = JSON5.parse(content) as Record<string, unknown>;

	// Find credentials
	const credentials: FoundCredential[] = [];
	findCredentials(raw, "", credentials);

	if (credentials.length === 0) {
		console.log("[vault-migrate] No plaintext credentials found in config.");
		return;
	}

	console.log(`\n[vault-migrate] Found ${credentials.length} credential(s):`);
	for (const cred of credentials) {
		const masked = `${cred.value.substring(0, 4)}${"*".repeat(Math.min(cred.value.length - 4, 20))}`;
		console.log(`  ${cred.path}: ${masked} → $vault:${cred.key}`);
	}

	// Initialize vault
	const vault = await CredentialVault.create(dataDir);

	// Encrypt and store each credential
	for (const cred of credentials) {
		vault.set(cred.key, cred.value);
		setNestedValue(raw, cred.path, `$vault:${cred.key}`);
	}

	// Save vault
	await vault.save();
	console.log(`\n[vault-migrate] Encrypted ${credentials.length} credential(s) to vault.json`);

	// Backup original config
	const backupPath = `${configPath}.bak`;
	await copyFile(configPath, backupPath);
	console.log(`[vault-migrate] Backup saved to ${backupPath}`);

	// Write updated config
	await writeFile(configPath, JSON5.stringify(raw, null, 2), "utf-8");
	console.log("[vault-migrate] Updated config.json5 with $vault:xxx references");

	console.log("\n⚠️  Keep the .bak file until you've confirmed the vault works correctly.");
	console.log("    If machine-id changes (e.g., OS reinstall), restore from .bak.");
}

main().catch((err) => {
	console.error("[vault-migrate] Error:", err);
	process.exit(1);
});
