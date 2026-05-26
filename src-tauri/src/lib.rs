// D-Terminal — kütüphane kökü.

pub mod ai;
pub mod commands;
pub mod error;
pub mod logger;
pub mod process_jail;
pub mod secrets;
pub mod session;
pub mod sidecar;
pub mod state;
pub mod storage;

use crate::process_jail::ProcessJail;
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

    // tracing — hem stderr hem dosya (daily rotate). Guard drop edilirse async
    // writer kapanır → process lifetime'ı boyunca yaşamalı. Box::leak idiomatic
    // (eski `mem::forget` semantik olarak aynı ama "nasıl çözeceğimi bilemedim"
    // havası bırakıyor; Box::leak niyeti netleştirir).
    Box::leak(Box::new(logger::init_tracing(&log_dir)));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Auto-start: Settings UI'dan kullanıcı toggle ile açıp kapatır.
        // Windows registry HKCU\...\Run kullanır. macOS LaunchAgent default.
        // Args: None → standard launch (eklenecek launch arg yok).
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            // Storage açılamazsa (izin/disk bozuk) Tauri setup hatası olarak
            // propagate et — log'a context yaz, panic yerine düzgün exit path.
            let storage = Storage::open(db_path).map_err(|e| {
                tracing::error!("storage open failed: {e}");
                e
            })?;

            // ProcessJail — spawn edilen tüm child'ları (sidecar, git_stat'ın
            // git'i vb.) tek Job Object'e toplar, console window flash'larını
            // engeller. Settings'ten okunan kullanıcı tercihi default true;
            // değer yoksa veya parse fail olursa true (en güvenli).
            let suppress = storage
                .settings
                .get("ui.suppressConsoles")
                .ok()
                .flatten()
                .and_then(|v| serde_json::from_str::<bool>(&v).ok())
                .unwrap_or(true);
            let jail = ProcessJail::new(suppress);

            let sidecar_path = resolve_sidecar_path(app.handle());
            let sidecar = SidecarManager::new(sidecar_path, jail.clone());

            // Sidecar event'lerini Tauri event olarak emit et — IPC coalescing
            // ile. Yoğun stdout akışında (npm install, cargo build, cat
            // big.log) saniyede binlerce frame Tauri event olarak emit edilirse
            // JSON serde + WebView IPC + V8 GC üçlüsü CPU'yu doyurur.
            // Strateji: ilk event'ten sonra 16ms drain penceresi aç, aynı pane
            // için ardışık Stdout event'lerini tek event olarak birleştir,
            // diğer event tipleri (Exit/Error/Sidecar*) anında pass-through.
            // 16ms = 1 render frame, interaktif echo'da fark edilmez.
            if let Some(rx) = sidecar.take_event_receiver() {
                let emit_handle = app_handle.clone();
                std::thread::spawn(move || {
                    use std::time::{Duration, Instant};
                    const COALESCE_WINDOW: Duration = Duration::from_millis(16);
                    const MAX_EVENTS_PER_WINDOW: usize = 64;
                    while let Ok(first) = rx.recv() {
                        let mut batch = vec![first];
                        let deadline = Instant::now() + COALESCE_WINDOW;
                        loop {
                            let now = Instant::now();
                            if now >= deadline || batch.len() >= MAX_EVENTS_PER_WINDOW {
                                break;
                            }
                            match rx.recv_timeout(deadline - now) {
                                Ok(ev) => batch.push(ev),
                                Err(_) => break,
                            }
                        }
                        for ev in coalesce_pty_events(batch) {
                            forward_event(&emit_handle, &ev);
                        }
                    }
                });
            }

            app.manage(AppState::new(storage, sidecar, jail));
            app.manage(logger::LogPaths::new(log_dir.clone()));
            app.manage(commands::logstream::LogStreams::new());
            app.manage(commands::dfetch::DfetchLiveState::new());

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
            // Config as Code (TOML import/export)
            commands::config_io::config_dotfile_path,
            commands::config_io::config_export,
            commands::config_io::config_import,
            // Admin / UAC elevation
            commands::admin::admin_is_elevated,
            commands::admin::admin_restart_elevated,
            commands::admin::admin_open_dev_settings,
            // Secrets
            commands::secrets::secrets_store,
            commands::secrets::secrets_delete,
            commands::secrets::secrets_list,
            commands::secrets::secrets_has,
            // AI: maskeli key + Rust-side proxy (key frontend'e sızmaz)
            commands::ai_proxy::ai_key_masked,
            commands::ai::ai_models,
            commands::ai::ai_chat_stream,
            commands::ai::ai_abort_stream,
            // DFetch
            commands::dfetch::dfetch_get,
            commands::dfetch::dfetch_live,
            commands::dfetch::dfetch_save_snapshot,
            commands::git_stat::git_diff_shortstat,
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
            // Log Stream (tail -f benzeri dosya izleme)
            commands::logstream::log_stream_open,
            commands::logstream::log_stream_close,
            // Window
            commands::window::window_set_vibrancy,
            // ProcessJail (child console suppression + Job Object lifecycle)
            commands::process::process_set_suppress_consoles,
            commands::process::process_suppress_consoles,
            commands::process::process_jail_active,
            commands::process::process_jail_assign_failed,
        ])
        .build(tauri::generate_context!())
        .expect("D-Terminal Tauri runtime failed to start")
        .run(|app, event| {
            // Tauri kapanırken sidecar process'i açıkça temizle. Drop impl da
            // var ama Tauri runtime AppHandle Arc'ları sırayla drop ettiğinden
            // sidecar drop'u state.unwrap'a kalabiliyor; ExitRequested
            // hook'u zombi sidecar riskini kesin olarak kapatır.
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app.state::<state::AppState>();
                state.sidecar.shutdown();
                tracing::info!("sidecar shutdown via ExitRequested");
            }
        });
}

