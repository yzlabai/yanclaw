#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

// ── Flags & Routing ────────────────────────────────────────────────

interface Flags {
	[key: string]: string | boolean;
}

interface Parsed {
	positional: string[];
	flags: Flags;
}

function parseArgs(argv: string[]): Parsed {
	const positional: string[] = [];
	const flags: Flags = {};
	let i = 0;
	while (i < argv.length) {
		const arg = argv[i];
		if (arg === "--") {
			positional.push(...argv.slice(i + 1));
			break;
		}
		if (arg.startsWith("--")) {
			const key = arg.slice(2);
			const next = argv[i + 1];
			if (next && !next.startsWith("-")) {
				flags[key] = next;
				i += 2;
			} else {
				flags[key] = true;
				i++;
			}
		} else if (arg.startsWith("-") && arg.length === 2) {
			const key = arg.slice(1);
			const next = argv[i + 1];
			if (next && !next.startsWith("-")) {
				flags[key] = next;
				i += 2;
			} else {
				flags[key] = true;
				i++;
			}
		} else {
			positional.push(arg);
			i++;
		}
	}
	return { positional, flags };
}

function flag(flags: Flags, long: string, short?: string): string | boolean | undefined {
	return flags[long] ?? (short ? flags[short] : undefined);
}

function flagStr(flags: Flags, long: string, short?: string, def?: string): string {
	const v = flag(flags, long, short);
	if (typeof v === "string") return v;
	return def ?? "";
}

function flagBool(flags: Flags, long: string, short?: string): boolean {
	return !!flag(flags, long, short);
}

// ── API Client ─────────────────────────────────────────────────────

let apiBase = process.env.YANCLAW_API ?? "http://localhost:18789";

function getAuthHeaders(): Record<string, string> {
	try {
		const token = readFileSync(join(homedir(), ".yanclaw", "auth.token"), "utf-8").trim();
		if (token) return { Authorization: `Bearer ${token}` };
	} catch {
		// No token file
	}
	return {};
}

function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	const headers: Record<string, string> = {
		...getAuthHeaders(),
		...(init?.headers as Record<string, string>),
	};
	return fetch(`${apiBase}${path}`, { ...init, headers });
}

async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
	const res = await apiFetch(path, init);
	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`HTTP ${res.status}: ${body}`);
	}
	return res.json() as Promise<T>;
}

// ── Helpers ────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

