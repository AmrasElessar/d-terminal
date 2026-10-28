// Git diff shortstat — pane'in working directory'sinde uncommitted değişiklikleri
// say. Title bar'da "Δ +23 -8" chip'i için kullanılır.
//
// İki kaynak birleştirilir:
//   1. `git diff --shortstat HEAD` — tracked dosyaların staged + unstaged farkı
//   2. `git ls-files --others --exclude-standard` — untracked (yeni) dosyalar;
//      her dosyanın satır sayısı `added`'a eklenir, dosya sayısı `files`'a.
//
// Bu birleşim: kullanıcı yeni dosya ekleyince de chip görünür. Tracked-only
// `git diff --shortstat` untracked'ı kaçırırdı → "kod değişimi var ama chip
// görünmüyor" bug'ı (commit önce raporlanmış).
//
// Repo değilse veya değişiklik yoksa GitStat { 0, 0, 0 } döner — null değil
// ki frontend tutarlı state tutsun.

use crate::commands::path_policy;
use crate::error::AppResult;
use crate::process_jail::ProcessJail;
use crate::state::AppState;
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use tauri::State;

/// Untracked dosya başına okunan max byte (DoS guard — 100 MB log dosyasını
/// her 5 saniyede taramayalım). Üstü truncate edilir; line count tahminen
/// alt sınır olur ama chip "var" mesajı için yeterli.
const MAX_UNTRACKED_FILE_BYTES: u64 = 1024 * 1024;
/// Untracked dosya tarama tavanı — `node_modules` gibi git-ignore'a alınmamış
/// patolojik dizinlerde polling'i kilitlememesi için sert üst sınır.
const MAX_UNTRACKED_FILES: usize = 500;

#[derive(Debug, Default, Clone, Serialize)]
pub struct GitStat {
    pub files: u32,
    pub added: u32,
    pub removed: u32,
    /// Repo tespiti — false ise frontend chip'i gizler. Boş repo (değişiklik
    /// yok ama git tracked) → true + tüm sayılar 0.
    pub is_repo: bool,
}

#[tauri::command]
pub async fn git_diff_shortstat(state: State<'_, AppState>, path: String) -> AppResult<GitStat> {
    // Path doğrulaması FS'e dokunmadan ÖNCE: UNC / device path'te `exists()`
    // bile SMB bağlantısı açıp NTLM hash'ini uzak sunucuya gönderir (path,
    // terminal çıktısındaki güvenilmez OSC 7'den gelebilir). Canonical path ağ
    // sürücüsünü (eşlenmiş `Z:`) işaret ediyorsa da reddedilir.
    let Ok(canon) = path_policy::canonical_local(&path) else {
        return Ok(GitStat::default());
    };
    if !canon.is_dir() {
        return Ok(GitStat::default());
    }
    let path = path_policy::strip_verbatim(&canon)
        .to_string_lossy()
        .into_owned();

    let jail = state.jail.clone();
    // Önce repo config'i salt-okunur incele: filter driver tanımlı repo'larda
    // `git diff` worktree dosyalarını clean filter'dan geçirir — yani repo'nun
    // kendi config'indeki keyfi bir komutu çalıştırır. Bu repo'lar için chip
    // gösterilmez (güvenli taraf).
    let jail_cfg = jail.clone();
    let path_cfg = path.clone();
    let risky = tokio::task::spawn_blocking(move || repo_defines_filters(&jail_cfg, &path_cfg))
        .await
        .unwrap_or(true);
    if risky {
        return Ok(GitStat::default());
    }
    let jail_diff = jail.clone();
    let path_diff = path.clone();
    // İki git binary spawn'ı paralel — toplam latency max(diff, untracked).
    let diff_handle =
        tokio::task::spawn_blocking(move || run_git_diff_tracked(&jail_diff, &path_diff));
    let untracked_handle = tokio::task::spawn_blocking(move || collect_untracked(&jail, &path));

    let mut stat = diff_handle.await.unwrap_or_default();
    if !stat.is_repo {
        // diff fail (repo değil) → untracked sayımını yutmak doğru; spawn_blocking
        // worker thread'inde git yine sonlanır (sub-saniye). await ile drain.
        let _ = untracked_handle.await;
        return Ok(stat);
    }
    let untracked = untracked_handle.await.unwrap_or_default();
    stat.files = stat.files.saturating_add(untracked.file_count);
    stat.added = stat.added.saturating_add(untracked.line_count);
    Ok(stat)
}

