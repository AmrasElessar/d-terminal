// PSReadLine ↔ D-Terminal komut geçmişi merge.
//
// PSReadLine geçmiş dosyası:
//   %APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt
//
// Format: her satır bir komut. Çok satırlı komutlarda PSReadLine her ara
// satırın sonuna backtick (`) koyar; bu satırlar tek komutta birleştirilir.
// İçe aktarma sırasında:
//   - Boş satır ve sadece-whitespace atlanır
//   - Dosya içindeki tekrarlar ve D-Terminal geçmişinde (tamamında) zaten
//     bulunan komutlar atlanır — yeniden import kopya üretmez
//   - `pane_type` = "powershell" olarak yazılır

use crate::error::{run_blocking, AppResult};
use crate::state::AppState;
use crate::storage::history::{NewHistoryEntry, MAX_COMMAND_BYTES};
use serde::Serialize;
use std::path::PathBuf;
use tauri::State;

#[derive(Debug, Serialize)]
pub struct ImportSummary {
    pub imported: usize,
    pub skipped_duplicates: usize,
    pub source_lines: usize,
    pub source_path: String,
}

/// PSReadLine geçmiş dosyası okuma sınırı (tipik dosya < 5 MB).
const MAX_HISTORY_FILE_BYTES: u64 = 64 * 1024 * 1024;

/// Async + blocking pool: tüm dosya okuma + bulk insert UI thread'ini dondurmasın.
#[tauri::command]
pub async fn psreadline_import(state: State<'_, AppState>) -> AppResult<ImportSummary> {
    let storage = state.storage.clone();
    run_blocking(move || import_blocking(&storage)).await
}

fn import_blocking(storage: &crate::storage::Storage) -> AppResult<ImportSummary> {
    let path = psreadline_history_path()?;
    if let Ok(meta) = std::fs::metadata(&path) {
        if meta.len() > MAX_HISTORY_FILE_BYTES {
            return Err(crate::error::AppError::InvalidArg(
                "PSReadLine history file too large".into(),
            ));
        }
    }
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(ImportSummary {
                imported: 0,
                skipped_duplicates: 0,
                source_lines: 0,
                source_path: path.to_string_lossy().into_owned(),
            });
        }
        Err(e) => return Err(crate::error::AppError::Io(e)),
    };

    let candidates = parse_history(&raw);
    let unique = dedupe_preserving_last(&candidates);
    let existing = storage.history.existing_commands(&unique)?;

    // Bulk insert: dedupe sonrası kalan satırları tek transaction'da yaz.
    // 5000 satırlı PSReadLine'da 5000 ayrı pool.get() + INSERT + WAL fsync
    // (~30sn) yerine tek transaction (<1sn). Audit Rust-perf O3.
    let mut to_insert: Vec<NewHistoryEntry> = Vec::new();
    let mut skipped_duplicates = 0usize;
    skipped_duplicates += candidates.len() - unique.len();
    for cmd in unique {
        if existing.contains(&cmd) {
            skipped_duplicates += 1;
            continue;
        }
        to_insert.push(NewHistoryEntry {
            command: cmd,
            pane_id: None,
            pane_type: Some("powershell".into()),
            exit_code: None,
            duration_ms: None,
        });
    }
    let imported = storage.history.add_bulk(&to_insert)?;

    Ok(ImportSummary {
        imported,
        skipped_duplicates,
        source_lines: candidates.len(),
        source_path: path.to_string_lossy().into_owned(),
    })
}

/// Satırları komutlara çevirir: sonu backtick ile biten satır bir sonraki
/// satırla (newline ile) birleştirilir. Boş komutlar ve sınırı aşanlar atılır.
fn parse_history(raw: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for line in raw.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(stripped) = line.strip_suffix('`') {
            current.push_str(stripped);
            current.push('\n');
            continue;
        }
        current.push_str(line);
        let cmd = current.trim();
        if !cmd.is_empty() && cmd.len() <= MAX_COMMAND_BYTES {
            out.push(cmd.to_string());
        }
        current.clear();
    }
    let tail = current.trim();
    if !tail.is_empty() && tail.len() <= MAX_COMMAND_BYTES {
        out.push(tail.to_string());
    }
    out
}

/// Dosya içi tekrarları kaldırır; her komutun SON geçtiği konum korunur
/// (insert sırası = kronoloji, en yeni kullanım en sonda).
fn dedupe_preserving_last(cmds: &[String]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut rev: Vec<String> = Vec::new();
    for c in cmds.iter().rev() {
        if seen.insert(c.as_str()) {
            rev.push(c.clone());
        }
    }
    rev.reverse();
    rev
}

fn psreadline_history_path() -> AppResult<PathBuf> {
    let appdata = dirs::config_dir()
        .ok_or_else(|| crate::error::AppError::Internal("APPDATA path unresolved".into()))?;
    Ok(appdata
        .join("Microsoft")
        .join("Windows")
        .join("PowerShell")
        .join("PSReadLine")
        .join("ConsoleHost_history.txt"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_backtick_continuations() {
        let raw = "Get-Item `\r\n  -Path x\r\nls\r\n\r\n";
        assert_eq!(parse_history(raw), vec!["Get-Item \n  -Path x", "ls"]);
    }

    #[test]
    fn dedupe_keeps_last_occurrence() {
        let v: Vec<String> = ["a", "b", "a", "c"].iter().map(|s| s.to_string()).collect();
        assert_eq!(dedupe_preserving_last(&v), vec!["b", "a", "c"]);
    }
}