/// Ardışık Stdout event'lerini aynı pane için tek event'te birleştir.
/// Sıra korunur — Stdout dışı event'ler (Exit/Error/SidecarUp/Down) lifecycle
/// sinyali olduğu için merge edilmez, kendi yerinde durur.
///
/// Performans gerekçesi: yoğun çıktıda 1000+ event/sn → 60 event/sn'e düşer.
/// Tauri JSON serde + WebView IPC ovehead'i ~%80 azalır, V8 garbage collection
/// baskısı önemli ölçüde rahatlar.
fn coalesce_pty_events(events: Vec<PtyEvent>) -> Vec<PtyEvent> {
    let mut out: Vec<PtyEvent> = Vec::with_capacity(events.len());
    for ev in events {
        // Aynı pane için son event Stdout ise yeni Stdout'u o data'ya ekle
        let can_merge = match (out.last(), &ev) {
            (
                Some(PtyEvent::Stdout {
                    pane_id: prev_pid, ..
                }),
                PtyEvent::Stdout { pane_id, .. },
            ) => prev_pid == pane_id,
            _ => false,
        };
        if can_merge {
            // can_merge true → ev Stdout olmalı; bug yüzünden değilse panic
            // yerine pass-through (defansif). Üretimde tracing ile farkına
            // varılır, kullanıcı deneyimi crash yerine küçük bir merge kaybı.
            if let PtyEvent::Stdout {
                data: mut new_data, ..
            } = ev
            {
                if let Some(PtyEvent::Stdout {
                    data: prev_data, ..
                }) = out.last_mut()
                {
                    prev_data.append(&mut new_data);
                }
                continue;
            } else {
                tracing::error!("coalesce: can_merge=true but ev is not Stdout — bug");
                out.push(ev);
                continue;
            }
        }
        out.push(ev);
    }
    out
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

fn resolve_sidecar_path(_app: &tauri::AppHandle) -> PathBuf {
    // Prod: Tauri externalBin yapılandırması ile bundled `dterminal-pty-bridge.exe`
    // ana exe'nin yanına yerleşir (Node.js bağımsız, pkg ile snapshot edilmiş).
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let prod_exe = parent.join("dterminal-pty-bridge.exe");
            if prod_exe.exists() {
                return prod_exe;
            }
        }
    }
    // Dev: repo'daki kaynak script — `node sidecar/pty-bridge.js` ile çalıştırılır
    // (manager.rs uzantı `.js` ise `node` argümanı ile spawn eder).
    if let Ok(cwd) = std::env::current_dir() {
        for candidate in [
            cwd.join("..").join("sidecar").join("pty-bridge.js"),
            cwd.join("sidecar").join("pty-bridge.js"),
        ] {
            if candidate.exists() {
                return candidate;
            }
        }
    }
    // Son çare — exe yanı (error path'e düşer, manager Sidecar(spawn failed) atar)
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("dterminal-pty-bridge.exe")))
        .unwrap_or_else(|| PathBuf::from("dterminal-pty-bridge.exe"))
}

