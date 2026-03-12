import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServerConfig } from "../config/schema";

export interface McpToolInfo {
	name: string;
	description?: string;
	inputSchema: Record<string, unknown>;
}

interface McpConnection {
	name: string;
	client: Client;
	transport: StdioClientTransport | StreamableHTTPClientTransport;
	status: "connecting" | "connected" | "error" | "closed";
	tools: McpToolInfo[];
	config: McpServerConfig;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

export class McpClientManager {
	private connections = new Map<string, McpConnection>();

	/** Start all MCP servers from config. */
	async startAll(servers: Record<string, McpServerConfig>): Promise<void> {
		const tasks: Promise<void>[] = [];
		for (const [name, config] of Object.entries(servers)) {
			if (!config.enabled) continue;
			tasks.push(this.start(name, config));
		}
		await Promise.allSettled(tasks);
	}

	/** Start a single MCP server connection. */
	async start(name: string, config: McpServerConfig): Promise<void> {
		// Stop existing connection if any
		if (this.connections.has(name)) {
			await this.stop(name);
		}

		const client = new Client({ name: `yanclaw-${name}`, version: "1.0.0" });
		let transport: StdioClientTransport | StreamableHTTPClientTransport;

		if (config.command) {
			// stdio mode
			transport = new StdioClientTransport({
				command: config.command,
				args: config.args ?? [],
				env: {
					...process.env,
					...(config.env ?? {}),
				} as Record<string, string>,
			});
		} else if (config.url) {
			// HTTP mode (Streamable HTTP)
			transport = new StreamableHTTPClientTransport(new URL(config.url), {
				requestInit: {
					headers: config.headers ?? {},
				},
			});
		} else {
			console.warn(`[mcp] Server "${name}": no command or url configured, skipping`);
			return;
		}

		const conn: McpConnection = {
			name,
			client,
			transport,
			status: "connecting",
			tools: [],
			config,
		};
		this.connections.set(name, conn);

		// Connect with retries
		let lastError: unknown;
		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			try {
				await client.connect(transport);
				conn.status = "connected";

				// Fetch initial tool list
				conn.tools = await this.fetchTools(client);
				console.log(`[mcp] Server "${name}" connected (${conn.tools.length} tools)`);

				// Listen for tools/list_changed notification to refresh
				client.setNotificationHandler({ method: "notifications/tools/list_changed" }, async () => {
					try {
						conn.tools = await this.fetchTools(client);
						console.log(`[mcp] Server "${name}" tools refreshed (${conn.tools.length} tools)`);
					} catch (err) {
						console.warn(`[mcp] Failed to refresh tools for "${name}":`, err);
					}
				});

				return;
			} catch (err) {
				lastError = err;
				if (attempt < MAX_RETRIES - 1) {
					const delay = RETRY_BASE_MS * 2 ** attempt;
					console.warn(
						`[mcp] Server "${name}" connect attempt ${attempt + 1} failed, retrying in ${delay}ms`,
					);
					await new Promise((r) => setTimeout(r, delay));

					// Recreate transport for stdio (process may have died)
					if (config.command) {
						transport = new StdioClientTransport({
							command: config.command,
							args: config.args ?? [],
							env: {
								...process.env,
								...(config.env ?? {}),
							} as Record<string, string>,
						});
						conn.transport = transport;
					}
				}
			}
		}

		conn.status = "error";
		console.error(`[mcp] Server "${name}" failed after ${MAX_RETRIES} attempts:`, lastError);
	}

	/** Stop a single MCP server connection. */
	async stop(name: string): Promise<void> {
		const conn = this.connections.get(name);
		if (!conn) return;

		try {
			await conn.client.close();
		} catch {
			// Ignore close errors
		}
		conn.status = "closed";
		this.connections.delete(name);
	}

	/** Stop all MCP server connections. */
	async stopAll(): Promise<void> {
		const tasks = [...this.connections.keys()].map((n) => this.stop(n));
		await Promise.allSettled(tasks);
	}

	/** Get names of all connected servers. */
	getConnectedServers(): string[] {
		return [...this.connections.entries()]
			.filter(([, c]) => c.status === "connected")
			.map(([name]) => name);
	}

	/** Get cached tools for a server. */
	getTools(name: string): McpToolInfo[] {
		return this.connections.get(name)?.tools ?? [];
	}

	/** List tools for a server (uses cache). */
	async listTools(name: string): Promise<McpToolInfo[]> {
		const conn = this.connections.get(name);
		if (!conn || conn.status !== "connected") return [];
		return conn.tools;
	}

	/** Call a tool on a specific MCP server. */
	async callTool(serverName: string, toolName: string, args: unknown): Promise<unknown> {
		const conn = this.connections.get(serverName);
		if (!conn || conn.status !== "connected") {
			throw new Error(`MCP server "${serverName}" is not connected`);
		}

		const result = await conn.client.callTool({
			name: toolName,
			arguments: args as Record<string, unknown>,
		});

		// Extract text content from MCP result
		if (result.content && Array.isArray(result.content)) {
			const texts = result.content
				.filter((c: { type: string }) => c.type === "text")
				.map((c: { text: string }) => c.text);
			if (texts.length === 1) return texts[0];
			if (texts.length > 1) return texts.join("\n");
		}

		return result;
	}

	/** Get status of all connections. */
	getStatus(): Record<string, { status: string; toolCount: number }> {
		const result: Record<string, { status: string; toolCount: number }> = {};
		for (const [name, conn] of this.connections) {
			result[name] = { status: conn.status, toolCount: conn.tools.length };
		}
		return result;
	}

	/**
	 * Hot-reload: diff new config against current, restart changed servers.
	 */
	async reload(servers: Record<string, McpServerConfig>): Promise<void> {
		const currentNames = new Set(this.connections.keys());
		const newNames = new Set(Object.keys(servers));

		// Stop removed servers
		for (const name of currentNames) {
			if (!newNames.has(name)) {
				console.log(`[mcp] Removing server "${name}"`);
				await this.stop(name);
			}
		}

		// Start or restart changed servers
		for (const [name, config] of Object.entries(servers)) {
			if (!config.enabled) {
				if (currentNames.has(name)) await this.stop(name);
				continue;
			}

			const existing = this.connections.get(name);
			if (existing && this.configEqual(existing.config, config)) {
				continue; // No change
			}

			console.log(`[mcp] ${existing ? "Restarting" : "Starting"} server "${name}"`);
			await this.start(name, config);
		}
	}

	private async fetchTools(client: Client): Promise<McpToolInfo[]> {
		const result = await client.listTools();
		return result.tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema as Record<string, unknown>,
		}));
	}

	private configEqual(a: McpServerConfig, b: McpServerConfig): boolean {
		return JSON.stringify(a) === JSON.stringify(b);
	}
}
