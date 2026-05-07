// Git diff shortstat — pane'in working directory'sinde uncommitted değişiklikleri
// say. Title bar'da "Δ +23 -8" chip'i için kullanılır.
//
// `git diff --shortstat HEAD` parse edilir. HEAD'e karşı diff: index + working
// tree (staged + unstaged), ama henüz commit edilmemiş her şey dahil.
//
// Output formatı (örnek):
//   " 3 files changed, 47 insertions(+), 12 deletions(-)"
//   " 1 file changed, 8 deletions(-)"
//   " 2 files changed, 15 insertions(+)"
//
// Repo değilse veya değişiklik yoksa GitStat { 0, 0, 0 } döner — null değil
// ki frontend tutarlı state tutsun.

use serde::Serialize;
use std::process::Command;

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
