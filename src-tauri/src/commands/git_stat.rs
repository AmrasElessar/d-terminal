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

use serde::Serialize;
use std::path::Path;
use std::process::Command;

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
pub async fn git_diff_shortstat(path: String) -> GitStat {
    // tokio task üzerinde spawn — git binary'si büyük repolarda 100ms+ sürebilir,
    // Tauri main thread'i bloklamasın
    tokio::task::spawn_blocking(move || run_git_diff(&path))
        .await
        .unwrap_or_default()
}

fn run_git_diff(path: &str) -> GitStat {
    // Önce path'in geçerli olduğunu doğrula
    if path.is_empty() || !std::path::Path::new(path).exists() {
        return GitStat::default();
    }
    // UNC path reddedilir — \\attacker\share\.git\config saldırısını engeller
    // (rogue config core.fsmonitor/core.editor üzerinden RCE — CVE-2022-24765
    // sınıfı zafiyet ailesi).
    if path.starts_with(r"\\") || path.starts_with("//") {
        return GitStat::default();
    }

    // git diff --shortstat HEAD — staged + unstaged + untracked HARİÇ
    // Untracked dosyaları da dahil etmek için ayrı `git status --short` lazım,
    // şimdilik sadece tracked diff yeterli (Claude Code mevcut dosyaları edit eder).
    let mut cmd = Command::new("git");
    cmd.args(["-C", path, "diff", "--shortstat", "HEAD"]);
    // Windows'ta git çağrısı için stdin'i /dev/null'a yönlendir — interaktif
    // promp olmasın (örn. credential prompt).
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    // Güvenlik sertleştirmesi (CVE-2022-24765 ailesine karşı):
    //   - GIT_TERMINAL_PROMPT=0  : credential prompt blocked (zaten stdin null)
    //   - GIT_CONFIG_NOSYSTEM=1  : /etc/gitconfig bypass — yan-binary substitution kapanır
    //   - GIT_CONFIG_GLOBAL=NUL  : ~/.gitconfig override (rogue user-level config)
    //   - safe.directory=*       : "dubious ownership" sorununu sessiz çöz
    //   - core.fsmonitor=        : rogue fsmonitor binary çalıştırılmasını engelle
    //   - core.sshCommand=       : rogue ssh komutu çağrılmasın
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_CONFIG_NOSYSTEM", "1");
    cmd.env("GIT_CONFIG_GLOBAL", "NUL");
    cmd.env("GIT_CONFIG_COUNT", "3");
    cmd.env("GIT_CONFIG_KEY_0", "safe.directory");
    cmd.env("GIT_CONFIG_VALUE_0", "*");
    cmd.env("GIT_CONFIG_KEY_1", "core.fsmonitor");
    cmd.env("GIT_CONFIG_VALUE_1", "");
    cmd.env("GIT_CONFIG_KEY_2", "core.sshCommand");
    cmd.env("GIT_CONFIG_VALUE_2", "");

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
    let mut stat = parse_shortstat(&text);

    // Untracked dosyalar — `git diff --shortstat` bunları görmez. Yeni eklenmiş
    // dosyaların satır sayısını added'a ekleriz, dosya sayısını files'a.
    let untracked = collect_untracked(path);
    stat.files = stat.files.saturating_add(untracked.file_count);
    stat.added = stat.added.saturating_add(untracked.line_count);

    stat
}

#[derive(Default)]
struct UntrackedSummary {
    file_count: u32,
    line_count: u32,
}

fn collect_untracked(repo_path: &str) -> UntrackedSummary {
    let mut cmd = Command::new("git");
    cmd.args([
        "-C",
        repo_path,
        "ls-files",
        "--others",
        "--exclude-standard",
    ]);
    cmd.stdin(std::process::Stdio::null());
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::null());
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd.env("GIT_CONFIG_NOSYSTEM", "1");
    cmd.env("GIT_CONFIG_GLOBAL", "NUL");
    cmd.env("GIT_CONFIG_COUNT", "1");
    cmd.env("GIT_CONFIG_KEY_0", "safe.directory");
    cmd.env("GIT_CONFIG_VALUE_0", "*");

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
    fn empty_diff_means_clean_repo() {
        let s = parse_shortstat("");
        assert_eq!(s.files, 0);
        assert_eq!(s.added, 0);
        assert!(s.is_repo);
    }
}
