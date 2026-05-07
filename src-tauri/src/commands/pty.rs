// Pane / PTY komutları. Sidecar manager'a delege eder.

use crate::error::AppResult;
use crate::sidecar::protocol::SpawnPayload;
use crate::state::AppState;
use serde::Deserialize;
use tauri::State;

#[derive(Debug, Deserialize)]
pub struct SpawnArgs {
    pub shell: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: Vec<(String, String)>,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub fn pty_spawn(state: State<'_, AppState>, args: SpawnArgs) -> AppResult<String> {
    // Profile cwd boşsa kullanıcının home dizini ile başlat — Windows
    // PowerShell/CMD'in default davranışı (C:\Users\<name>). Aksi halde PTY
    // parent process'in cwd'sini miras alırdı (dev mode'da repo dizini).
    let cwd = args
        .cwd
        .filter(|s| !s.is_empty())
        .or_else(|| dirs::home_dir().and_then(|p| p.to_str().map(|s| s.to_string())));
    let payload = SpawnPayload {
        shell: args.shell,
        args: args.args,
        cwd,
        env: args.env,
        cols: args.cols,
        rows: args.rows,
    };
    let id = state.sidecar.spawn_pane(payload)?;
    Ok(id.to_string())
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, pane_id: String, data: Vec<u8>) -> AppResult<()> {
    let id: u64 = pane_id
        .parse()
        .map_err(|_| crate::error::AppError::InvalidArg("pane_id".into()))?;
    state.sidecar.write_stdin(id, &data)
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    let id: u64 = pane_id
        .parse()
        .map_err(|_| crate::error::AppError::InvalidArg("pane_id".into()))?;
    state.sidecar.resize(id, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, pane_id: String) -> AppResult<()> {
    let id: u64 = pane_id
        .parse()
        .map_err(|_| crate::error::AppError::InvalidArg("pane_id".into()))?;
    state.sidecar.kill(id)
}
