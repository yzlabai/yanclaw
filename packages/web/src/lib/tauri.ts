/** Check if running inside Tauri desktop shell. */
export function isTauri(): boolean {
	return "__TAURI_INTERNALS__" in window;
}

/** Get the gateway API base URL, using Tauri IPC to get the port if available. */
export async function getApiBase(): Promise<string> {
	if (isTauri()) {
		try {
			const { invoke } = await import("@tauri-apps/api/core");
			const port = await invoke<number>("get_gateway_port");
			return `http://localhost:${port}`;
		} catch {
			// Fallback
		}
	}
	return "http://localhost:18789";
}

/** Get the auth token via Tauri IPC. Returns null if not in Tauri or unavailable. */
export async function getAuthToken(): Promise<string | null> {
	if (!isTauri()) return null;
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<string>("get_auth_token");
	} catch {
		return null;
	}
}

/** Start the gateway server process (Tauri only). */
export async function startGateway(): Promise<void> {
	if (!isTauri()) return;
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("start_gateway");
}

/** Stop the gateway server process (Tauri only). */
export async function stopGateway(): Promise<void> {
	if (!isTauri()) return;
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("stop_gateway");
}

/** Check for available updates (Tauri only). Returns version string if update available. */
export async function checkForUpdates(): Promise<string | null> {
	if (!isTauri()) return null;
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<string | null>("check_for_updates");
	} catch {
		return null;
	}
}

/** Install available update (Tauri only). */
export async function installUpdate(): Promise<void> {
	if (!isTauri()) return;
	const { invoke } = await import("@tauri-apps/api/core");
	await invoke("install_update");
}

/** Check if gateway process is running (Tauri only). */
export async function isGatewayRunning(): Promise<boolean> {
	if (!isTauri()) return false;
	try {
		const { invoke } = await import("@tauri-apps/api/core");
		return await invoke<boolean>("is_gateway_running");
	} catch {
		return false;
	}
}
