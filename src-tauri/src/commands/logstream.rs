// Log Stream command — bir dosyayı tail -f gibi izle.
//
// Kullanım: frontend ait bir LogStreamPane mount edildiğinde log_stream_open
// çağırır, channel üzerinden satırları alır. Dosyada değişiklik olunca
// notify-rs event tetikler, biz seek + read ile yeni byte'ları okur ve
// satır satır frontend'e push ederiz. log_stream_close ile watcher iptal.

use crate::error::{AppError, AppResult};
use notify::{event::ModifyKind, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::thread;
use tauri::{ipc::Channel, State};

pub struct LogStreams {
    /// Aktif stream'ler — id → cancel flag (true ise watcher thread durur).
    inner: Mutex<HashMap<String, Arc<Mutex<bool>>>>,
}

impl LogStreams {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for LogStreams {
    fn default() -> Self {
        Self::new()
    }
}

/// İzin verilen log uzantıları — saldırgan `id_rsa`, `SAM`, `credentials.json`
/// gibi dosyaları stream edip channel üzerinden exfiltrate edemesin.
const ALLOWED_LOG_EXTS: &[&str] = &["log", "txt", "out", "err", "json", "ndjson", "csv"];

fn validate_log_path(path: &std::path::Path) -> AppResult<()> {
    // UNC path reddet — saldırı yüzeyi hiç açılmasın.
    let s = path.to_string_lossy();
    if s.starts_with(r"\\") || s.starts_with("//") {
        return Err(AppError::InvalidArg("UNC path not allowed".into()));
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !ALLOWED_LOG_EXTS.iter().any(|a| *a == ext) {
        return Err(AppError::InvalidArg(format!(
            "log extension not allowed: .{ext} (allowed: {})",
            ALLOWED_LOG_EXTS.join(", ")
        )));
    }
    Ok(())
}

/// Yeni bir log stream başlat. `tail` true ise sadece yeni satırlar gönderir
/// (mevcut içerik atlanır), false ise tüm dosya başından okunur.
#[tauri::command]
pub fn log_stream_open(
    state: State<'_, LogStreams>,
    id: String,
    path: String,
    tail: bool,
    on_line: Channel<String>,
) -> AppResult<()> {
    let path_buf = PathBuf::from(&path);
    validate_log_path(&path_buf)?;
    if !path_buf.exists() {
        return Err(AppError::InvalidArg(format!("file not found: {path}")));
    }
    let cancel = Arc::new(Mutex::new(false));
    state.inner.lock().insert(id.clone(), cancel.clone());

    let cancel_clone = cancel.clone();
    thread::Builder::new()
        .name(format!("log-stream-{id}"))
        .spawn(move || {
            // İlk açılış: dosyanın mevcut son pozisyonunu al (tail mode için).
            let initial_pos = if tail {
                std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0)
            } else {
                0
            };
            let mut last_pos = initial_pos;

            // Tail değilse mevcut içeriği bir kerede oku.
            if !tail {
                if let Ok(mut f) = File::open(&path_buf) {
                    let mut buf = String::new();
                    if f.read_to_string(&mut buf).is_ok() {
                        for line in buf.lines() {
                            if *cancel_clone.lock() {
                                return;
                            }
                            let _ = on_line.send(line.to_string());
                        }
                        last_pos = std::fs::metadata(&path_buf)
                            .map(|m| m.len())
                            .unwrap_or(buf.len() as u64);
                    }
                }
            }

            // notify-rs ile dosya watcher
            let (tx, rx) = channel();
            let mut watcher: RecommendedWatcher =
                match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                    let _ = tx.send(res);
                }) {
                    Ok(w) => w,
                    Err(_) => return,
                };
            // Parent dizinini watch — bazı OS'lar tek dosya için event üretmez
            let parent = path_buf.parent().unwrap_or(std::path::Path::new("."));
            let _ = watcher.watch(parent, RecursiveMode::NonRecursive);

            loop {
                if *cancel_clone.lock() {
                    return;
                }
                let event = match rx.recv_timeout(std::time::Duration::from_millis(500)) {
                    Ok(Ok(e)) => e,
                    Ok(Err(_)) => continue,
                    Err(_) => continue, // timeout — cancel kontrolü için tekrar dön
                };
                // Sadece bizim dosyamızı ilgilendir
                if !event.paths.iter().any(|p| p == &path_buf) {
                    continue;
                }
                if !matches!(
                    event.kind,
                    EventKind::Modify(ModifyKind::Data(_)) | EventKind::Create(_)
                ) {
                    continue;
                }
                // Yeni byte'ları oku
                let Ok(mut f) = File::open(&path_buf) else {
                    continue;
                };
                let metadata = match f.metadata() {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let size = metadata.len();
                if size < last_pos {
                    // Truncate veya rotate — baştan oku
                    last_pos = 0;
                }
                if size == last_pos {
                    continue;
                }
                if f.seek(SeekFrom::Start(last_pos)).is_err() {
                    continue;
                }
                let mut buf = String::new();
                if f.read_to_string(&mut buf).is_err() {
                    continue;
                }
                last_pos = size;
                for line in buf.lines() {
                    if *cancel_clone.lock() {
                        return;
                    }
                    let _ = on_line.send(line.to_string());
                }
            }
        })
        .map_err(|e| AppError::Internal(format!("watcher thread spawn: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn log_stream_close(state: State<'_, LogStreams>, id: String) -> AppResult<()> {
    if let Some(cancel) = state.inner.lock().remove(&id) {
        *cancel.lock() = true;
    }
    Ok(())
}