function die(msg: string): never {
	console.error(msg);
	process.exit(1);
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max)}...`;
}

function table(rows: string[][], colPad = 2): string {
	if (rows.length === 0) return "";
	const widths: number[] = [];
	for (const row of rows) {
		for (let i = 0; i < row.length; i++) {
			widths[i] = Math.max(widths[i] ?? 0, row[i].length);
		}
	}
	return rows
		.map((row) => row.map((cell, i) => cell.padEnd(widths[i] + colPad)).join(""))
		.join("\n");
}

// ── Gateway Lifecycle ──────────────────────────────────────────────

async function cmdServe() {
	await import("./index");
}

async function cmdStart() {
	try {
		const res = await apiFetch("/api/system/status");
		if (res.ok) {
			console.log("Gateway is already running.");
			return;
		}
	} catch {
		// Not running
	}

	const entryPath = new URL("./index.ts", import.meta.url).pathname;
	const child = Bun.spawn(["bun", "run", entryPath], {
		stdio: ["ignore", "ignore", "ignore"],
	});
	child.unref();
	console.log(`Gateway started (PID: ${child.pid})`);
}

async function cmdStop() {
	try {
		const res = await apiFetch("/api/system/shutdown", { method: "POST" });
		if (res.ok) {
			console.log("Gateway is shutting down...");
		} else {
			console.error(`Shutdown request failed (HTTP ${res.status})`);
		}
	} catch {
		die("Gateway is not running or unreachable.");
	}
}

async function cmdRestart() {
	try {
		await apiFetch("/api/system/shutdown", { method: "POST" });
		console.log("Stopping gateway...");
		for (let i = 0; i < 25; i++) {
			await Bun.sleep(200);
			try {
				await apiFetch("/api/system/health");
			} catch {
				break;
			}
		}
	} catch {
		// Already stopped
	}
	await cmdStart();
}

interface StatusResponse {
	name: string;
	version: string;
	status: string;
	uptime: number;
	pid: number;
	port: number;
	agents: Array<{ id: string; name: string; model: string }>;
	channels: Record<string, { status: string; accounts: number }>;
	sessions: { active: number };
	memory: { enabled: boolean; entries: number };
	cron: { tasks: number };
}

async function cmdStatus(_args: string[], flags: Flags) {
	if (flagBool(flags, "json")) {
		try {
			const data = await apiJson("/api/system/status");
			console.log(JSON.stringify(data, null, 2));
		} catch {
			console.log(JSON.stringify({ status: "not_running" }));
			process.exit(1);
		}
		return;
	}

	try {
		const data = await apiJson<StatusResponse>("/api/system/status");

		console.log(`${data.name} v${data.version}`);
		console.log(`Status:   Running`);
		console.log(`Uptime:   ${formatUptime(data.uptime)}`);
		console.log(`Port:     ${data.port}`);
		console.log(`PID:      ${data.pid}`);
		console.log();

		const channelEntries = Object.entries(data.channels);
		if (channelEntries.length > 0) {
			console.log("Channels:");
			for (const [name, ch] of channelEntries) {
				const icon = ch.status === "connected" ? "+" : "-";
				const status = ch.status === "connected" ? "Connected" : "Disconnected";
				console.log(`  ${name.padEnd(12)} ${status} ${icon}   (${ch.accounts} accounts)`);
			}
			console.log();
		}

		if (data.agents.length > 0) {
			console.log("Agents:");
			for (const a of data.agents) {
				console.log(`  ${a.id.padEnd(12)} ${a.model}`);
			}
			console.log();
		}

		console.log(`Sessions: ${data.sessions.active}`);
		if (data.memory.enabled) {
			console.log(`Memory:   Enabled (${data.memory.entries.toLocaleString()} entries)`);
		}
		if (data.cron.tasks > 0) {
			console.log(`Cron:     ${data.cron.tasks} task(s)`);
		}
	} catch {
		console.log("YanClaw Gateway");
		console.log("Status:   Not Running");
		process.exit(1);
	}
}

// ── Chat ───────────────────────────────────────────────────────────

interface AgentEvent {
	type: string;
	sessionKey?: string;
	text?: string;
	name?: string;
	args?: unknown;
	result?: unknown;
	duration?: number;
	message?: string;
	usage?: { promptTokens: number; completionTokens: number };
	memories?: Array<{ snippet: string }>;
}

async function streamChat(
	agentId: string,
	sessionKey: string,
	message: string,
	opts: { preference?: string; showTools: boolean },
): Promise<void> {
	const body = {
		agentId,
		sessionKey,
		message,
		...(opts.preference && opts.preference !== "default" ? { preference: opts.preference } : {}),
	};

	const res = await apiFetch("/api/chat/send", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const text = await res.text().catch(() => "");
		die(`Chat failed (HTTP ${res.status}): ${text}`);
	}

	if (!res.body) die("No response body");

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let hasOutput = false;

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.trim()) continue;
			let event: AgentEvent;
			try {
				event = JSON.parse(line);
			} catch {
				continue;
			}

			switch (event.type) {
				case "delta":
					process.stdout.write(event.text ?? "");
					hasOutput = true;
					break;

				case "thinking":
					// Skip thinking output in CLI for cleaner experience
					break;

				case "tool_call":
					if (opts.showTools) {
						if (hasOutput) process.stdout.write("\n");
						const argsStr = event.args ? truncate(JSON.stringify(event.args), 120) : "";
						console.log(`\x1b[36m⚙ ${event.name}(${argsStr})\x1b[0m`);
						hasOutput = false;
					}
					break;

				case "tool_result":
					if (opts.showTools) {
						const resultStr = event.result ? truncate(JSON.stringify(event.result), 200) : "";
						console.log(`\x1b[2m  → ${resultStr}\x1b[0m`);
					}
					break;

				case "done":
					if (hasOutput) process.stdout.write("\n");
					if (event.usage) {
						console.log(
							`\x1b[2m[tokens: ${event.usage.promptTokens}→${event.usage.completionTokens}]\x1b[0m`,
						);
					}
					hasOutput = false;
					break;

				case "error":
					if (hasOutput) process.stdout.write("\n");
					console.error(`\x1b[31mError: ${event.message}\x1b[0m`);
					hasOutput = false;
					break;

				case "recall":
					if (event.memories && event.memories.length > 0) {
						console.log(`\x1b[2m📎 recalled ${event.memories.length} memories\x1b[0m`);
					}
					break;

				case "aborted":
					if (hasOutput) process.stdout.write("\n");
					console.log("\x1b[33m[aborted]\x1b[0m");
					hasOutput = false;
					break;
			}
		}
	}

	// Flush any remaining output
	if (hasOutput) process.stdout.write("\n");
}

async function cmdChat(args: string[], flags: Flags) {
	const interactive = flagBool(flags, "interactive", "i");
	const agentId = flagStr(flags, "agent", "a", "main");
	const sessionKey = flagStr(flags, "session", "s", `agent:${agentId}:cli`);
	const preference = flagStr(flags, "preference", "p", "default");
	const showTools = !flagBool(flags, "no-tools");

	// Read stdin if piped
	let stdinContent = "";
	if (!process.stdin.isTTY && !interactive) {
		const chunks: Buffer[] = [];
		for await (const chunk of process.stdin) {
			chunks.push(chunk as Buffer);
		}
		stdinContent = Buffer.concat(chunks).toString("utf-8").trim();
	}

	if (interactive) {
		await chatRepl(agentId, sessionKey, preference, showTools);
		return;
	}

	// One-shot mode
	let message = args.join(" ").trim();
	if (stdinContent) {
		message = message ? `${message}\n\n---\n${stdinContent}` : stdinContent;
	}

	if (!message) {
		die("No message provided. Usage: yanclaw chat <message>\nOr use -i for interactive mode.");
	}

	await streamChat(agentId, sessionKey, message, { preference, showTools });
}

async function chatRepl(
	agentId: string,
	sessionKey: string,
	preference: string,
	showTools: boolean,
) {
	console.log(`YanClaw CLI — Agent: ${agentId} — Session: ${sessionKey}`);
	console.log("Type /help for commands, /exit to quit.\n");

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	let currentAgent = agentId;
	let currentSession = sessionKey;

	while (true) {
		let input: string;
		try {
			input = await rl.question("> ");
		} catch {
			// EOF or ctrl-D
			break;
		}

		const trimmed = input.trim();
		if (!trimmed) continue;

		// REPL commands
		if (trimmed.startsWith("/")) {
			const parts = trimmed.split(/\s+/);
			const cmd = parts[0].toLowerCase();

			switch (cmd) {
				case "/exit":
				case "/quit":
					rl.close();
					return;

				case "/clear":
					try {
						await apiFetch(`/api/sessions/${encodeURIComponent(currentSession)}`, {
							method: "DELETE",
						});
						currentSession = `agent:${currentAgent}:cli-${Date.now()}`;
						console.log(`Session cleared. New session: ${currentSession}`);
					} catch {
						console.log("Failed to clear session.");
					}
					continue;

				case "/agent":
					if (parts[1]) {
						currentAgent = parts[1];
						currentSession = `agent:${currentAgent}:cli`;
						console.log(`Switched to agent: ${currentAgent}`);
					} else {
						console.log(`Current agent: ${currentAgent}`);
					}
					continue;

				case "/session":
					if (parts[1]) {
						currentSession = parts[1];
						console.log(`Switched to session: ${currentSession}`);
					} else {
						console.log(`Current session: ${currentSession}`);
					}
					continue;

				case "/cancel":
					try {
						await apiFetch("/api/chat/cancel", {
							method: "POST",
							headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ sessionKey: currentSession }),
						});
						console.log("Cancelled.");
					} catch {
						console.log("Nothing to cancel.");
					}
					continue;

				case "/help":
					console.log(`REPL commands:
  /exit, /quit     Exit the REPL
  /clear           Clear current session and start fresh
  /agent [id]      Show or switch agent
  /session [key]   Show or switch session
  /cancel          Cancel current agent run
  /help            Show this help`);
					continue;

				default:
					console.log(`Unknown command: ${cmd}. Type /help for available commands.`);
					continue;
			}
		}

		// Send message
		try {
			await streamChat(currentAgent, currentSession, trimmed, { preference, showTools });
		} catch (e) {
			console.error(`\x1b[31m${e instanceof Error ? e.message : "Request failed"}\x1b[0m`);
		}
		console.log();
	}

	rl.close();
}

// ── Agents ─────────────────────────────────────────────────────────

interface Agent {
	id: string;
	name: string;
	model: string;
	systemPrompt?: string;
	runtime?: string;
	taskEnabled?: boolean;
	workspaceDir?: string;
	preference?: string;
	tools?: { allow?: string[]; deny?: string[] };
	capabilities?: string[] | string;
}

async function cmdAgentsList(_args: string[], flags: Flags) {
	const agents = await apiJson<Agent[]>("/api/agents");

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(agents, null, 2));
		return;
	}

	if (agents.length === 0) {
		console.log("No agents configured.");
		return;
	}

	const rows = [["ID", "NAME", "MODEL", "RUNTIME"]];
	for (const a of agents) {
		rows.push([a.id, a.name, a.model, a.runtime ?? "default"]);
	}
	console.log(table(rows));
}

async function cmdAgentsShow(args: string[], flags: Flags) {
	const id = args[0];
	if (!id) die("Usage: yanclaw agents show <id>");

	const agent = await apiJson<Agent>(`/api/agents/${encodeURIComponent(id)}`);

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(agent, null, 2));
		return;
	}

	console.log(`ID:         ${agent.id}`);
	console.log(`Name:       ${agent.name}`);
	console.log(`Model:      ${agent.model}`);
	console.log(`Runtime:    ${agent.runtime ?? "default"}`);
	console.log(`Preference: ${agent.preference ?? "default"}`);
	if (agent.workspaceDir) console.log(`WorkDir:    ${agent.workspaceDir}`);
	if (agent.taskEnabled) console.log(`Task Loop:  Enabled`);
	if (agent.capabilities) {
		const caps = Array.isArray(agent.capabilities)
			? agent.capabilities.join(", ")
			: agent.capabilities;
		console.log(`Caps:       ${caps}`);
	}
	if (agent.systemPrompt) {
		console.log(`\nSystem Prompt:\n${truncate(agent.systemPrompt, 500)}`);
	}
}

async function cmdAgentsCreate(_args: string[], flags: Flags) {
	const id = flagStr(flags, "id");
	const name = flagStr(flags, "name");
	if (!id || !name) die("Usage: yanclaw agents create --id <id> --name <name> [--model <model>]");

	const body: Record<string, string> = { id, name };
	const model = flagStr(flags, "model");
	if (model) body.model = model;
	const prompt = flagStr(flags, "prompt");
	if (prompt) body.systemPrompt = prompt;

	const agent = await apiJson<Agent>("/api/agents", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	console.log(`Agent created: ${agent.id}`);
}

async function cmdAgentsDelete(args: string[]) {
	const id = args[0];
	if (!id) die("Usage: yanclaw agents delete <id>");

	await apiJson(`/api/agents/${encodeURIComponent(id)}`, { method: "DELETE" });
	console.log(`Agent deleted: ${id}`);
}

// ── Channels ───────────────────────────────────────────────────────

interface ChannelInfo {
	type: string;
	accountId: string;
	enabled: boolean;
	status: string;
}

async function cmdChannelsList(_args: string[], flags: Flags) {
	const channels = await apiJson<ChannelInfo[]>("/api/channels");

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(channels, null, 2));
		return;
	}

	if (channels.length === 0) {
		console.log("No channels configured.");
		return;
	}

	const rows = [["TYPE", "ACCOUNT", "STATUS", "ENABLED"]];
	for (const ch of channels) {
		const statusIcon = ch.status === "connected" ? "\x1b[32m●\x1b[0m" : "\x1b[31m●\x1b[0m";
		rows.push([ch.type, ch.accountId, `${statusIcon} ${ch.status}`, ch.enabled ? "yes" : "no"]);
	}
	console.log(table(rows));
}

async function cmdChannelsConnect(args: string[]) {
	const [type, accountId] = args;
	if (!type || !accountId) die("Usage: yanclaw channels connect <type> <accountId>");

	await apiJson(
		`/api/channels/${encodeURIComponent(type)}/${encodeURIComponent(accountId)}/connect`,
		{
			method: "POST",
		},
	);
	console.log(`Channel ${type}/${accountId} connecting...`);
}

async function cmdChannelsDisconnect(args: string[]) {
	const [type, accountId] = args;
	if (!type || !accountId) die("Usage: yanclaw channels disconnect <type> <accountId>");

	await apiJson(
		`/api/channels/${encodeURIComponent(type)}/${encodeURIComponent(accountId)}/disconnect`,
		{
			method: "POST",
		},
	);
	console.log(`Channel ${type}/${accountId} disconnected.`);
}

// ── Sessions ───────────────────────────────────────────────────────

interface SessionInfo {
	key: string;
	agentId: string;
	title?: string;
	channel?: string;
	messageCount: number;
	tokenCount?: number;
	updatedAt: number;
}

async function cmdSessionsList(_args: string[], flags: Flags) {
	const agentId = flagStr(flags, "agent", "a");
	const limit = flagStr(flags, "limit", "n", "20");
	const params = new URLSearchParams({ limit });
	if (agentId) params.set("agentId", agentId);

	const data = await apiJson<{ sessions: SessionInfo[]; total: number }>(`/api/sessions?${params}`);

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(data, null, 2));
		return;
	}

	if (data.sessions.length === 0) {
		console.log("No sessions.");
		return;
	}

	const rows = [["KEY", "AGENT", "TITLE", "MSGS", "UPDATED"]];
	for (const s of data.sessions) {
		const updated = new Date(s.updatedAt).toLocaleString();
		rows.push([
			truncate(s.key, 40),
			s.agentId,
			truncate(s.title ?? "-", 30),
			String(s.messageCount),
			updated,
		]);
	}
	console.log(table(rows));
	if (data.total > data.sessions.length) {
		console.log(`\n(${data.total} total, showing ${data.sessions.length})`);
	}
}

async function cmdSessionsShow(args: string[], flags: Flags) {
	const key = args[0];
	if (!key) die("Usage: yanclaw sessions show <key>");

	const data = await apiJson<{
		key: string;
		agentId: string;
		title?: string;
		messageCount: number;
		messages: Array<{ role: string; content: string; createdAt: number }>;
	}>(`/api/sessions/${encodeURIComponent(key)}`);

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(data, null, 2));
		return;
	}

	console.log(`Session: ${data.key}`);
	console.log(`Agent:   ${data.agentId}`);
	if (data.title) console.log(`Title:   ${data.title}`);
	console.log(`Messages: ${data.messageCount}\n`);

	for (const msg of data.messages) {
		const role = msg.role === "user" ? "\x1b[34mUser\x1b[0m" : "\x1b[32mAssistant\x1b[0m";
		const time = new Date(msg.createdAt).toLocaleTimeString();
		console.log(`[${time}] ${role}:`);
		console.log(truncate(msg.content, 500));
		console.log();
	}
}

async function cmdSessionsExport(args: string[], flags: Flags) {
	const key = args[0];
	if (!key) die("Usage: yanclaw sessions export <key> [--format json|md]");

	const format = flagStr(flags, "format", "f", "json");
	const res = await apiFetch(`/api/sessions/${encodeURIComponent(key)}/export?format=${format}`);
	if (!res.ok) die(`Export failed (HTTP ${res.status})`);
	const text = await res.text();
	console.log(text);
}

async function cmdSessionsDelete(args: string[]) {
	const key = args[0];
	if (!key) die("Usage: yanclaw sessions delete <key>");

	await apiJson(`/api/sessions/${encodeURIComponent(key)}`, { method: "DELETE" });
	console.log(`Session deleted: ${key}`);
}

// ── Config ─────────────────────────────────────────────────────────

async function cmdConfigShow(_args: string[], flags: Flags) {
	const config = await apiJson("/api/config");

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(config, null, 2));
		return;
	}

	console.log(JSON.stringify(config, null, 2));
}

async function cmdConfigGet(args: string[]) {
	const path = args[0];
	if (!path) die("Usage: yanclaw config get <path>  (e.g. gateway.port)");

	const config = await apiJson<Record<string, unknown>>("/api/config");
	const parts = path.split(".");
	let current: unknown = config;
	for (const part of parts) {
		if (current && typeof current === "object" && part in (current as Record<string, unknown>)) {
			current = (current as Record<string, unknown>)[part];
		} else {
			die(`Path not found: ${path}`);
		}
	}
	console.log(typeof current === "object" ? JSON.stringify(current, null, 2) : String(current));
}

async function cmdConfigSet(args: string[]) {
	const [path, ...valueParts] = args;
	if (!path || valueParts.length === 0) die("Usage: yanclaw config set <path> <value>");

	const valueStr = valueParts.join(" ");
	let value: unknown;
	try {
		value = JSON.parse(valueStr);
	} catch {
		value = valueStr;
	}

	// Build nested object from dot path
	const parts = path.split(".");
	const obj: Record<string, unknown> = {};
	let current: Record<string, unknown> = obj;
	for (let i = 0; i < parts.length - 1; i++) {
		const next: Record<string, unknown> = {};
		current[parts[i]] = next;
		current = next;
	}
	current[parts[parts.length - 1]] = value;

	await apiJson("/api/config", {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(obj),
	});
	console.log(`Set ${path} = ${JSON.stringify(value)}`);
}

async function cmdConfigEdit() {
	const configPath = join(homedir(), ".yanclaw", "config.json5");
	const editor = process.env.EDITOR || process.env.VISUAL || "vi";

	const proc = Bun.spawn([editor, configPath], {
		stdio: ["inherit", "inherit", "inherit"],
	});
	await proc.exited;
}

// ── Cron ───────────────────────────────────────────────────────────

interface CronTask {
	id: string;
	agent?: string;
	schedule?: string;
	prompt?: string;
	enabled?: boolean;
	lastRun?: string;
	nextRun?: string;
}

async function cmdCronList(_args: string[], flags: Flags) {
	const tasks = await apiJson<CronTask[]>("/api/cron");

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(tasks, null, 2));
		return;
	}

	if (tasks.length === 0) {
		console.log("No cron tasks.");
		return;
	}

	const rows = [["ID", "AGENT", "SCHEDULE", "ENABLED", "NEXT RUN"]];
	for (const t of tasks) {
		rows.push([
			t.id,
			t.agent ?? "main",
			t.schedule ?? "-",
			t.enabled !== false ? "yes" : "no",
			t.nextRun ? new Date(t.nextRun).toLocaleString() : "-",
		]);
	}
	console.log(table(rows));
}

async function cmdCronRun(args: string[]) {
	const id = args[0];
	if (!id) die("Usage: yanclaw cron run <id>");

	const data = await apiJson<{ result: string }>(`/api/cron/${encodeURIComponent(id)}/run`, {
		method: "POST",
	});
	console.log(data.result);
}

// ── Memory ─────────────────────────────────────────────────────────

async function cmdMemorySearch(args: string[], flags: Flags) {
	const query = args.join(" ").trim();
	if (!query) die("Usage: yanclaw memory search <query>");

	const agentId = flagStr(flags, "agent", "a", "main");
	const limit = flagStr(flags, "limit", "n", "10");
	const params = new URLSearchParams({ q: query, agentId, limit });

	const data = await apiJson<{
		results: Array<{ id: string; content: string; score?: number; tags?: string[] }>;
	}>(`/api/memory/search?${params}`);

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(data, null, 2));
		return;
	}

	if (data.results.length === 0) {
		console.log("No results.");
		return;
	}

	for (const r of data.results) {
		const score = r.score !== undefined ? ` (score: ${r.score.toFixed(3)})` : "";
		const tags = r.tags?.length ? ` [${r.tags.join(", ")}]` : "";
		console.log(`\x1b[2m${r.id}${score}${tags}\x1b[0m`);
		console.log(truncate(r.content, 300));
		console.log();
	}
}

async function cmdMemoryAdd(args: string[], flags: Flags) {
	const content = args.join(" ").trim();
	if (!content) die("Usage: yanclaw memory add <content> [--tags tag1,tag2]");

	const agentId = flagStr(flags, "agent", "a", "main");
	const tagsStr = flagStr(flags, "tags", "t");
	const tags = tagsStr ? tagsStr.split(",").map((t) => t.trim()) : undefined;

	const data = await apiJson<{ id: string }>("/api/memory", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ agentId, content, tags }),
	});
	console.log(`Memory stored: ${data.id}`);
}

async function cmdMemoryDelete(args: string[]) {
	const id = args[0];
	if (!id) die("Usage: yanclaw memory delete <id>");

	await apiJson(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
	console.log(`Memory deleted: ${id}`);
}

async function cmdMemoryStats(_args: string[], flags: Flags) {
	const agentId = flagStr(flags, "agent", "a");
	const params = agentId ? `?agentId=${agentId}` : "";
	const data = await apiJson<{
		total: number;
		byAgent: Record<string, number>;
		topTags: Array<{ tag: string; count: number }>;
	}>(`/api/memory/stats${params}`);

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(data, null, 2));
		return;
	}

	console.log(`Total memories: ${data.total}`);
	const agentEntries = Object.entries(data.byAgent);
	if (agentEntries.length > 0) {
		console.log("\nBy agent:");
		for (const [agent, count] of agentEntries) {
			console.log(`  ${agent.padEnd(12)} ${count}`);
		}
	}
	if (data.topTags?.length > 0) {
		console.log("\nTop tags:");
		for (const t of data.topTags.slice(0, 10)) {
			console.log(`  ${t.tag.padEnd(20)} ${t.count}`);
		}
	}
}

// ── Plugins ────────────────────────────────────────────────────────

async function cmdPluginsList(_args: string[], flags: Flags) {
	const plugins =
		await apiJson<
			Array<{
				id: string;
				name: string;
				version: string;
				tools: Array<{ name: string }>;
				hasHooks: boolean;
			}>
		>("/api/plugins");

	if (flagBool(flags, "json")) {
		console.log(JSON.stringify(plugins, null, 2));
		return;
	}

	if (plugins.length === 0) {
		console.log("No plugins loaded.");
		return;
	}

	const rows = [["ID", "NAME", "VERSION", "TOOLS", "HOOKS"]];
	for (const p of plugins) {
		rows.push([
			p.id,
			p.name,
			p.version,
			p.tools.map((t) => t.name).join(", ") || "-",
			p.hasHooks ? "yes" : "no",
		]);
	}
	console.log(table(rows));
}

// ── Command Router ─────────────────────────────────────────────────

interface Cmd {
	desc: string;
	usage?: string;
	run: (args: string[], flags: Flags) => Promise<void> | void;
}

type CmdGroup = Record<string, Cmd>;

const subcommands: Record<string, CmdGroup> = {
	agents: {
		list: { desc: "List all agents", run: cmdAgentsList },
		show: { desc: "Show agent details", usage: "<id>", run: cmdAgentsShow },
		create: {
			desc: "Create an agent",
			usage: "--id <id> --name <name> [--model <model>]",
			run: cmdAgentsCreate,
		},
		delete: { desc: "Delete an agent", usage: "<id>", run: cmdAgentsDelete },
	},
	channels: {
		list: { desc: "List channels and status", run: cmdChannelsList },
		connect: { desc: "Connect a channel", usage: "<type> <accountId>", run: cmdChannelsConnect },
		disconnect: {
			desc: "Disconnect a channel",
			usage: "<type> <accountId>",
			run: cmdChannelsDisconnect,
		},
	},
	sessions: {
		list: { desc: "List sessions", usage: "[--agent <id>] [--limit <n>]", run: cmdSessionsList },
		show: { desc: "Show session messages", usage: "<key>", run: cmdSessionsShow },
		export: { desc: "Export session", usage: "<key> [--format json|md]", run: cmdSessionsExport },
		delete: { desc: "Delete a session", usage: "<key>", run: cmdSessionsDelete },
	},
	config: {
		show: { desc: "Show full config", run: cmdConfigShow },
		get: { desc: "Get config value", usage: "<path>", run: cmdConfigGet },
		set: { desc: "Set config value", usage: "<path> <value>", run: cmdConfigSet },
		edit: { desc: "Open config in $EDITOR", run: cmdConfigEdit },
	},
	cron: {
		list: { desc: "List cron tasks", run: cmdCronList },
		run: { desc: "Run a task immediately", usage: "<id>", run: cmdCronRun },
	},
	memory: {
		search: { desc: "Search memories", usage: "<query> [--agent <id>]", run: cmdMemorySearch },
		add: { desc: "Store a memory", usage: "<content> [--tags t1,t2]", run: cmdMemoryAdd },
		delete: { desc: "Delete a memory", usage: "<id>", run: cmdMemoryDelete },
		stats: { desc: "Show memory statistics", run: cmdMemoryStats },
	},
	plugins: {
		list: { desc: "List loaded plugins", run: cmdPluginsList },
	},
};

const topCommands: Record<string, Cmd> = {
	serve: { desc: "Start Gateway in foreground", run: cmdServe },
	start: { desc: "Start Gateway in background", run: cmdStart },
	stop: { desc: "Gracefully stop Gateway", run: cmdStop },
	restart: { desc: "Restart Gateway", run: cmdRestart },
	status: { desc: "Show running status", run: cmdStatus },
	chat: {
		desc: "Chat with an agent",
		usage: "[message] [-i] [--agent <id>] [--session <key>]",
		run: cmdChat,
	},
};

function showHelp() {
	const lines = [
		"Usage: yanclaw <command> [subcommand] [options]",
		"",
		"Gateway:",
		"  serve              Start Gateway in foreground",
		"  start              Start Gateway in background",
		"  stop               Gracefully stop Gateway",
		"  restart            Restart Gateway",
		"  status             Show running status",
		"",
		"Chat:",
		"  chat [message]     Send a message (or -i for interactive)",
		"",
		"Management:",
	];

	for (const [group, cmds] of Object.entries(subcommands)) {
		const subcmdNames = Object.keys(cmds).join("|");
		lines.push(`  ${group.padEnd(12)} ${subcmdNames}`);
	}

	lines.push(
		"",
		"Global options:",
		"  --json             Output as JSON",
		"  --api <url>        Override API base URL",
		"  -h, --help         Show help",
		"",
		"Environment:",
		`  YANCLAW_API        API base URL (default: http://localhost:18789)`,
	);

	console.log(lines.join("\n"));
}

function showGroupHelp(group: string, cmds: CmdGroup) {
	console.log(`Usage: yanclaw ${group} <subcommand> [options]\n`);
	console.log("Subcommands:");
	for (const [name, cmd] of Object.entries(cmds)) {
		const usage = cmd.usage ? ` ${cmd.usage}` : "";
		console.log(`  ${(name + usage).padEnd(40)} ${cmd.desc}`);
	}
}

// ── Main ───────────────────────────────────────────────────────────

const rawArgs = process.argv.slice(2);
const { positional, flags: globalFlags } = parseArgs(rawArgs);

// Apply global flags
if (globalFlags.api) apiBase = String(globalFlags.api);

const cmd = positional[0] ?? "help";

if (cmd === "help" || flagBool(globalFlags, "help", "h")) {
	if (positional[1] && subcommands[positional[1]]) {
		showGroupHelp(positional[1], subcommands[positional[1]]);
	} else {
		showHelp();
	}
	process.exit(0);
}

// Top-level command?
if (topCommands[cmd]) {
	await topCommands[cmd].run(positional.slice(1), globalFlags);
	process.exit(0);
}

// Subcommand group?
if (subcommands[cmd]) {
	const group = subcommands[cmd];
	const sub = positional[1] ?? "list";

	if (sub === "help" || (flagBool(globalFlags, "help", "h") && !positional[1])) {
		showGroupHelp(cmd, group);
		process.exit(0);
	}

	const handler = group[sub];
	if (!handler) {
		console.error(`Unknown subcommand: ${cmd} ${sub}`);
		showGroupHelp(cmd, group);
		process.exit(1);
	}

	try {
		await handler.run(positional.slice(2), globalFlags);
	} catch (e) {
		die(e instanceof Error ? e.message : String(e));
	}
	process.exit(0);
}

console.error(`Unknown command: ${cmd}\nRun 'yanclaw help' for usage.`);
process.exit(1);
