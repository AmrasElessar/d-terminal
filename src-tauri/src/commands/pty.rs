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

/// İzin verilen shell binary'leri — dosya adı (path leaf) bazlı.
///
/// Leaf kontrolü tek başına yeterli değildir (`\\attacker\share\cmd.exe`
/// leaf olarak geçer); bu yüzden `resolve_shell` ayrıca UNC/device yollarını
/// reddeder ve çıplak isimleri sunucu tarafında bilinen konumlara çözer —
/// CreateProcess'in çalışma dizinini de arayan arama sırasına bırakılmaz.
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
/// `PATH`/`PATHEXT` override'ı yan-yana binary substitution sağlar; PowerShell
/// execution policy override'ı script signing kontrolünü atlar; `COMSPEC`
/// `start`/`call` çağrılarında shell'i değiştirir; `COR_*`/`CORECLR_*`/
/// `DOTNET_STARTUP_HOOKS` .NET (PowerShell) içine DLL enjekte eder;
/// `__COMPAT_LAYER` uyumluluk shim'i uygular; `BASH_ENV`/`ENV` bash/sh
/// başlangıcında dosya çalıştırır; `NODE_OPTIONS` `--require` ile kod yükler.
/// Bu key'ler frontend üzerinden override edilemez (proses kendi env'ini
/// parent'tan alır).
const BLOCKED_ENV_KEYS: &[&str] = &[
    "PATH",
    "PATHEXT",
    "COMSPEC",
    "PSMODULEPATH",
    "PSEXECUTIONPOLICYPREFERENCE",
    "WSLENV",
    "SYSTEMROOT",
    "WINDIR",
    "__COMPAT_LAYER",
    "BASH_ENV",
    "ENV",
    "PROMPT_COMMAND",
    "NODE_OPTIONS",
    "PYTHONSTARTUP",
    "PERL5OPT",
];

/// Prefix bazlı engellenen env key aileleri.
const BLOCKED_ENV_PREFIXES: &[&str] = &["COR_", "CORECLR_", "DOTNET_", "LD_", "DYLD_"];

/// `C:\...` / `C:/...` biçiminde sürücü harfli mutlak yol mu.
fn is_windows_abs(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/')
}

/// UNC (`\\server\share`, `//server`) veya device namespace (`\\?\`, `\\.\`,
/// `\??\`) yolu mu.
fn is_unc_or_device(s: &str) -> bool {
    s.starts_with(r"\\") || s.starts_with("//") || s.starts_with(r"\??\") || s.starts_with("/??/")
}

/// `.` / `..` segmenti içeriyor mu (normalize edilmemiş yol).
fn has_dot_segments(s: &str) -> bool {
    s.split(['\\', '/']).any(|seg| seg == ".." || seg == ".")
}

fn path_leaf(s: &str) -> &str {
    s.rsplit(['\\', '/']).next().unwrap_or(s)
}

fn is_allowed_leaf(leaf: &str) -> bool {
    ALLOWED_SHELL_LEAFS
        .iter()
        .any(|allowed| allowed.eq_ignore_ascii_case(leaf))
}

/// Çıplak shell adını verilen dizinlerde arar (ilk eşleşme kazanır).
#[cfg_attr(not(windows), allow(dead_code))]
fn resolve_bare(leaf: &str, dirs: &[String], exists: impl Fn(&str) -> bool) -> Option<String> {
    dirs.iter()
        .map(|d| format!("{}\\{}", d.trim_end_matches(['\\', '/']), leaf))
        .find(|candidate| exists(candidate))
}

/// Çıplak shell isimleri için güvenilir arama dizinleri: önce sistem
/// konumları, sonra PATH'teki yalnızca yerel, mutlak dizinler. Çalışma dizini
/// hiçbir zaman aranmaz.
#[cfg(windows)]
fn shell_search_dirs() -> Vec<String> {
    let mut dirs = Vec::new();
    let env = |k: &str| std::env::var(k).ok().filter(|v| is_windows_abs(v));
    if let Some(root) = env("SystemRoot") {
        dirs.push(format!(r"{root}\System32"));
        dirs.push(format!(r"{root}\System32\WindowsPowerShell\v1.0"));
    }
    for pf in [env("ProgramW6432"), env("ProgramFiles")]
        .into_iter()
        .flatten()
    {
        dirs.push(format!(r"{pf}\PowerShell\7"));
        dirs.push(format!(r"{pf}\Git\bin"));
        dirs.push(format!(r"{pf}\Git"));
    }
    if let Some(local) = env("LOCALAPPDATA") {
        dirs.push(format!(r"{local}\Microsoft\WindowsApps"));
    }
    if let Some(path) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&path) {
            if let Some(s) = p.to_str() {
                if is_windows_abs(s) && !has_dot_segments(s) {
                    dirs.push(s.to_string());
                }
            }
        }
    }
    dirs
}

