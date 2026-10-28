// Log Stream command — bir dosyayı tail -f gibi izle.
//
// Kullanım: frontend ait bir LogStreamPane mount edildiğinde log_stream_open
// çağırır, channel üzerinden satırları alır. Dosyada değişiklik olunca
// notify-rs event tetikler, biz seek + read ile yeni byte'ları okur ve
// satır satır frontend'e push ederiz. log_stream_close ile watcher iptal.
//
// Windows notes: notify'ın ReadDirectoryChangesW backend'i append'ler için
// `Modify(ModifyKind::Any)` üretir (eskiden yalnızca `ModifyKind::Data`
// kabul edildiği için Windows'ta hiç satır akmıyordu). Ayrıca bazı yazıcılar
// (buffer'lı logger'lar, ağ paylaşımı olmayan ama lazy-flush eden dosyalar)
// hiç event üretmeyebilir; bu yüzden her 500 ms'de bir dosya boyutu da
// kontrol edilir (polling fallback).

use crate::commands::path_policy;
use crate::error::{AppError, AppResult};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::thread;
use tauri::{ipc::Channel, State};

pub struct LogStreams {
    /// Aktif stream'ler — id → cancel flag (true ise watcher thread durur).
    inner: Mutex<HashMap<String, Arc<AtomicBool>>>,
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

/// İzin verilen log uzantıları. `json`/`csv` kaldırıldı: bunlar log değil,
/// kimlik bilgisi dosyalarının tipik uzantıları (`~/.docker/config.json`,
/// gcloud `application_default_credentials.json`, Azure token cache …).
/// `ndjson` (yapılandırılmış log) ve `txt` kalıyor; `txt` için hassas dizin
/// denylist'i ayrıca uygulanır.
const ALLOWED_LOG_EXTS: &[&str] = &["log", "txt", "out", "err", "ndjson"];

/// Canonical path'te bu dizin segmentlerinden biri varsa okuma reddedilir
/// (büyük/küçük harf duyarsız). Uzantı allowlist'ine ek savunma katmanı.
const DENIED_DIR_SEGMENTS: &[&str] = &[
    ".ssh",
    ".aws",
    ".azure",
    ".docker",
    ".kube",
    ".gnupg",
    ".config", // gcloud, gh, git-credential, … (Linux/macOS + bazı Windows CLI'ları)
    "gcloud",
    "credentials",
    "protect", // %APPDATA%\Microsoft\Protect (DPAPI master key'leri)
    "vault",
    "d-terminal", // uygulamanın kendi veri dizini (DB, yedekler, log'lar)
];

/// Tek seferlik dosya okuma üst sınırı — devasa bir log (500 MB+) bellekte
/// patlamasın. İlk açılışta dosyanın SON 16 MB'ı okunur; her event'te en
/// fazla 16 MB yeni veri okunur, kalanı sonraki turda.
const MAX_LOG_READ_BYTES: u64 = 16 * 1024 * 1024;

/// Newline içermeyen tek bir "satır" bu boyutu aşarsa zorla gönderilir
/// (binary dosya / dev satır → carry buffer sınırsız büyümesin).
const MAX_LINE_BYTES: usize = 1024 * 1024;

/// Path'i doğrular ve okunacak canonical path'i döner.
///
/// Politika: yalnızca yerel, var olan, symlink/junction OLMAYAN, log
/// uzantılı ve hassas dizinler dışında kalan bir dosya. Canonical path
/// üzerinde kontrol edildiği için ara dizinlerdeki junction'lar da çözülmüş
/// olur (eskiden yalnızca son bileşen kontrol ediliyordu). Okuma, kullanıcının
/// verdiği path üzerinden değil canonical path üzerinden yapılır.
fn validate_log_path(path: &str) -> AppResult<PathBuf> {
    // UNC / `..` / relative → FS'e dokunmadan reddet.
    path_policy::reject_unc(path)?;
    let p = Path::new(path);
    path_policy::reject_parent_dir(p)?;
    check_extension(p)?;
    // Son bileşen symlink/junction ise reddet (hedefin uzantısı farklı olabilir).
    if let Ok(meta) = p.symlink_metadata() {
        if meta.file_type().is_symlink() {
            return Err(AppError::InvalidArg(
                "symlinks/junctions not allowed for log files".into(),
            ));
        }
    }
    let canon = path_policy::canonical_local(path)?;
    if !canon.is_file() {
        return Err(AppError::InvalidArg(format!("not a file: {path}")));
    }
    check_extension(&canon)?;
    check_denied_dirs(&canon)?;
    Ok(canon)
}

fn check_extension(p: &Path) -> AppResult<()> {
    let ext = p
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

fn check_denied_dirs(canon: &Path) -> AppResult<()> {
    let denied = canon
        .parent()
        .into_iter()
        .flat_map(|d| d.components())
        .any(|c| {
            let seg = c.as_os_str().to_string_lossy().to_ascii_lowercase();
            DENIED_DIR_SEGMENTS.iter().any(|d| *d == seg)
        });
    if denied {
        return Err(AppError::InvalidArg(
            "log files in credential/app-data directories are not allowed".into(),
        ));
    }
    Ok(())
}

/// Okunan byte'ları satırlara böler. Son (newline'sız) parça `carry`'de kalır
/// ve sonraki okumada tamamlanır; çok baytlı UTF-8 karakter de böylece iki
/// okuma arasında bölünmez. Geçersiz UTF-8 (UTF-16 / cp1254 log) lossy decode
/// edilir — eskiden `read_to_string` hata verip stream'i kalıcı kilitliyordu.
fn split_lines(carry: &mut Vec<u8>, data: &[u8]) -> Vec<String> {
    carry.extend_from_slice(data);
    let mut out = Vec::new();
    let mut start = 0;
    while let Some(rel) = carry[start..].iter().position(|&b| b == b'\n') {
        let end = start + rel;
        let mut line = &carry[start..end];
        if line.last() == Some(&b'\r') {
            line = &line[..line.len() - 1];
        }
        out.push(String::from_utf8_lossy(line).into_owned());
        start = end + 1;
    }
    carry.drain(..start);
    if carry.len() > MAX_LINE_BYTES {
        out.push(String::from_utf8_lossy(carry).into_owned());
        carry.clear();
    }
    out
}

/// `last_pos`'tan itibaren en fazla `MAX_LOG_READ_BYTES` oku.
fn read_from(path: &Path, last_pos: &mut u64, carry: &mut Vec<u8>) -> Option<Vec<String>> {
    let mut f = File::open(path).ok()?;
    let size = f.metadata().ok()?.len();
    if size < *last_pos {
        // Truncate veya rotate — baştan oku
        *last_pos = 0;
        carry.clear();
    }
    if size == *last_pos {
        return Some(Vec::new());
    }
    f.seek(SeekFrom::Start(*last_pos)).ok()?;
    let mut buf = Vec::new();
    let n = f.take(MAX_LOG_READ_BYTES).read_to_end(&mut buf).ok()?;
    *last_pos += n as u64;
    Some(split_lines(carry, &buf))
}

/// Yeni bir log stream başlat. `tail` true ise sadece yeni satırlar gönderir
/// (mevcut içerik atlanır), false ise dosyanın son 16 MB'ı gönderilir.
#[tauri::command]
pub fn log_stream_open(
    state: State<'_, LogStreams>,
    id: String,
    path: String,
    tail: bool,
    on_line: Channel<String>,
) -> AppResult<()> {
    let path_buf = validate_log_path(&path)?;
    let cancel = Arc::new(AtomicBool::new(false));
    // Aynı id yeniden açılırsa eski watcher thread'i iptal edilir (eskiden
    // cancel flag'i ezilip eski thread sonsuza kadar sızıyordu).
    if let Some(old) = state.inner.lock().insert(id.clone(), cancel.clone()) {
        old.store(true, Ordering::Relaxed);
    }

    let cancel_clone = cancel.clone();
    thread::Builder::new()
        .name(format!("log-stream-{id}"))
        .spawn(move || {
            let send_all = |lines: Vec<String>| -> bool {
                for line in lines {
                    if cancel_clone.load(Ordering::Relaxed) {
                        return false;
                    }
                    let _ = on_line.send(line);
                }
                true
            };

            let size = std::fs::metadata(&path_buf).map(|m| m.len()).unwrap_or(0);
            let mut carry: Vec<u8> = Vec::new();
            let mut last_pos = if tail {
                size
            } else {
                // Son 16 MB — devasa log'ta bellek patlamasın, en yeni içerik görünsün.
                size.saturating_sub(MAX_LOG_READ_BYTES)
            };
            if !tail {
                // Ortadan başlıyorsak ilk (yarım) satırı atla.
                let skip_partial = last_pos > 0;
                if let Some(mut lines) = read_from(&path_buf, &mut last_pos, &mut carry) {
                    if skip_partial && !lines.is_empty() {
                        lines.remove(0);
                    }
                    if !send_all(lines) {
                        return;
                    }
                }
            }

            // notify-rs ile dosya watcher — event gelmese de 500 ms'de bir boyut
            // kontrolü yapılır (bkz. dosya başı).
            let (tx, rx) = channel();
            let watcher: Option<RecommendedWatcher> =
                notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                    let _ = tx.send(res);
                })
                .ok()
                .and_then(|mut w| {
                    // Parent dizinini watch — bazı OS'lar tek dosya için event üretmez
                    let parent = path_buf.parent().unwrap_or(Path::new("."));
                    w.watch(parent, RecursiveMode::NonRecursive).ok().map(|_| w)
                });

            loop {
                if cancel_clone.load(Ordering::Relaxed) {
                    return;
                }
                let should_read = match rx.recv_timeout(std::time::Duration::from_millis(500)) {
                    Ok(Ok(event)) => {
                        event.paths.iter().any(|p| p == &path_buf)
                            && matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_))
                    }
                    Ok(Err(_)) => false,
                    // timeout (veya watcher yok/kapandı) → polling fallback
                    Err(_) => true,
                };
                if !should_read {
                    continue;
                }
                if let Some(lines) = read_from(&path_buf, &mut last_pos, &mut carry) {
                    if !send_all(lines) {
                        return;
                    }
                }
                if watcher.is_none() {
                    // Watcher kurulamadıysa recv anında Err döner; CPU'yu yakma.
                    thread::sleep(std::time::Duration::from_millis(500));
                }
            }
        })
        .map_err(|e| AppError::Internal(format!("watcher thread spawn: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn log_stream_close(state: State<'_, LogStreams>, id: String) -> AppResult<()> {
    if let Some(cancel) = state.inner.lock().remove(&id) {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_lines_carries_partial_utf8() {
        let mut carry = Vec::new();
        let text = "ğüş\nikinci".as_bytes();
        // 'ğ' (C4 9F) ortasından böl
        let lines = split_lines(&mut carry, &text[..1]);
        assert!(lines.is_empty());
        let lines = split_lines(&mut carry, &text[1..]);
        assert_eq!(lines, vec!["ğüş".to_string()]);
        assert_eq!(carry, "ikinci".as_bytes());
    }

    #[test]
    fn split_lines_strips_crlf_and_handles_invalid_utf8() {
        let mut carry = Vec::new();
        let lines = split_lines(&mut carry, b"a\r\n\xff\xfe\n");
        assert_eq!(lines[0], "a");
        assert!(lines[1].contains('\u{FFFD}'));
        assert!(carry.is_empty());
    }

    #[test]
    fn split_lines_flushes_overlong_line() {
        let mut carry = Vec::new();
        let big = vec![b'x'; MAX_LINE_BYTES + 1];
        let lines = split_lines(&mut carry, &big);
        assert_eq!(lines.len(), 1);
        assert!(carry.is_empty());
    }

    #[test]
    fn rejects_credential_extensions_and_unc() {
        assert!(validate_log_path("/home/u/.docker/config.json").is_err());
        assert!(validate_log_path(r"\\attacker\share\x.log").is_err());
        assert!(validate_log_path("relative.log").is_err());
        assert!(validate_log_path("/var/log/../etc/x.log").is_err());
    }

    #[test]
    fn denies_sensitive_dirs() {
        assert!(check_denied_dirs(Path::new("/home/u/.ssh/debug.log")).is_err());
        assert!(check_denied_dirs(Path::new("/home/u/.aws/cli.txt")).is_err());
        assert!(check_denied_dirs(Path::new("/var/log/app.log")).is_ok());
    }

    #[test]
    fn reads_appended_data_incrementally() {
        let dir = std::env::temp_dir().join(format!("dterm-logtest-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("t.log");
        std::fs::write(&file, b"one\ntw").unwrap();
        let mut pos = 0;
        let mut carry = Vec::new();
        assert_eq!(read_from(&file, &mut pos, &mut carry).unwrap(), vec!["one"]);
        use std::io::Write;
        std::fs::OpenOptions::new()
            .append(true)
            .open(&file)
            .unwrap()
            .write_all(b"o\n")
            .unwrap();
        assert_eq!(read_from(&file, &mut pos, &mut carry).unwrap(), vec!["two"]);
        // truncate → baştan
        std::fs::write(&file, b"x\n").unwrap();
        assert_eq!(read_from(&file, &mut pos, &mut carry).unwrap(), vec!["x"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
