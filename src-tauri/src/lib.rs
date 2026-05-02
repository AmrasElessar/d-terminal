// D-Terminal — kütüphane kökü.

pub mod commands;
pub mod error;
pub mod secrets;
pub mod session;
pub mod sidecar;
pub mod state;
pub mod storage;

use crate::sidecar::{PtyEvent, SidecarManager};
use crate::state::AppState;
use crate::storage::Storage;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let app_handle = app.handle().clone();

            // %APPDATA%\D-Terminal\dterminal.db
            let data_dir = dirs::data_dir()
                .map(|p| p.join("D-Terminal"))
                .unwrap_or_else(|| PathBuf::from("."));
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