/// Shell argümanını doğrular ve spawn edilecek yola çözer.
///
/// - Boş, UNC/device, göreli-ama-ayraçlı (`.\cmd.exe`), `..` içeren yollar
///   reddedilir.
/// - Leaf allowlist'te olmalı.
/// - Çıplak isim (`pwsh.exe`) Windows'ta güvenilir dizinlerde aranıp mutlak
///   yola çevrilir; bulunamazsa hata.
/// - Mutlak yol Windows'ta var olan bir dosya olmalı.
fn resolve_shell(shell: &str) -> AppResult<String> {
    let shell = shell.trim();
    if shell.is_empty() {
        return Err(AppError::InvalidArg("shell: empty".into()));
    }
    if is_unc_or_device(shell) {
        return Err(AppError::InvalidArg(
            "shell: UNC/device path not allowed".into(),
        ));
    }
    let leaf = path_leaf(shell);
    if !is_allowed_leaf(leaf) {
        return Err(AppError::InvalidArg(format!("shell not allowed: {leaf}")));
    }
    if shell.contains(['\\', '/']) {
        let absolute =
            is_windows_abs(shell) || (cfg!(not(windows)) && Path::new(shell).is_absolute());
        if !absolute {
            return Err(AppError::InvalidArg("shell: path must be absolute".into()));
        }
        if has_dot_segments(shell) {
            return Err(AppError::InvalidArg(
                "shell: path must be normalized".into(),
            ));
        }
        #[cfg(windows)]
        if !Path::new(shell).is_file() {
            return Err(AppError::InvalidArg(format!("shell not found: {shell}")));
        }
        return Ok(shell.to_string());
    }
    #[cfg(windows)]
    {
        resolve_bare(leaf, &shell_search_dirs(), |p| Path::new(p).is_file())
            .ok_or_else(|| AppError::InvalidArg(format!("shell not found: {leaf}")))
    }
    #[cfg(not(windows))]
    {
        Ok(shell.to_string())
    }
}

fn validate_cwd(cwd: &str) -> AppResult<()> {
    // WSL dağıtımlarının dosya sistemi (\\wsl$\Ubuntu\..., \\wsl.localhost\...)
    // yerel bir 9P köprüsüdür — ağ üzerinden kimlik bilgisi sızdırmaz; izin ver.
    let lower = cwd.to_ascii_lowercase();
    if lower.starts_with(r"\\wsl$\") || lower.starts_with(r"\\wsl.localhost\") {
        if has_dot_segments(cwd) {
            return Err(AppError::InvalidArg("cwd: path must be normalized".into()));
        }
        return Ok(());
    }
    // Diğer UNC/device yolları reddedilir — \\attacker\share\... saldırı vektörü.
    if is_unc_or_device(cwd) {
        return Err(AppError::InvalidArg("cwd: UNC path not allowed".into()));
    }
    if !(is_windows_abs(cwd) || Path::new(cwd).is_absolute()) {
        return Err(AppError::InvalidArg("cwd: must be absolute path".into()));
    }
    Ok(())
}

