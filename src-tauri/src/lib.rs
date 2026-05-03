// D-Terminal — kütüphane kökü.

pub mod commands;
pub mod error;
pub mod logger;
pub mod secrets;
pub mod session;
pub mod sidecar;
pub mod state;
pub mod storage;

use crate::sidecar::{PtyEvent, SidecarManager};
use crate::state::AppState;
use crate::storage::Storage;
use std::path::PathBuf;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let data_dir = dirs::data_dir()
        .map(|p| p.join("D-Terminal"))
        .unwrap_or_else(|| PathBuf::from("."));
    let log_dir = data_dir.join("logs");

    // tracing — hem stderr hem dosya (daily rotate). _guard drop edilirse async
    // writer kapanır; bu yüzden static OnceLock'a yerleştir.
    let _guard = logger::init_tracing(&log_dir);
    std::mem::forget(_guard);

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    use tauri_plugin_global_shortcut::ShortcutState;
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    // Quake/dropdown — global hotkey ile pencere toggle
                    if let Some(window) = app.get_webview_window("main") {
                        match window.is_visible() {
                            Ok(true) => {
                                let _ = window.hide();
                            }
                            _ => {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    let _ = shortcut;
                })
                .build(),
        )
        .setup(move |app| {
            let app_handle = app.handle().clone();

            let db_path = data_dir.join("dterminal.db");
            let storage = Storage::open(db_path).expect("storage open");

            let sidecar_path = resolve_sidecar_path();
            let sidecar = SidecarManager::new(sidecar_path);

            // Sidecar event'lerini Tauri event olarak emit et.
            if let Some(rx) = sidecar.take_event_receiver() {
                let emit_handle = app_handle.clone();
                std::thread::spawn(move || {
                    while let Ok(event) = rx.recv() {
                        forward_event(&emit_handle, &event);
                    }
                });
            }

            app.manage(AppState::new(storage, sidecar));
            app.manage(logger::LogPaths::new(log_dir.clone()));

            // Vibrancy stratejisi:
            //  - Mica (Win11 22H2+) modern, GPU-friendly, resize'da pürüzsüz.
            //  - Acrylic blur ağır → resize'da WebView2 ile FPS düşürür.
            //  - Varsayılan davranış: Mica dene; başarısızsa transparent ama vibrancy
            //    yok (opak üst katman). Kullanıcı isterse Settings'ten Acrylic'e geçer.
            //
            // Frontend ileride seçilen vibrancy'i Tauri command ile değiştirebilir;
            // burada sadece initial setup. Settings UI buna göre uyarı gösterir.
            #[cfg(target_os = "windows")]
            {
                use window_vibrancy::apply_mica;
                if let Some(window) = app.get_webview_window("main") {
                    if let Err(e) =
                        window.set_background_color(Some(tauri::window::Color(0, 0, 0, 0)))
                    {
                        tracing::warn!("set_background_color(transparent) failed: {e}");
                    }
                    match apply_mica(&window, Some(true)) {
                        Ok(_) => tracing::info!("vibrancy: Mica applied"),
                        Err(e) => tracing::info!(
                            "vibrancy: Mica unavailable ({e}); window stays transparent — \
                             user can switch to Acrylic from Settings (resize perf trade-off)"
                        ),
                    }
                } else {
                    tracing::error!("vibrancy: main window not found");
                }
            }

            // Quake hotkey — F1 ile pencereyi gizle/göster (Win11 + Linux + Mac)
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};
                let quake = Shortcut::new(Some(Modifiers::empty()), Code::F1);
                if let Err(e) = app.global_shortcut().register(quake) {
                    tracing::warn!("global shortcut F1 register failed: {e}");
                } else {
                    tracing::info!("quake hotkey registered: F1 (toggle window)");
                }
            }

            tracing::info!("D-Terminal ready");
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::ping,
            // PTY
            commands::pty::pty_spawn,
            commands::pty::pty_write,
            commands::pty::pty_resize,
            commands::pty::pty_kill,
            // History
            commands::history::history_add,
            commands::history::history_search,
            commands::history::history_toggle_favorite,
            commands::history::history_delete,
            // Session
            commands::session::session_save,
            commands::session::session_load,
            commands::session::session_list,
            commands::session::session_delete,
            // Settings
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_delete,
            commands::settings::settings_all,
            // Secrets
            commands::secrets::secrets_store,
            commands::secrets::secrets_delete,
            commands::secrets::secrets_list,
            commands::secrets::secrets_has,
            // AI proxy
            commands::ai_proxy::ai_key_masked,
            commands::ai_proxy::ai_key_reveal,
            // DFetch
            commands::dfetch::dfetch_get,
            // Themes
            commands::themes::themes_list,
            commands::themes::themes_save_user,
            // Snippets
            commands::snippets::snippet_list,
            commands::snippets::snippet_upsert,
            commands::snippets::snippet_delete,
            commands::snippets::snippet_get,
            // PSReadLine
            commands::psreadline::psreadline_import,
            // Logger
            commands::logger::log_event,
            commands::logger::log_paths,
            // Window
            commands::window::window_set_vibrancy,
        ])
        .run(tauri::generate_context!())
        .expect("D-Terminal Tauri runtime failed to start");
}

fn forward_event(app: &tauri::AppHandle, event: &PtyEvent) {
    let topic = match event {
        PtyEvent::Stdout { .. } => "pty://stdout",
        PtyEvent::Exit { .. } => "pty://exit",
        PtyEvent::Error { .. } => "pty://error",
        PtyEvent::SidecarUp => "sidecar://up",
        PtyEvent::SidecarDown { .. } => "sidecar://down",
    };
    if let Err(e) = app.emit(topic, event) {
        tracing::warn!("event emit failed: {e}");
    }
}

fn resolve_sidecar_path() -> PathBuf {
    // Geliştirmede repo'daki sidecar/pty-bridge.js'i kullan
    if let Ok(cwd) = std::env::current_dir() {
        let dev_path = cwd.join("..").join("sidecar").join("pty-bridge.js");
        if dev_path.exists() {
            return dev_path;
        }
        let dev_path2 = cwd.join("sidecar").join("pty-bridge.js");
        if dev_path2.exists() {
            return dev_path2;
        }
    }
    // Prod: bundled binary
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("dterminal-pty-bridge.exe")))
        .unwrap_or_else(|| PathBuf::from("dterminal-pty-bridge"))
}
