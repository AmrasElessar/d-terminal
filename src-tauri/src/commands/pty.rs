// Pane / PTY komutları. Sidecar manager'a delege eder.

use crate::error::{AppError, AppResult};
use crate::sidecar::protocol::SpawnPayload;
use crate::state::AppState;
use serde::Deserialize;
use std::path::Path;
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

/// Whitelisted shell binary'leri — dosya adı (path leaf) bazlı.
///
/// Frontend XSS post-compromise senaryosunda saldırgan `pty_spawn`'ı
/// `shell="\\\\attacker\\share\\payload.exe"` gibi değerle çağırarak remote
/// code execution zinciri kurabilir. Bu liste yalnızca tanınmış Windows
/// shell'lerine izin verir; diğer her path AppError::InvalidArg ile reddedilir.
const ALLOWED_SHELL_LEAFS: &[&str] = &[
    "powershell.exe",
    "pwsh.exe",
    "cmd.exe",
    "wsl.exe",
    "bash.exe",
    "git-bash.exe",
];

/// Env key blacklist — shell process injection vektörlerini kapatır.
///
/// `PATH`/`PATHEXT` override'ı yan-yan binary substitution sağlar; PowerShell
/// execution policy override'ı script signing kontrolünü atlar; `COMSPEC`
/// `start`/`call` çağrılarında shell'i değiştirir. Bu key'ler frontend
/// üzerinden override edilemez (proses kendi env'ini parent'tan alır).
const BLOCKED_ENV_KEYS: &[&str] = &[
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "PSMODULEPATH",
    "PSEXECUTIONPOLICYPREFERENCE",
    "WSLENV",
];

fn validate_shell(shell: &str) -> AppResult<()> {
    let leaf = Path::new(shell)
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::InvalidArg("shell: invalid path".into()))?;
    if !ALLOWED_SHELL_LEAFS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(leaf))
    {
        return Err(AppError::InvalidArg(format!("shell not allowed: {leaf}")));
    }
    Ok(())
}

fn validate_cwd(cwd: &str) -> AppResult<()> {
    // UNC path reddedilir — \\attacker\share\... saldırı vektörü.
    if cwd.starts_with(r"\\") || cwd.starts_with("//") {
        return Err(AppError::InvalidArg("cwd: UNC path not allowed".into()));
    }
    let p = Path::new(cwd);
    if !p.is_absolute() {
        return Err(AppError::InvalidArg("cwd: must be absolute path".into()));
    }
    Ok(())
}

fn validate_env(env: &[(String, String)]) -> AppResult<()> {
    for (k, _) in env {
        // Boş veya `=` içeren key'ler shell parsing hatası tetikler.
        if k.is_empty() || k.contains('=') {
            return Err(AppError::InvalidArg(format!("env key invalid: {k:?}")));
        }
        let upper = k.to_ascii_uppercase();
        if BLOCKED_ENV_KEYS.contains(&upper.as_str()) {
            return Err(AppError::InvalidArg(format!("env key not allowed: {k}")));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn pty_spawn(state: State<'_, AppState>, args: SpawnArgs) -> AppResult<String> {
    validate_shell(&args.shell)?;
    if let Some(cwd) = args.cwd.as_deref() {
        if !cwd.is_empty() {
            validate_cwd(cwd)?;
        }
    }
    validate_env(&args.env)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_shell_accepts_known() {
        assert!(validate_shell("powershell.exe").is_ok());
        assert!(validate_shell("C:\\Windows\\System32\\cmd.exe").is_ok());
        assert!(validate_shell("PowerShell.EXE").is_ok()); // case-insensitive
        assert!(validate_shell("wsl.exe").is_ok());
    }

    #[test]
    fn validate_shell_rejects_unknown() {
        assert!(validate_shell("payload.exe").is_err());
        assert!(validate_shell(r"\\attacker\share\evil.exe").is_err());
        assert!(validate_shell("calc.exe").is_err());
        assert!(validate_shell("").is_err());
    }

    #[test]
    fn validate_cwd_rejects_unc_and_relative() {
        assert!(validate_cwd(r"\\server\share").is_err());
        assert!(validate_cwd("//unix-style").is_err());
        assert!(validate_cwd("relative/path").is_err());
        assert!(validate_cwd(r"C:\Users\Engin").is_ok());
    }

    #[test]
    fn validate_env_blocks_path_overrides() {
        assert!(validate_env(&[("PATH".into(), "x".into())]).is_err());
        assert!(validate_env(&[("path".into(), "x".into())]).is_err());
        assert!(validate_env(&[("PSExecutionPolicyPreference".into(), "Bypass".into())]).is_err());
        assert!(validate_env(&[("MY_VAR".into(), "ok".into())]).is_ok());
    }

    #[test]
    fn validate_env_rejects_malformed_keys() {
        assert!(validate_env(&[("".into(), "x".into())]).is_err());
        assert!(validate_env(&[("KEY=BAD".into(), "x".into())]).is_err());
    }
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
