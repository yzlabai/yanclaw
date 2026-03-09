export class ToolInputError extends Error {
	readonly status = 400;
	constructor(message: string) {
		super(message);
		this.name = "ToolInputError";
	}
}

export class ToolAuthorizationError extends Error {
	readonly status = 403;
	constructor(message: string) {
		super(message);
		this.name = "ToolAuthorizationError";
	}
}

export function truncateOutput(output: string, maxBytes: number): string {
	if (Buffer.byteLength(output) <= maxBytes) return output;

	const truncated = Buffer.from(output).subarray(0, maxBytes).toString("utf-8");
	return `${truncated}\n\n[Output truncated at ${maxBytes} bytes]`;
}
