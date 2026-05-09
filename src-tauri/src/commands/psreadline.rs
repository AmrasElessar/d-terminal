// PSReadLine ↔ D-Terminal komut geçmişi merge.
//
// PSReadLine geçmiş dosyası:
//   %APPDATA%\Microsoft\Windows\PowerShell\PSReadLine\ConsoleHost_history.txt
//
// Format: her satır bir komut (multiline `<#`/`#>` blokları yok sayılır).
// İçe aktarma sırasında:
//   - Boş satır ve sadece-whitespace atlanır
//   - D-Terminal history'sinde *son N* komutla karşılaştırılır; aynı string
//     varsa atlanır (basit dedupe)
//   - `pane_type` = "powershell" olarak yazılır

use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::history::{HistoryQuery, NewHistoryEntry};
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

#[tauri::command]
pub fn psreadline_import(state: State<'_, AppState>) -> AppResult<ImportSummary> {
    let path = psreadline_history_path()?;
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

    let candidates: Vec<&str> = raw
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect();

    // Mevcut son 500 D-Terminal komutuyla karşılaştır (dedupe penceresi)
    let recent = state.storage.history.search(HistoryQuery {
        text: None,
        pane_id: None,
        limit: Some(500),
        favorites_only: false,
    })?;
    let recent_set: std::collections::HashSet<&str> =
        recent.iter().map(|e| e.command.as_str()).collect();

    // Bulk insert: dedupe sonrası kalan satırları tek transaction'da yaz.
    // 5000 satırlı PSReadLine'da 5000 ayrı pool.get() + INSERT + WAL fsync
    // (~30sn) yerine tek transaction (<1sn). Audit Rust-perf O3.
    let mut to_insert: Vec<NewHistoryEntry> = Vec::new();
    let mut skipped_duplicates = 0usize;
    for cmd in &candidates {
        if recent_set.contains(cmd) {
            skipped_duplicates += 1;
            continue;
        }
        to_insert.push(NewHistoryEntry {
            command: (*cmd).to_string(),
            pane_id: None,
            pane_type: Some("powershell".into()),
            exit_code: None,
            duration_ms: None,
        });
    }
    let imported = state.storage.history.add_bulk(&to_insert)?;

    Ok(ImportSummary {
        imported,
        skipped_duplicates,
        source_lines: candidates.len(),
        source_path: path.to_string_lossy().into_owned(),
    })
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