/// Kullanıcı / sistem git config'ini yok sayan null cihaz.
#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";

/// Güvenilmeyen (başkasına ait / indirilmiş) bir repo üzerinde git çalıştırmak
/// için ortak sertleştirme. Repo'nun kendi `.git/config`'i hâlâ okunur; bu
/// yüzden komut çalıştırabilen config anahtarları burada etkisizleştirilir:
///   - GIT_TERMINAL_PROMPT=0 + stdin null : credential prompt yok
///   - GIT_CONFIG_NOSYSTEM / GLOBAL=null   : sistem/kullanıcı config'i okunmaz
///   - core.fsmonitor=false                : rogue fsmonitor hook'u devre dışı
///     (index okunurken çalışır — `ls-files` dahil)
///   - core.hooksPath=<null>               : hook dizini boş
///   - core.sshCommand / core.askPass / credential.helper boş
///   - diff.external boş (+ `--no-ext-diff --no-textconv` bayrakları)
///   - filter driver'lar: `repo_defines_filters` ile tespit edilip atlanır
///
/// `safe.directory=*` KULLANILMAZ: git'in CVE-2022-24765 sahiplik kontrolü
/// (başka bir kullanıcının oluşturduğu `C:\.git` gibi) açık kalır; o
/// repo'larda git hata verir ve chip gizlenir.
fn harden_git(cmd: &mut Command) {
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_CONFIG_NOSYSTEM", "1");
    cmd.env("GIT_CONFIG_GLOBAL", NULL_DEVICE);
    cmd.env_remove("GIT_DIR");
    cmd.env_remove("GIT_WORK_TREE");
    cmd.env_remove("GIT_EXTERNAL_DIFF");
    let overrides: [(&str, &str); 6] = [
        ("core.fsmonitor", "false"),
        ("core.hooksPath", NULL_DEVICE),
        ("core.sshCommand", ""),
        ("core.askPass", ""),
        ("credential.helper", ""),
        ("diff.external", ""),
    ];
    cmd.env("GIT_CONFIG_COUNT", overrides.len().to_string());
    for (i, (k, v)) in overrides.iter().enumerate() {
        cmd.env(format!("GIT_CONFIG_KEY_{i}"), k);
        cmd.env(format!("GIT_CONFIG_VALUE_{i}"), v);
    }
}

/// Repo'nun etkin config'i (include'lar dahil) filter driver tanımlıyor mu?
/// `git config` yalnızca okur, hiçbir şey çalıştırmaz. Hata → güvenli taraf (true).
fn repo_defines_filters(jail: &Arc<ProcessJail>, path: &str) -> bool {
    let mut cmd = Command::new("git");
    cmd.args([
        "-C",
        path,
        "config",
        "--name-only",
        "--get-regexp",
        r"^filter\.",
    ]);
    jail.configure_command(&mut cmd);
    harden_git(&mut cmd);
    match cmd.output() {
        Ok(o) => filter_check_verdict(o.status.code(), &o.stdout),
        // git binary yok → diff de çalışmayacak; zararsız
        Err(_) => false,
    }
}

/// `git config --get-regexp` çıkış kodu → "riskli mi?" kararı.
fn filter_check_verdict(code: Option<i32>, stdout: &[u8]) -> bool {
    match code {
        // 1 = eşleşme yok
        Some(1) => false,
        Some(0) => !stdout.iter().all(u8::is_ascii_whitespace),
        // repo değil / dubious ownership → diff de başarısız olur; zararsız
        Some(128) => false,
        _ => true,
    }
}

/// Sadece tracked (staged + unstaged) farkı — `git diff --shortstat HEAD`.
/// Untracked dosyalar `collect_untracked` ile ayrı spawn'da paralel toplanır
/// (bkz. `git_diff_shortstat`). Bu fonksiyon başlı başına untracked dahil
/// etmez — caller iki sonucu birleştirir.
fn run_git_diff_tracked(jail: &Arc<ProcessJail>, path: &str) -> GitStat {
    let mut cmd = Command::new("git");
    cmd.args([
        "-C",
        path,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--shortstat",
        "HEAD",
    ]);
    // ProcessJail: CREATE_NO_WINDOW — git binary console flash etmesin.
    jail.configure_command(&mut cmd);
    harden_git(&mut cmd);

    let output = match cmd.output() {
        Ok(o) => o,
        Err(_) => {
            // git binary yok → graceful fallback
            return GitStat::default();
        }
    };

    if !output.status.success() {
        // Repo değil (exit 128) → not-a-repo
        return GitStat::default();
    }

    let text = String::from_utf8_lossy(&output.stdout);
    parse_shortstat(&text)
}