fn validate_env(env: &[(String, String)]) -> AppResult<()> {
    for (k, v) in env {
        // Boş veya `=` / NUL içeren key'ler shell parsing hatası tetikler.
        if k.is_empty() || k.contains('=') || k.contains('\0') || v.contains('\0') {
            return Err(AppError::InvalidArg(format!("env key invalid: {k:?}")));
        }
        let upper = k.to_ascii_uppercase();
        if BLOCKED_ENV_KEYS.contains(&upper.as_str())
            || BLOCKED_ENV_PREFIXES.iter().any(|p| upper.starts_with(p))
        {
            return Err(AppError::InvalidArg(format!("env key not allowed: {k}")));
        }
    }
    Ok(())
}

fn parse_pane_id(pane_id: &str) -> AppResult<u64> {
    pane_id
        .parse()
        .map_err(|_| AppError::InvalidArg("pane_id".into()))
}

/// Async: sidecar başlatma (process spawn + eski thread join) UI thread'ini
/// bloklamasın diye blocking havuzunda çalışır.
#[tauri::command]
pub async fn pty_spawn(state: State<'_, AppState>, args: SpawnArgs) -> AppResult<String> {
    let shell = resolve_shell(&args.shell)?;
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
        shell,
        args: args.args,
        cwd,
        env: args.env,
        cols: args.cols,
        rows: args.rows,
    };
    let sidecar = state.sidecar.clone();
    let id = tauri::async_runtime::spawn_blocking(move || sidecar.spawn_pane(payload))
        .await
        .map_err(|e| AppError::Internal(format!("spawn task failed: {e}")))??;
    Ok(id.to_string())
}

/// Sync ama non-blocking: frame writer kuyruğuna eklenir. Sync command'lar
/// çağrı sırasıyla çalıştığı için tuş vuruşlarının sırası korunur (async
/// command'lar runtime'da yeniden sıralanabilirdi).
#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, pane_id: String, data: Vec<u8>) -> AppResult<()> {
    state.sidecar.write_stdin(parse_pane_id(&pane_id)?, &data)
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u16,
    rows: u16,
) -> AppResult<()> {
    if cols == 0 || rows == 0 {
        return Err(AppError::InvalidArg("cols/rows must be > 0".into()));
    }
    state.sidecar.resize(parse_pane_id(&pane_id)?, cols, rows)
}

