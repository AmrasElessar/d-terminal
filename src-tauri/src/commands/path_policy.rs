// Ortak path doğrulama politikası.
//
// Webview'dan gelen path'ler (git cwd, log dosyası, snapshot hedefi, tema adı)
// eskiden her komutta farklı kurallarla ayrı ayrı kontrol ediliyordu. Kurallar:
//
//   1. UNC / device namespace (`\\server\share`, `//server`, `\\?\`, `\\.\`,
//      `\??\`) reddedilir — dosya sistemine DOKUNMADAN önce. `exists()` bile
//      bir UNC path için SMB bağlantısı açar ve Windows NTLM hash'ini uzak
//      sunucuya gönderir.
//   2. `..` segmenti reddedilir (lexical traversal).
//   3. Canonical path (`std::fs::canonicalize` — junction/symlink çözülmüş)
//      ağ sürücüsünü işaret ediyorsa reddedilir. Windows'ta eşlenmiş ağ
//      sürücüsü (`Z:\`) canonicalize sonrası `\\?\UNC\server\share\...` olur.

use crate::error::{AppError, AppResult};
use std::path::{Component, Path, PathBuf};

/// Kural 1: UNC / device-namespace string'i mi? Saf string kontrolü — FS'e dokunmaz.
pub fn is_unc_or_device(path: &str) -> bool {
    let p = path.trim_start();
    p.starts_with(r"\\")
        || p.starts_with("//")
        || p.starts_with(r"\??\")
        || p.starts_with(r"/??/")
        || p.starts_with(r"\/")
        || p.starts_with(r"/\")
}

pub fn reject_unc(path: &str) -> AppResult<()> {
    if is_unc_or_device(path) {
        return Err(AppError::InvalidArg("UNC/device path not allowed".into()));
    }
    Ok(())
}

/// Kural 2.
pub fn reject_parent_dir(path: &Path) -> AppResult<()> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(AppError::InvalidArg("'..' path components not allowed".into()));
    }
    Ok(())
}

/// Canonical path ağ konumu mu (`\\?\UNC\...` veya düz UNC)?
pub fn is_network_canonical(canonical: &Path) -> bool {
    let s = canonical.to_string_lossy();
    s.starts_with(r"\\?\UNC\") || (s.starts_with(r"\\") && !s.starts_with(r"\\?\"))
}

/// Kural 1 + 2 + 3: path'i yerel, var olan, canonical bir path'e çevirir.
/// Kural 1 ve 2 FS'e dokunmadan önce uygulanır.
pub fn canonical_local(path: &str) -> AppResult<PathBuf> {
    if path.is_empty() {
        return Err(AppError::InvalidArg("empty path".into()));
    }
    reject_unc(path)?;
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err(AppError::InvalidArg("path must be absolute".into()));
    }
    reject_parent_dir(p)?;
    let canon = p.canonicalize()?;
    if is_network_canonical(&canon) {
        return Err(AppError::InvalidArg("network drive not allowed".into()));
    }
    Ok(canon)
}

/// Windows `\\?\C:\x` verbatim önekini kaldırır — kullanıcı-dostu karşılaştırma
/// ve denylist eşleşmesi için. Diğer platformlarda no-op.
pub fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

/// Windows ayrılmış aygıt adı mı (`CON`, `NUL`, `COM1`, `LPT9`, `CON.txt` …)?
/// Bu adlarla dosya oluşturmak aygıta yazar / hata verir.
pub fn is_windows_reserved_name(name: &str) -> bool {
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$")
        || ((stem.starts_with("COM") || stem.starts_with("LPT"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_unc_and_device_forms() {
        for p in [
            r"\\attacker\share\x",
            "//attacker/share",
            r"\\?\C:\x",
            r"\\.\pipe\x",
            r"\??\UNC\host\share",
            r"\/host/share",
        ] {
            assert!(is_unc_or_device(p), "{p}");
        }
        assert!(!is_unc_or_device(r"C:\Users\x"));
        assert!(!is_unc_or_device("/home/x"));
    }

    #[test]
    fn rejects_parent_dir() {
        assert!(reject_parent_dir(Path::new("/a/../b")).is_err());
        assert!(reject_parent_dir(Path::new("/a/my..file.log")).is_ok());
    }

    #[test]
    fn network_canonical_detection() {
        assert!(is_network_canonical(Path::new(r"\\?\UNC\srv\share\x")));
        assert!(is_network_canonical(Path::new(r"\\srv\share\x")));
        assert!(!is_network_canonical(Path::new(r"\\?\C:\x")));
        assert!(!is_network_canonical(Path::new("/home/x")));
    }

    #[test]
    fn canonical_local_rejects_relative_and_unc_without_fs() {
        assert!(canonical_local("relative/path").is_err());
        assert!(canonical_local(r"\\attacker\share").is_err());
        assert!(canonical_local("").is_err());
    }

    #[test]
    fn canonical_local_accepts_existing_dir() {
        let tmp = std::env::temp_dir();
        assert!(canonical_local(&tmp.to_string_lossy()).is_ok());
    }

    #[test]
    fn reserved_names() {
        for n in ["CON", "con", "NUL.json", "com1", "LPT9.txt", "aux "] {
            assert!(is_windows_reserved_name(n), "{n}");
        }
        for n in ["console", "com10", "nul_theme", "my-theme"] {
            assert!(!is_windows_reserved_name(n), "{n}");
        }
    }

    #[test]
    fn strip_verbatim_prefix() {
        assert_eq!(strip_verbatim(Path::new(r"\\?\C:\x")), PathBuf::from(r"C:\x"));
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\s\x")),
            PathBuf::from(r"\\?\UNC\s\x")
        );
    }
}
