/**
 * Scans LLM output for potential credential leaks.
 * Registers known credential patterns and checks output text against them.
 */
export class LeakDetector {
	private patterns: string[] = [];

	/** Minimum credential length to register (shorter values are likely not secrets). */
	private static readonly MIN_LENGTH = 8;
	/** Max prefix length used for matching. */
	private static readonly PREFIX_LENGTH = 16;

	/** Register a credential for leak detection. */
	register(credential: string): void {
		if (credential.length < LeakDetector.MIN_LENGTH) return;
		const prefix = credential.substring(0, Math.min(credential.length, LeakDetector.PREFIX_LENGTH));
		if (!this.patterns.includes(prefix)) {
			this.patterns.push(prefix);
		}
	}

	/** Register all API keys from a config object. */
	registerFromConfig(config: {
		models: {
			providers: Record<string, { profiles: { apiKey: string }[] }>;
		};
	}): void {
		for (const provider of Object.values(config.models.providers)) {
			for (const profile of provider.profiles) {
				if (profile.apiKey) {
					this.register(profile.apiKey);
				}
			}
		}
	}

	/** Scan text for potential credential leaks. */
	scan(text: string): { leaked: boolean; patternIndex: number } {
		for (let i = 0; i < this.patterns.length; i++) {
			if (text.includes(this.patterns[i])) {
				return { leaked: true, patternIndex: i };
			}
		}
		return { leaked: false, patternIndex: -1 };
	}

	/** Number of registered patterns. */
	get size(): number {
		return this.patterns.length;
	}
}
