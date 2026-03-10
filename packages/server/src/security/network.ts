const PRIVATE_RANGES = [
	/^127\./,
	/^10\./,
	/^172\.(1[6-9]|2\d|3[01])\./,
	/^192\.168\./,
	/^0\.0\.0\.0$/,
	/^localhost$/i,
	/^\[::1\]$/,
];

export interface NetworkConfig {
	allowedHosts?: string[];
	blockPrivate?: boolean;
	exemptPorts?: number[];
}

/**
 * Validate whether an outbound network request should be allowed.
 * Prevents SSRF and enforces host whitelist.
 */
export function validateNetworkAccess(
	targetUrl: string,
	config: NetworkConfig,
): { allowed: boolean; reason?: string } {
	let parsed: URL;
	try {
		parsed = new URL(targetUrl);
	} catch {
		return { allowed: false, reason: `Invalid URL: ${targetUrl}` };
	}

	const host = parsed.hostname;

	// 1. Block private/internal addresses (SSRF prevention)
	if (config.blockPrivate !== false) {
		if (PRIVATE_RANGES.some((r) => r.test(host))) {
			// Allow exempt ports (e.g., Ollama on localhost:11434, gateway self)
			const port = parsed.port ? Number.parseInt(parsed.port, 10) : 0;
			const exempt = config.exemptPorts ?? [];
			if (!Number.isFinite(port) || port <= 0 || !exempt.includes(port)) {
				return { allowed: false, reason: `Private address blocked: ${host}` };
			}
		}
	}

	// 2. Host whitelist (only enforced when non-empty)
	if (config.allowedHosts && config.allowedHosts.length > 0) {
		const allowed = config.allowedHosts.some((pattern) => {
			if (pattern.startsWith("*.")) {
				return host.endsWith(pattern.slice(1)) || host === pattern.slice(2);
			}
			return host === pattern;
		});
		if (!allowed) {
			return { allowed: false, reason: `Host not in allowlist: ${host}` };
		}
	}

	return { allowed: true };
}
