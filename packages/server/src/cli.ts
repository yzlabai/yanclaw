#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const API_BASE = process.env.YANCLAW_API ?? "http://localhost:18789";

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
	const headers = { ...getAuthHeaders(), ...init?.headers };
	return fetch(`${API_BASE}${path}`, { ...init, headers });
}

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}

async function cmdServe() {
	await import("./index");
}

async function cmdStart() {
	// Check if already running
	try {
		const res = await apiFetch("/api/system/status");
		if (res.ok) {
			console.log("Gateway is already running.");
			return;
		}
	} catch {
		// Not running, proceed
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
		console.error("Gateway is not running or unreachable.");
		process.exit(1);
	}
}

async function cmdRestart() {
	try {
		await apiFetch("/api/system/shutdown", { method: "POST" });
		console.log("Stopping gateway...");
		// Wait for it to stop
		for (let i = 0; i < 25; i++) {
			await Bun.sleep(200);
			try {
				await apiFetch("/api/system/health");
			} catch {
				break; // Server is down
			}
		}
	} catch {
		// Already stopped
	}

	// Start again
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

async function cmdStatus() {
	try {
		const res = await apiFetch("/api/system/status");
		if (!res.ok) throw new Error();
		const data = (await res.json()) as StatusResponse;

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

function cmdHelp() {
	console.log(`Usage: yanclaw <command>

Commands:
  serve       Start Gateway in foreground
  start       Start Gateway in background (daemon)
  stop        Gracefully stop Gateway
  restart     Restart Gateway
  status      Show running status
  help        Show this help message

Environment:
  YANCLAW_API   API base URL (default: http://localhost:18789)`);
}

const commands: Record<string, () => Promise<void> | void> = {
	serve: cmdServe,
	start: cmdStart,
	stop: cmdStop,
	restart: cmdRestart,
	status: cmdStatus,
	help: cmdHelp,
};

const cmd = process.argv[2] ?? "help";
const handler = commands[cmd];
if (!handler) {
	console.error(`Unknown command: ${cmd}\nRun 'yanclaw help' for usage.`);
	process.exit(1);
}
await handler();