#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, pane_id: String) -> AppResult<()> {
    state.sidecar.kill(parse_pane_id(&pane_id)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exists_in(set: &'static [&'static str]) -> impl Fn(&str) -> bool {
        move |p| set.iter().any(|s| s.eq_ignore_ascii_case(p))
    }

    #[test]
    fn resolve_shell_rejects_unknown_and_unc() {
        assert!(resolve_shell("payload.exe").is_err());
        assert!(resolve_shell(r"\\attacker\share\evil.exe").is_err());
        assert!(resolve_shell(r"\\attacker\share\cmd.exe").is_err());
        assert!(resolve_shell("//attacker/share/cmd.exe").is_err());
        assert!(resolve_shell(r"\\?\C:\Windows\System32\cmd.exe").is_err());
        assert!(resolve_shell(r"\??\C:\Windows\System32\cmd.exe").is_err());
        assert!(resolve_shell("calc.exe").is_err());
        assert!(resolve_shell("").is_err());
    }

    #[test]
    fn resolve_shell_rejects_relative_and_dotted_paths() {
        assert!(resolve_shell(r".\cmd.exe").is_err());
        assert!(resolve_shell(r"tools\cmd.exe").is_err());
        assert!(resolve_shell(r"C:\Windows\..\Users\x\cmd.exe").is_err());
    }

    #[cfg(not(windows))]
    #[test]
    fn resolve_shell_accepts_known_names() {
        assert_eq!(resolve_shell("powershell.exe").unwrap(), "powershell.exe");
        assert_eq!(resolve_shell("PowerShell.EXE").unwrap(), "PowerShell.EXE");
        assert!(resolve_shell(r"C:\Windows\System32\cmd.exe").is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn resolve_shell_resolves_cmd_to_absolute_path() {
        let resolved = resolve_shell("cmd.exe").unwrap();
        assert!(is_windows_abs(&resolved), "{resolved}");
        assert!(resolved.to_ascii_lowercase().ends_with(r"\cmd.exe"));
    }

    #[test]
    fn resolve_bare_prefers_first_trusted_dir() {
        const FILES: &[&str] = &[
            r"C:\Windows\System32\bash.exe",
            r"C:\Program Files\Git\bin\bash.exe",
        ];
        let dirs = vec![
            r"C:\Windows\System32".to_string(),
            r"C:\Program Files\Git\bin\".to_string(),
        ];
        assert_eq!(
            resolve_bare("bash.exe", &dirs, exists_in(FILES)).as_deref(),
            Some(r"C:\Windows\System32\bash.exe")
        );
        assert_eq!(resolve_bare("pwsh.exe", &dirs, exists_in(FILES)), None);
    }

    #[test]
    fn validate_cwd_rejects_unc_and_relative() {
        assert!(validate_cwd(r"\\server\share").is_err());
        assert!(validate_cwd("//unix-style").is_err());
        assert!(validate_cwd(r"\\?\C:\x").is_err());
        assert!(validate_cwd("relative/path").is_err());
        assert!(validate_cwd(r"C:\Users\Engin").is_ok());
    }

    #[test]
    fn validate_cwd_allows_wsl_shares() {
        assert!(validate_cwd(r"\\wsl$\Ubuntu\home\me").is_ok());
        assert!(validate_cwd(r"\\wsl.localhost\Ubuntu\home").is_ok());
        assert!(validate_cwd(r"\\WSL$\Ubuntu\..\..\attacker").is_err());
    }

    #[test]
    fn validate_env_blocks_path_overrides() {
        assert!(validate_env(&[("PATH".into(), "x".into())]).is_err());
        assert!(validate_env(&[("path".into(), "x".into())]).is_err());
        assert!(validate_env(&[("PSExecutionPolicyPreference".into(), "Bypass".into())]).is_err());
        assert!(validate_env(&[("MY_VAR".into(), "ok".into())]).is_ok());
    }

    #[test]
    fn validate_env_blocks_injection_families() {
        for key in [
            "COR_ENABLE_PROFILING",
            "COR_PROFILER_PATH",
            "CORECLR_PROFILER_PATH",
            "DOTNET_STARTUP_HOOKS",
            "__COMPAT_LAYER",
            "BASH_ENV",
            "ENV",
            "NODE_OPTIONS",
            "LD_PRELOAD",
        ] {
            assert!(validate_env(&[(key.into(), "x".into())]).is_err(), "{key}");
        }
    }

    #[test]
    fn validate_env_rejects_malformed_keys() {
        assert!(validate_env(&[("".into(), "x".into())]).is_err());
        assert!(validate_env(&[("KEY=BAD".into(), "x".into())]).is_err());
        assert!(validate_env(&[("KEY".into(), "a\0b".into())]).is_err());
    }
    /// Windows'ta gerçek dosya sistemi: çıplak isimler System32'deki gerçek
    /// yollara çözülür, cwd'deki aynı isimli dosya hiç aranmaz.
    #[cfg(windows)]
    #[test]
    fn resolve_shell_real_windows_paths() {
        let root = std::env::var("SystemRoot")
            .unwrap_or_else(|_| r"C:\Windows".into())
            .to_ascii_lowercase();
        let cmd = resolve_shell("cmd.exe").unwrap().to_ascii_lowercase();
        assert_eq!(cmd, format!(r"{root}\system32\cmd.exe"));
        let ps = resolve_shell("powershell.exe")
            .unwrap()
            .to_ascii_lowercase();
        assert!(
            ps.starts_with(&root) && ps.ends_with(r"\powershell.exe"),
            "{ps}"
        );
        assert!(Path::new(&ps).is_file());
        assert!(resolve_shell(r"\\attacker\share\cmd.exe").is_err());
        assert!(resolve_shell(r"C:\Users\Public\nope\cmd.exe").is_err());
    }
}
