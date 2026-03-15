import { Worker } from "node:worker_threads";
import { nanoid } from "nanoid";
import { log } from "../logger";
import type { PluginDefinition, PluginToolDef } from "./types";

interface WorkerRequest {
	id: string;
	type: "tool_call";
	toolName: string;
	input: unknown;
}

interface WorkerResponse {
	id: string;
	result?: unknown;
	error?: string;
}

/** Wraps a plugin's tools to run in a Worker thread for isolation. */
export class PluginWorkerHost {
	private worker: Worker | null = null;
	private pending = new Map<
		string,
		{ resolve: (v: unknown) => void; reject: (e: Error) => void }
	>();
	private entryPath: string;
	readonly pluginId: string;

	constructor(entryPath: string, pluginId: string) {
		this.entryPath = entryPath;
		this.pluginId = pluginId;
	}

	/** Start the worker. */
	start(): void {
		if (this.worker) return;

		// Worker script that loads the plugin and handles tool calls
		const workerCode = `
			const { parentPort } = require("node:worker_threads");
			let plugin;

			async function init() {
				const mod = await import(${JSON.stringify(this.entryPath)});
				plugin = mod.default ?? mod;
				parentPort.postMessage({ type: "ready" });
			}

			parentPort.on("message", async (msg) => {
				if (msg.type === "tool_call") {
					try {
						const tool = plugin.tools?.find(t => t.name === msg.toolName);
						if (!tool) {
							parentPort.postMessage({ id: msg.id, error: "Tool not found: " + msg.toolName });
							return;
						}
						const result = await tool.execute(msg.input);
						parentPort.postMessage({ id: msg.id, result });
					} catch (err) {
						parentPort.postMessage({ id: msg.id, error: err?.message ?? String(err) });
					}
				}
			});

			init().catch(err => {
				parentPort.postMessage({ type: "error", error: err.message });
			});
		`;

		this.worker = new Worker(workerCode, { eval: true });

		this.worker.on("message", (msg: WorkerResponse & { type?: string }) => {
			if (msg.type === "ready") {
				log.plugin().info({ pluginId: this.pluginId }, "worker ready");
				return;
			}
			if (msg.type === "error") {
				log
					.plugin()
					.error(
						{ pluginId: this.pluginId, error: (msg as unknown as { error: string }).error },
						"worker init error",
					);
				return;
			}

			const pending = this.pending.get(msg.id);
			if (!pending) return;
			this.pending.delete(msg.id);

			if (msg.error) {
				pending.reject(new Error(msg.error));
			} else {
				pending.resolve(msg.result);
			}
		});

		this.worker.on("error", (err) => {
			log.plugin().error({ err, pluginId: this.pluginId }, "worker error");
			// Reject all pending requests on worker error
			for (const [, p] of this.pending) {
				p.reject(new Error(`Worker error: ${err.message}`));
			}
			this.pending.clear();
		});

		this.worker.on("exit", (code) => {
			if (code !== 0) {
				log
					.plugin()
					.warn({ pluginId: this.pluginId, exitCode: code }, "worker exited with non-zero code");
			}
			this.worker = null;
			// Reject all pending
			for (const [, p] of this.pending) {
				p.reject(new Error("Worker exited"));
			}
			this.pending.clear();
		});
	}

	/** Stop the worker. */
	async stop(): Promise<void> {
		if (this.worker) {
			await this.worker.terminate();
			this.worker = null;
		}
	}

	/** Create isolated tool wrappers that delegate to the worker. */
	createIsolatedTools(originalTools: PluginToolDef[]): PluginToolDef[] {
		return originalTools.map((tool) => ({
			...tool,
			execute: (input: unknown) => this.callTool(tool.name, input),
		}));
	}

	private callTool(toolName: string, input: unknown): Promise<unknown> {
		if (!this.worker) {
			return Promise.reject(new Error("Worker not running"));
		}

		const id = nanoid();
		const request: WorkerRequest = { id, type: "tool_call", toolName, input };

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				log
					.plugin()
					.warn({ pluginId: this.pluginId, toolName }, "worker tool call timed out, terminating");
				this.worker?.terminate();
				reject(new Error("Worker tool call timed out"));
			}, 30_000);

			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timeout);
					resolve(v);
				},
				reject: (e) => {
					clearTimeout(timeout);
					reject(e);
				},
			});

			this.worker?.postMessage(request);
		});
	}
}

/** Wrap a plugin definition with worker isolation for its tools. */
export function isolatePlugin(
	plugin: PluginDefinition,
	entryPath: string,
): { definition: PluginDefinition; host: PluginWorkerHost } {
	const host = new PluginWorkerHost(entryPath, plugin.id);
	host.start();

	const isolatedTools = plugin.tools ? host.createIsolatedTools(plugin.tools) : undefined;

	return {
		definition: {
			...plugin,
			tools: isolatedTools,
		},
		host,
	};
}
