use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tokio::process::Child;

struct GatewayState {
    process: Mutex<Option<Child>>,
}

struct TrayState {
    status_item: MenuItem<tauri::Wry>,
}

fn data_dir() -> PathBuf {
    let home = dirs_home();
    home.join(".yanclaw")
}

fn dirs_home() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(std::env::var("USERPROFILE").unwrap_or_else(|_| "C:\\Users\\Default".into()))
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
    }
}

#[tauri::command]
async fn get_auth_token() -> Result<String, String> {
    let token_path = data_dir().join("auth.token");
    std::fs::read_to_string(&token_path)
        .map(|s| s.trim().to_string())
        .map_err(|e| format!("Failed to read auth token: {}", e))
}

#[tauri::command]
async fn get_gateway_port() -> Result<u16, String> {
    // Read from config to get the configured port
    let config_path = data_dir().join("config.json5");
    if let Ok(content) = std::fs::read_to_string(&config_path) {
        // Simple port extraction — look for "port:" or "port :"
        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("port") {
                if let Some(val) = trimmed.split(':').nth(1) {
                    let val = val.trim().trim_end_matches(',');
                    if let Ok(port) = val.parse::<u16>() {
                        return Ok(port);
                    }
                }
            }
        }
    }
    Ok(18789) // default
}

#[tauri::command]
async fn start_gateway(state: State<'_, GatewayState>) -> Result<(), String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if proc.is_some() {
        return Err("Gateway already running".into());
    }

    let (cmd, args) = find_server_entry().ok_or("Could not find server entry point")?;

    let child = tokio::process::Command::new(&cmd)
        .args(&args)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start gateway ({}): {}", cmd, e))?;

    *proc = Some(child);
    log::info!("Gateway started");
    Ok(())
}

#[tauri::command]
async fn stop_gateway(state: State<'_, GatewayState>) -> Result<(), String> {
    let child = {
        let mut proc = state.process.lock().map_err(|e| e.to_string())?;
        proc.take()
    };
    if let Some(mut child) = child {
        child.kill().await.map_err(|e| format!("Failed to stop gateway: {}", e))?;
        log::info!("Gateway stopped");
    }
    Ok(())
}

#[tauri::command]
async fn is_gateway_running(state: State<'_, GatewayState>) -> Result<bool, String> {
    let mut proc = state.process.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut child) = *proc {
        match child.try_wait() {
            Ok(Some(_)) => {
                *proc = None;
                Ok(false)
            }
            Ok(None) => Ok(true),
            Err(_) => Ok(false),
        }
    } else {
        Ok(false)
    }
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_updater::UpdaterExt;
    match app.updater().map_err(|e| e.to_string())?.check().await {
        Ok(Some(update)) => Ok(Some(format!("v{}", update.version))),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Update check failed: {}", e)),
    }
}

#[tauri::command]
async fn install_update(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?;

    if let Some(update) = update {
        let mut downloaded = 0;
        update
            .download_and_install(
                |chunk_length, content_length| {
                    downloaded += chunk_length;
                    log::info!(
                        "Update downloading: {}/{}",
                        downloaded,
                        content_length.unwrap_or(0)
                    );
                },
                || {
                    log::info!("Update download finished, installing...");
                },
            )
            .await
            .map_err(|e| format!("Install failed: {}", e))?;
    }
    Ok(())
}

/// Returns (command, args) to start the gateway server.
/// In dev: ("bun", ["run", "packages/server/src/index.ts"])
/// In prod: ("path/to/yanclaw-server", [])  — compiled standalone binary
fn find_server_entry() -> Option<(String, Vec<String>)> {
    // In development, run from workspace with bun
    let dev_path = std::env::current_dir()
        .ok()?
        .join("packages/server/src/index.ts");
    if dev_path.exists() {
        return Some((
            "bun".to_string(),
            vec!["run".to_string(), dev_path.to_string_lossy().to_string()],
        ));
    }

    // In production, look for compiled standalone binary in bundled resources
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    #[cfg(target_os = "windows")]
    let binary_name = "yanclaw-server.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "yanclaw-server";

    // Platform-specific resource paths
    let candidates = [
        exe_dir.join(format!("server/{}", binary_name)),                      // Windows
        exe_dir.join(format!("../Resources/server/{}", binary_name)),         // macOS
        exe_dir.join(format!("../lib/yanclaw/server/{}", binary_name)),       // Linux
    ];

    for path in &candidates {
        if path.exists() {
            let resolved = path.canonicalize().ok()?;
            return Some((resolved.to_string_lossy().to_string(), vec![]));
        }
    }

    None
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let status_item =
        MenuItem::with_id(app, "status", "Gateway: Checking...", false, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let update_item =
        MenuItem::with_id(app, "check_update", "Check for Updates", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&status_item, &show, &update_item, &quit])?;

    let tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("YanClaw")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "check_update" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    match check_for_updates(handle.clone()).await {
                        Ok(Some(version)) => {
                            log::info!("Update available: {}", version);
                            // Emit event to frontend for UI notification
                            let _ = handle.emit("update-available", version);
                        }
                        Ok(None) => {
                            log::info!("No updates available");
                        }
                        Err(e) => {
                            log::warn!("Update check failed: {}", e);
                        }
                    }
                });
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    // Store status item for health check updates
    app.manage(TrayState {
        status_item: status_item,
    });

    // Periodic health check — update tray tooltip and status menu item
    let tray_id = tray.id().clone();
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            let port = get_gateway_port().await.unwrap_or(18789);
            let is_healthy = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                tokio::net::TcpStream::connect(format!("127.0.0.1:{}", port)),
            )
            .await
            .map(|r| r.is_ok())
            .unwrap_or(false);

            let (tooltip, label) = if is_healthy {
                ("YanClaw - Connected", "Gateway: Connected")
            } else {
                ("YanClaw - Disconnected", "Gateway: Disconnected")
            };

            if let Some(tray) = handle.tray_by_id(&tray_id) {
                let _ = tray.set_tooltip(Some(tooltip));
            }
            if let Some(state) = handle.try_state::<TrayState>() {
                let _ = state.status_item.set_text(label);
            }

            tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        }
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Focus existing window on second instance
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(GatewayState {
            process: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_auth_token,
            get_gateway_port,
            start_gateway,
            stop_gateway,
            is_gateway_running,
            check_for_updates,
            install_update,
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            setup_tray(app.handle())?;

            // Global shortcut: Ctrl+Shift+Y to show/focus window
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyY);
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }
            }).map_err(|e| {
                log::warn!("Failed to register global shortcut: {}", e);
                e
            }).ok();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
