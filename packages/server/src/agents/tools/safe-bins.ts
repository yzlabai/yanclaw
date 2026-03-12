/**
 * SafeBins: defines which shell commands can bypass approval and under what constraints.
 * Commands in the safe list are restricted to stdin-only mode with dangerous flags denied.
 */

interface SafeBinProfile {
	/** Max positional arguments allowed. 0 = stdin-only. undefined = unlimited. */
	maxPositional?: number;
	/** Flags that are explicitly blocked. */
	deniedFlags?: Set<string>;
	/** If true, allow all flags except denied ones. Default: true. */
	allowUnknownFlags?: boolean;
}

/** Built-in safe command profiles with security restrictions. */
const BUILTIN_PROFILES: Record<string, SafeBinProfile> = {
	// Text processing — stdin-only, no file access flags
	jq: { maxPositional: 1, deniedFlags: new Set(["--rawfile", "--slurpfile", "--jsonargs"]) },
	grep: { maxPositional: 1, deniedFlags: new Set(["-r", "-R", "--include", "-f", "--file"]) },
	cut: { maxPositional: 0 },
	head: { maxPositional: 0 },
	tail: { maxPositional: 0 },
	sort: { maxPositional: 0 },
	uniq: { maxPositional: 0 },
	wc: { maxPositional: 0 },
	tr: { maxPositional: 0 },
	sed: { maxPositional: 0, deniedFlags: new Set(["-i", "--in-place"]) },
	awk: { maxPositional: 0, deniedFlags: new Set(["-f"]) },

	// Read-only system info
	date: {},
	pwd: {},
	whoami: {},
	hostname: {},
	uname: {},
	uptime: {},
	df: { deniedFlags: new Set(["--output"]) },

	// Read-only file inspection (no modification)
	ls: {},
	cat: {},
	find: { deniedFlags: new Set(["-exec", "-execdir", "-delete", "-ok"]) },
	file: {},
	which: {},
	echo: {},

	// Network inspection (read-only)
	curl: {
		deniedFlags: new Set([
			"--proxy",
			"--proxy-user",
			"-x",
			"-U",
			"-T",
			"--upload-file",
			"-d",
			"--data",
			"--data-raw",
			"--data-binary",
			"-F",
			"--form",
			"-o",
			"--output",
			"-O",
			"--remote-name",
			"-K",
			"--config",
		]),
	},

	// Version/help — always safe
	node: { maxPositional: 0, deniedFlags: new Set(["-e", "--eval"]) },
	bun: { maxPositional: 0, deniedFlags: new Set(["-e", "--eval"]) },
	python: { maxPositional: 0, deniedFlags: new Set(["-c"]) },
	python3: { maxPositional: 0, deniedFlags: new Set(["-c"]) },
	git: {
		deniedFlags: new Set(["--exec"]),
		/** Dangerous git subcommands checked separately in checkSafeBin. */
		deniedSubcommands: new Set([
			"push",
			"reset",
			"checkout",
			"clean",
			"rm",
			"mv",
			"rebase",
			"merge",
			"commit",
			"stash",
			"remote",
			"config",
		]),
	} as SafeBinProfile & { deniedSubcommands: Set<string> },
};

export interface SafeBinCheckResult {
	safe: boolean;
	reason?: string;
}

/**
 * Parse a shell command into binary + arguments, handling common patterns.
 */
function parseCommand(command: string): { binary: string; args: string[] } {
	const trimmed = command.trimStart();

	// Tokenize respecting quotes (simple: split on unquoted spaces)
	const tokens: string[] = [];
	let current = "";
	let inSingle = false;
	let inDouble = false;

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		if (ch === "'" && !inDouble) {
			inSingle = !inSingle;
		} else if (ch === '"' && !inSingle) {
			inDouble = !inDouble;
		} else if (ch === " " && !inSingle && !inDouble) {
			if (current) {
				tokens.push(current);
				current = "";
			}
		} else {
			current += ch;
		}
	}
	if (current) tokens.push(current);

	// Skip leading env vars (VAR=val) and sudo
	let idx = 0;
	while (idx < tokens.length) {
		if (tokens[idx] === "sudo" || /^\w+=/.test(tokens[idx])) {
			idx++;
		} else {
			break;
		}
	}

	const binary = tokens[idx] ?? "";
	const args = tokens.slice(idx + 1);
	return { binary, args };
}

/**
 * Check if a command is safe to execute without approval.
 * Returns { safe: true } if the command passes all checks.
 */
export function checkSafeBin(command: string, userSafeBins: string[]): SafeBinCheckResult {
	const { binary, args } = parseCommand(command);

	if (!binary) return { safe: false, reason: "Empty command" };

	// Check if binary is in user's safe list OR has a builtin profile
	const baseName = binary.split("/").pop() ?? binary;
	const isInUserList = userSafeBins.includes(baseName);
	const profile = BUILTIN_PROFILES[baseName];

	if (!isInUserList && !profile) {
		return { safe: false, reason: `${baseName} is not in safe bins list` };
	}

	// If no profile, just check user list (simple bypass, no arg checking)
	if (!profile) {
		return { safe: true };
	}

	// Check denied subcommands (e.g. git push, git reset)
	const profileAny = profile as SafeBinProfile & { deniedSubcommands?: Set<string> };
	if (profileAny.deniedSubcommands && args.length > 0) {
		// First non-flag arg is the subcommand
		const subcommand = args.find((a) => !a.startsWith("-"));
		if (subcommand && profileAny.deniedSubcommands.has(subcommand)) {
			return { safe: false, reason: `Denied subcommand "${subcommand}" for ${baseName}` };
		}
	}

	// Check denied flags
	if (profile.deniedFlags) {
		for (const arg of args) {
			// Normalize: --flag=value → --flag
			const flag = arg.includes("=") ? arg.split("=")[0] : arg;
			if (profile.deniedFlags.has(flag)) {
				return { safe: false, reason: `Denied flag "${flag}" for ${baseName}` };
			}
		}
	}

	// Check max positional arguments
	if (profile.maxPositional !== undefined) {
		const positionals = args.filter((a) => !a.startsWith("-"));
		if (positionals.length > profile.maxPositional) {
			return {
				safe: false,
				reason: `${baseName} allows max ${profile.maxPositional} positional args, got ${positionals.length}`,
			};
		}
	}

	// Pipe chains: check each segment
	if (command.includes("|")) {
		const segments = command.split("|").map((s) => s.trim());
		for (const segment of segments) {
			if (!segment) continue;
			const subResult = checkSafeBin(segment, userSafeBins);
			if (!subResult.safe) return subResult;
		}
		return { safe: true };
	}

	return { safe: true };
}