#[cfg(test)]
mod coalesce_tests {
    use super::*;

    fn stdout(pane: &str, data: &[u8]) -> PtyEvent {
        PtyEvent::Stdout {
            pane_id: pane.into(),
            data: data.to_vec(),
        }
    }

    #[test]
    fn merges_consecutive_same_pane() {
        let result = coalesce_pty_events(vec![
            stdout("a", b"hello "),
            stdout("a", b"world"),
            stdout("a", b"!"),
        ]);
        assert_eq!(result.len(), 1);
        if let PtyEvent::Stdout { data, .. } = &result[0] {
            assert_eq!(data, b"hello world!");
        } else {
            panic!("expected Stdout");
        }
    }

    #[test]
    fn keeps_different_panes_separate() {
        let result = coalesce_pty_events(vec![
            stdout("a", b"foo"),
            stdout("b", b"bar"),
            stdout("a", b"baz"),
        ]);
        assert_eq!(result.len(), 3); // farklı pane'ler birleşmez
    }

    #[test]
    fn lifecycle_events_are_passthrough() {
        let result = coalesce_pty_events(vec![
            stdout("a", b"hi"),
            PtyEvent::Exit {
                pane_id: "a".into(),
                exit_code: 0,
                signal: None,
            },
            stdout("a", b"more"),
        ]);
        // Exit araya girdiği için Stdout'lar birleşmez (sıra korunur, lifecycle
        // sinyali yutulmaz).
        assert_eq!(result.len(), 3);
    }

    #[test]
    fn passes_empty_input() {
        assert_eq!(coalesce_pty_events(vec![]).len(), 0);
    }

    /// Stress: 1000 farklı pane'den round-robin event → her pane bir event'e
    /// merge olmaz çünkü araya başka pane giriyor; çıktı input'a eşit boyutta
    /// olmalı (interleaved, hiç merge yok).
    #[test]
    fn stress_interleaved_panes_no_merge() {
        let mut input = Vec::with_capacity(1000);
        for i in 0..1000 {
            input.push(stdout(&format!("p{}", i % 10), b"x"));
        }
        let result = coalesce_pty_events(input);
        // 10 pane round-robin → ardışık aynı pane yok → coalesce 0 merge.
        assert_eq!(result.len(), 1000);
    }

    /// Stress: 1000 ardışık aynı pane event → tek event'e merge.
    #[test]
    fn stress_same_pane_merges_to_one() {
        let mut input = Vec::with_capacity(1000);
        for _ in 0..1000 {
            input.push(stdout("only", b"a"));
        }
        let result = coalesce_pty_events(input);
        assert_eq!(result.len(), 1);
        if let PtyEvent::Stdout { data, .. } = &result[0] {
            assert_eq!(data.len(), 1000);
        } else {
            panic!("expected Stdout");
        }
    }

    /// Büyük payload: 64 KB'lık iki ardışık event → tek event'te 128 KB
    /// data; boyut sınırı yok (coalesce şu an cap koymuyor — backpressure
    /// downstream'de SyncSender'da).
    #[test]
    fn merges_large_64kb_payloads() {
        let big = vec![b'X'; 64 * 1024];
        let result = coalesce_pty_events(vec![stdout("a", &big), stdout("a", &big)]);
        assert_eq!(result.len(), 1);
        if let PtyEvent::Stdout { data, .. } = &result[0] {
            assert_eq!(data.len(), 128 * 1024);
        } else {
            panic!("expected Stdout");
        }
    }
}