#[derive(Default)]
struct UntrackedSummary {
    file_count: u32,
    line_count: u32,
}

fn collect_untracked(jail: &Arc<ProcessJail>, repo_path: &str) -> UntrackedSummary {
    let mut cmd = Command::new("git");
    cmd.args([
        "-C",
        repo_path,
        "ls-files",
        "--others",
        "--exclude-standard",
    ]);
    // ProcessJail: CREATE_NO_WINDOW. Sertleştirme run_git_diff_tracked ile
    // aynı — `ls-files` de index okurken core.fsmonitor hook'unu çalıştırır.
    jail.configure_command(&mut cmd);
    harden_git(&mut cmd);

    let output = match cmd.output() {
        Ok(o) if o.status.success() => o,
        _ => return UntrackedSummary::default(),
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let mut summary = UntrackedSummary::default();
    let repo = Path::new(repo_path);
    for line in text.lines().take(MAX_UNTRACKED_FILES) {
        let rel = line.trim();
        if rel.is_empty() {
            continue;
        }
        summary.file_count = summary.file_count.saturating_add(1);
        let abs = repo.join(rel);
        if let Ok(meta) = std::fs::metadata(&abs) {
            // Binary heuristic: 1 MB üstü dosyaları satır olarak saymayız —
            // muhtemelen log/binary, kod değişikliği değil.
            let len = meta.len();
            if len == 0 || len > MAX_UNTRACKED_FILE_BYTES {
                continue;
            }
        } else {
            continue;
        }
        if let Ok(content) = std::fs::read_to_string(&abs) {
            let lines = content.lines().count() as u32;
            summary.line_count = summary.line_count.saturating_add(lines);
        }
    }
    summary
}

/// "3 files changed, 47 insertions(+), 12 deletions(-)" format'ını parse eder.
fn parse_shortstat(text: &str) -> GitStat {
    let mut stat = GitStat {
        is_repo: true,
        ..Default::default()
    };
    let line = text.trim();
    if line.is_empty() {
        // Repo ama değişiklik yok
        return stat;
    }
    // Number-suffix ikilisi: " 47 insertions" → 47, suffix
    for part in line.split(',') {
        let part = part.trim();
        let mut it = part.split_whitespace();
        let num_str = match it.next() {
            Some(n) => n,
            None => continue,
        };
        let num: u32 = match num_str.parse() {
            Ok(n) => n,
            Err(_) => continue,
        };
        let kind = it.next().unwrap_or("");
        if kind.starts_with("file") {
            stat.files = num;
        } else if kind.starts_with("insertion") {
            stat.added = num;
        } else if kind.starts_with("deletion") {
            stat.removed = num;
        }
    }
    stat
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_shortstat() {
        let s = parse_shortstat(" 3 files changed, 47 insertions(+), 12 deletions(-)");
        assert_eq!(s.files, 3);
        assert_eq!(s.added, 47);
        assert_eq!(s.removed, 12);
        assert!(s.is_repo);
    }

    #[test]
    fn parses_only_deletions() {
        let s = parse_shortstat(" 1 file changed, 8 deletions(-)");
        assert_eq!(s.files, 1);
        assert_eq!(s.added, 0);
        assert_eq!(s.removed, 8);
    }

    #[test]
    fn parses_only_insertions() {
        let s = parse_shortstat(" 2 files changed, 15 insertions(+)");
        assert_eq!(s.files, 2);
        assert_eq!(s.added, 15);
        assert_eq!(s.removed, 0);
    }

    #[test]
    fn filter_check_verdicts() {
        assert!(!filter_check_verdict(Some(1), b""));
        assert!(filter_check_verdict(Some(0), b"filter.evil.clean\n"));
        assert!(!filter_check_verdict(Some(128), b""));
        assert!(filter_check_verdict(None, b""));
    }

    #[test]
    fn empty_diff_means_clean_repo() {
        let s = parse_shortstat("");
        assert_eq!(s.files, 0);
        assert_eq!(s.added, 0);
        assert!(s.is_repo);
    }
}
