import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../logger";

/** Config field names that typically contain credentials. */
export const CREDENTIAL_FIELDS = new Set([
	"apiKey",
	"token",
	"botToken",
	"appToken",
	"signingSecret",
]);

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SCRYPT_SALT = "yanclaw-vault-v1";
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

/**
 * Encrypts and decrypts credentials using AES-256-GCM.
 * Key is derived from a machine fingerprint via scrypt.
 */
export class CredentialVault {
	private key: Buffer;
	private store = new Map<string, string>(); // name → encrypted value
	private storePath: string;

	private constructor(key: Buffer, storePath: string) {
		this.key = key;
		this.storePath = storePath;
	}

	static async create(dataDir: string): Promise<CredentialVault> {
		const machineId = await getMachineId();
		const key = scryptSync(machineId, SCRYPT_SALT, KEY_LENGTH, SCRYPT_PARAMS);
		const storePath = join(dataDir, "vault.json");
		const vault = new CredentialVault(key as Buffer, storePath);
		await vault.load();
		return vault;
	}

	/** Encrypt a plaintext string. Returns base64(iv || authTag || ciphertext). */
	encrypt(plaintext: string): string {
		const iv = randomBytes(IV_LENGTH);
		const cipher = createCipheriv(ALGORITHM, this.key, iv);
		const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
		const authTag = cipher.getAuthTag();
		return Buffer.concat([iv, authTag, encrypted]).toString("base64");
	}

	/** Decrypt a base64-encoded value. Throws if tampered or wrong key. */
	decrypt(encoded: string): string {
		const buf = Buffer.from(encoded, "base64");
		if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) {
			throw new Error("Invalid encrypted data: too short");
		}
		const iv = buf.subarray(0, IV_LENGTH);
		const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
		const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

		const decipher = createDecipheriv(ALGORITHM, this.key, iv);
		decipher.setAuthTag(authTag);
		return decipher.update(ciphertext) + decipher.final("utf-8");
	}

	/** Store an encrypted credential by name. */
	set(name: string, plaintext: string): void {
		this.store.set(name, this.encrypt(plaintext));
	}

	/** Retrieve and decrypt a credential by name. Returns undefined if not found. */
	get(name: string): string | undefined {
		const encrypted = this.store.get(name);
		if (!encrypted) return undefined;
		try {
			return this.decrypt(encrypted);
		} catch {
			log.security().error({ credential: name }, "failed to decrypt credential");
			return undefined;
		}
	}

	/** Check if a credential exists in the vault. */
	has(name: string): boolean {
		return this.store.has(name);
	}

	/** Delete a credential from the vault. */
	delete(name: string): boolean {
		return this.store.delete(name);
	}

	/** List all credential names (not values). */
	keys(): string[] {
		return [...this.store.keys()];
	}

	/** Persist vault store to disk. */
	async save(): Promise<void> {
		const data = Object.fromEntries(this.store);
		await writeFile(this.storePath, JSON.stringify(data, null, 2), "utf-8");
	}

	/** Load vault store from disk. */
	private async load(): Promise<void> {
		try {
			const content = await readFile(this.storePath, "utf-8");
			const data = JSON.parse(content) as Record<string, string>;
			for (const [name, value] of Object.entries(data)) {
				this.store.set(name, value);
			}
		} catch {
			// No vault file yet — first run
		}
	}
}

/**
 * Resolve a config value that may contain a $vault:name reference.
 * Returns the decrypted value if it's a vault ref, otherwise the original string.
 */
export function resolveVaultRef(value: string, vault: CredentialVault): string {
	const match = value.match(/^\$vault:(.+)$/);
	if (!match) return value;
	const name = match[1];
	const decrypted = vault.get(name);
	if (decrypted === undefined) {
		throw new Error(`Vault credential not found: ${name}`);
	}
	return decrypted;
}

/**
 * Recursively expand $vault:xxx references in a config object.
 */
export function expandVaultRefs(obj: unknown, vault: CredentialVault): unknown {
	if (typeof obj === "string") {
		return resolveVaultRef(obj, vault);
	}
	if (Array.isArray(obj)) {
		return obj.map((item) => expandVaultRefs(item, vault));
	}
	if (obj !== null && typeof obj === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(obj)) {
			result[key] = expandVaultRefs(value, vault);
		}
		return result;
	}
	return obj;
}

/**
 * Get a stable machine identifier.
 * - Windows: MachineGuid from registry
 * - macOS: IOPlatformUUID
 * - Linux: /var/lib/dbus/machine-id or /etc/machine-id
 */
async function getMachineId(): Promise<string> {
	const platform = process.platform;

	try {
		if (platform === "win32") {
			const proc = Bun.spawn(
				["reg", "query", "HKLM\\SOFTWARE\\Microsoft\\Cryptography", "/v", "MachineGuid"],
				{ stdout: "pipe", stderr: "pipe" },
			);
			const output = await new Response(proc.stdout).text();
			const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
			if (match) return match[1];
		} else if (platform === "darwin") {
			const proc = Bun.spawn(["ioreg", "-rd1", "-c", "IOPlatformExpertDevice"], {
				stdout: "pipe",
				stderr: "pipe",
			});
			const output = await new Response(proc.stdout).text();
			const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
			if (match) return match[1];
		} else {
			// Linux
			for (const path of ["/var/lib/dbus/machine-id", "/etc/machine-id"]) {
				try {
					const id = await readFile(path, "utf-8");
					if (id.trim()) return id.trim();
				} catch {
					// Try next path
				}
			}
		}
	} catch {
		// Fall through to fallback
	}

	// Fallback: generate and persist a random machine ID in data dir
	const { homedir } = await import("node:os");
	const dataDir = process.env.YANCLAW_DATA_DIR ?? join(homedir(), ".yanclaw");
	const fallbackPath = join(dataDir, ".machine-id");
	try {
		if (existsSync(fallbackPath)) {
			const id = await readFile(fallbackPath, "utf-8");
			if (id.trim()) return id.trim();
		}
		const generated = randomBytes(16).toString("hex");
		await writeFile(fallbackPath, generated, "utf-8");
		log.security().warn("generated fallback machine ID (platform detection failed)");
		return generated;
	} catch {
		// Last resort: non-persistent random (vault will break on restart)
		log.security().error("cannot persist machine ID — vault credentials will be lost on restart");
		return randomBytes(16).toString("hex");
	}
}
