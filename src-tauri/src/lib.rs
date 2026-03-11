use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
use tokio::process::Child;

struct GatewayState {
    process: Mutex<Option<Child>>,
}

struct TrayState {
    status_item: MenuItem<tauri::Wry>,
    start_item: MenuItem<tauri::Wry>,
    stop_item: MenuItem<tauri::Wry>,
    restart_item: MenuItem<tauri::Wry>,
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

    let log_dir = data_dir();
    let _ = std::fs::create_dir_all(&log_dir);
    let stdout_file = std::fs::File::create(log_dir.join("server.log"))
        .map_err(|e| format!("Failed to create log file: {}", e))?;
    let stderr_file = stdout_file.try_clone()
        .map_err(|e| format!("Failed to clone log file: {}", e))?;

    let child = tokio::process::Command::new(&cmd)
        .args(&args)
        .stdout(stdout_file)
        .stderr(stderr_file)
        .spawn()
        .map_err(|e| format!("Failed to start gateway ({}): {}", cmd, e))?;

    *proc = Some(child);
    log::info!("Gateway started: {} {:?}", cmd, args);
    Ok(())
}

#[tauri::command]
async fn stop_gateway(app: AppHandle) -> Result<(), String> {
    graceful_stop_gateway(&app).await;
    Ok(())
}

/// Gracefully stop the gateway: HTTP shutdown → wait → force kill
async fn graceful_stop_gateway(app: &AppHandle) {
    let port = get_gateway_port().await.unwrap_or(18789);

    // 1. Try HTTP graceful shutdown first
    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
    {
        let mut req = client.post(format!("http://127.0.0.1:{}/api/system/shutdown", port));
        if let Ok(token) = get_auth_token().await {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        let _ = req.send().await;
    }

    // 2. Wait for process to exit (max 5 seconds)
    let state = app.state::<GatewayState>();
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        if tokio::time::Instant::now() > deadline {
            break;
        }
        // Check process status without holding lock across await
        let exited = {
            let mut guard = match state.process.lock() {
                Ok(g) => g,
                Err(_) => break,
            };
            match guard.as_mut() {
                None => true,
                Some(child) => {
                    if child.try_wait().ok().flatten().is_some() {
                        *guard = None;
                        true
                    } else {
                        false
                    }
                }
            }
        }; // guard dropped here
        if exited {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }

    // 3. Force kill if still running — take child out of mutex before awaiting
    let child = {
        let mut guard = match state.process.lock() {
            Ok(g) => g,
            Err(_) => return,
        };
        guard.take()
    }; // guard dropped here
    if let Some(mut child) = child {
        log::warn!("Gateway did not exit gracefully, force killing");
        let _ = child.kill().await;
    }

    log::info!("Gateway stopped");
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
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    #[cfg(target_os = "windows")]
    let binary_name = "yanclaw-server.exe";
    #[cfg(not(target_os = "windows"))]
    let binary_name = "yanclaw-server";

    // First, check for compiled binary next to the executable (production)
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

    // Fallback: development mode — run from workspace with bun
    if cfg!(debug_assertions) {
        let dev_path = std::env::current_dir()
            .ok()?
            .join("packages/server/src/index.ts");
        if dev_path.exists() {
            return Some((
                "bun".to_string(),
                vec!["run".to_string(), dev_path.to_string_lossy().to_string()],
            ));
        }
    }

    None
}

/// Show, unminimize, and focus the main window.
fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let status_item =
        MenuItem::with_id(app, "status", "Gateway: Checking...", false, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let start_item =
        MenuItem::with_id(app, "start_gw", "Start Gateway", false, None::<&str>)?;
    let stop_item =
        MenuItem::with_id(app, "stop_gw", "Stop Gateway", false, None::<&str>)?;
    let restart_item =
        MenuItem::with_id(app, "restart_gw", "Restart Gateway", false, None::<&str>)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let update_item =
        MenuItem::with_id(app, "check_update", "Check for Updates", true, None::<&str>)?;
    let sep4 = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &sep1,
            &show,
            &sep2,
            &start_item,
            &stop_item,
            &restart_item,
            &sep3,
            &update_item,
            &sep4,
            &quit,
        ],
    )?;

    let tray = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("YanClaw")
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { .. } = event {
                show_window(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                show_window(app);
            }
            "start_gw" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<GatewayState>();
                    if let Err(e) = start_gateway(state).await {
                        log::warn!("Failed to start gateway from tray: {}", e);
                    }
                });
            }
            "stop_gw" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    graceful_stop_gateway(&handle).await;
                });
            }
            "restart_gw" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    graceful_stop_gateway(&handle).await;
                    let state = handle.state::<GatewayState>();
                    if let Err(e) = start_gateway(state).await {
                        log::warn!("Failed to restart gateway: {}", e);
                    }
                });
            }
            "check_update" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    match check_for_updates(handle.clone()).await {
                        Ok(Some(version)) => {
                            log::info!("Update available: {}", version);
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
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    graceful_stop_gateway(&handle).await;
                    handle.exit(0);
                });
            }
            _ => {}
        })
        .build(app)?;

    // Store tray state for health check updates
    app.manage(TrayState {
        status_item,
        start_item,
        stop_item,
        restart_item,
    });

    // Periodic health check — update tray tooltip, status, and menu item states
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
                // Enable/disable gateway control items based on status
                let _ = state.start_item.set_enabled(!is_healthy);
                let _ = state.stop_item.set_enabled(is_healthy);
                let _ = state.restart_item.set_enabled(is_healthy);
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
            show_window(app);
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

            // DevTools only in development mode
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // Intercept window close → hide to tray (don't exit)
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w.hide();
                    }
                });
            }

            setup_tray(app.handle())?;

            // Global shortcut: Ctrl+Shift+Y to show/focus window
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyY);
            let handle = app.handle().clone();
            app.global_shortcut().on_shortcut(shortcut, move |_app, _shortcut, event| {
                if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                    show_window(&handle);
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
