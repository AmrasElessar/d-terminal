// Tema dosyalarını dahili klasörden okuma + kullanıcı temaları için AppData.

use crate::commands::path_policy;
use crate::error::{run_blocking, AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct ThemeFile {
    pub name: String,
    pub path: String,
    pub content: String,
}

/// Async + blocking pool: dizin tarama ve dosya okuma UI thread'ini bloklamasın.
#[tauri::command]
pub async fn themes_list(app: tauri::AppHandle) -> AppResult<Vec<ThemeFile>> {
    run_blocking(move || themes_list_blocking(&app)).await
}

fn themes_list_blocking(app: &tauri::AppHandle) -> AppResult<Vec<ThemeFile>> {
    let mut out = Vec::new();
    // Bundled (resources/themes) — dev modunda repo'daki themes/ klasörü
    let bundled = bundled_themes_dir(app)?;
    if bundled.exists() {
        scan_dir(&bundled, &mut out)?;
    }
    // Kullanıcı temaları
    let user = user_themes_dir()?;
    if user.exists() {
        scan_dir(&user, &mut out)?;
    }
    Ok(out)
}

/// Kullanıcı teması dosya boyutu üst sınırı. Tipik tema JSON'u 5-20 KB; 256 KB
/// abartılı ama defansif. Saldırgan 1 GB tema yazıp diski dolduramasın (DoS).
const MAX_THEME_BYTES: usize = 256 * 1024;

/// Tema adı uzunluk sınırı (dosya adı + Windows MAX_PATH payı).
const MAX_THEME_NAME_CHARS: usize = 64;

/// Path traversal koruması — alphanumeric + - + _ dışındaki her şey sıyrılır;
/// `..`, `/`, `\` reddedilir. Windows aygıt adları (`CON`, `NUL`, `COM1` …)
/// ve `_` öneki (şablon dosyaları, listede gizli) reddedilir.
fn sanitize_theme_name(name: &str) -> AppResult<String> {
    let safe = name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(*c, '-' | '_'))
        .take(MAX_THEME_NAME_CHARS)
        .collect::<String>();
    if safe.is_empty() || safe.starts_with('_') || path_policy::is_windows_reserved_name(&safe) {
        return Err(AppError::InvalidArg("theme name".into()));
    }
    Ok(safe)
}

#[tauri::command]
pub async fn themes_save_user(name: String, content: String) -> AppResult<String> {
    run_blocking(move || save_user_blocking(&name, content)).await
}

fn save_user_blocking(name: &str, content: String) -> AppResult<String> {
    let safe = sanitize_theme_name(name)?;
    // Boyut sınırı
    if content.len() > MAX_THEME_BYTES {
        return Err(AppError::InvalidArg(format!(
            "theme too large: {} bytes (max {MAX_THEME_BYTES})",
            content.len()
        )));
    }
    // Şema doğrulaması — bozuk JSON yazılırsa downstream parse panik atabilir.
    // Tema struct'ı frontend'de validate ediliyor, biz minimum: parseable JSON.
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| AppError::InvalidArg(format!("theme content not valid JSON: {e}")))?;

    let dir = user_themes_dir()?;
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{safe}.json"));
    std::fs::write(&path, content)?;
    Ok(path.to_string_lossy().into_owned())
}

fn bundled_themes_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    // Dev: <project>/themes — cargo run sırasında cwd src-tauri olabilir, bir yukarı bak.
    // Yalnızca debug build: release'te cwd (ör. kullanıcının açtığı bir
    // klasör) tema kaynağı olmamalı — bundled temalar resource dir'den gelir.
    #[cfg(debug_assertions)]
    if let Ok(cwd) = std::env::current_dir() {
        for candidate in [cwd.join("themes"), cwd.join("..").join("themes")] {
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // Prod: Tauri resource path. Glob `../themes/*.json` config'i bundle'a
    // `_up_/themes/` altında yerleştiriyor (Tauri'nin parent-path notasyonu).
    // Eski layout `themes/` da fallback olarak destekleniyor.
    if let Ok(resolver) = app.path().resource_dir() {
        for candidate in [
            resolver.join("_up_").join("themes"),
            resolver.join("themes"),
        ] {
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }
    // Son çare: exe yanı
    Ok(std::env::current_exe()?
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("themes"))
}

fn user_themes_dir() -> AppResult<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| AppError::Internal("data_dir unresolved".into()))?;
    Ok(base.join("D-Terminal").join("themes"))
}

fn scan_dir(dir: &std::path::Path, out: &mut Vec<ThemeFile>) -> AppResult<()> {
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();
        // `_` ile başlayan dosyalar şablon/private — tema seçicide listelenmez.
        // (`_template.json`, ileride başka örnekler için aynı kural.)
        if name.starts_with('_') {
            continue;
        }
        // Symlink / aşırı büyük / okunamayan dosya tek başına tüm listeyi
        // düşürmesin — atla.
        let Ok(meta) = path.symlink_metadata() else {
            continue;
        };
        if !meta.is_file() || meta.len() > MAX_THEME_BYTES as u64 {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(&path) else {
            tracing::warn!(path = %path.display(), "theme file unreadable, skipped");
            continue;
        };
        out.push(ThemeFile {
            name,
            path: path.to_string_lossy().into_owned(),
            content,
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn scan_dir_reads_json_files_only() {
        let tmp = std::env::temp_dir().join(format!("dterm-test-themes-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();

        // Geçerli JSON tema
        let theme_path = tmp.join("D-Test.json");
        let mut f = std::fs::File::create(&theme_path).unwrap();
        f.write_all(br##"{"name":"D-Test","background":"#000000"}"##)
            .unwrap();

        // İlgisiz dosya — atlanmalı
        std::fs::write(tmp.join("README.md"), "ignored").unwrap();

        let mut out = Vec::new();
        scan_dir(&tmp, &mut out).expect("scan_dir");
        assert_eq!(out.len(), 1, "sadece .json dosyası okunmalı");
        let entry = &out[0];
        assert_eq!(entry.name, "D-Test");
        assert!(entry.content.contains("D-Test"));

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn scan_dir_handles_empty_directory() {
        let tmp = std::env::temp_dir().join(format!("dterm-test-empty-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();

        let mut out = Vec::new();
        scan_dir(&tmp, &mut out).expect("scan_dir");
        assert!(out.is_empty());

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn scan_dir_skips_underscore_prefixed_files() {
        let tmp = std::env::temp_dir().join(format!("dterm-test-tpl-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();

        std::fs::write(tmp.join("D-Real.json"), br#"{"name":"D-Real"}"#).unwrap();
        std::fs::write(tmp.join("_template.json"), br#"{"name":"X"}"#).unwrap();
        std::fs::write(tmp.join("_private.json"), br#"{"name":"Y"}"#).unwrap();

        let mut out = Vec::new();
        scan_dir(&tmp, &mut out).expect("scan_dir");
        assert_eq!(out.len(), 1, "sadece D-Real listelensin");
        assert_eq!(out[0].name, "D-Real");

        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn theme_name_sanitization() {
        assert_eq!(sanitize_theme_name("My Theme!").unwrap(), "MyTheme");
        assert!(sanitize_theme_name("../..").is_err());
        assert!(sanitize_theme_name("CON").is_err());
        assert!(sanitize_theme_name("nul").is_err());
        assert!(sanitize_theme_name("com3").is_err());
        assert!(sanitize_theme_name("_template").is_err());
        assert_eq!(
            sanitize_theme_name(&"a".repeat(200)).unwrap().len(),
            MAX_THEME_NAME_CHARS
        );
    }

    #[test]
    fn scan_dir_skips_oversized_files() {
        let tmp = std::env::temp_dir().join(format!("dterm-test-big-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&tmp).unwrap();
        std::fs::write(tmp.join("Big.json"), vec![b' '; MAX_THEME_BYTES + 1]).unwrap();
        std::fs::write(tmp.join("Ok.json"), br#"{"name":"Ok"}"#).unwrap();
        let mut out = Vec::new();
        scan_dir(&tmp, &mut out).expect("scan_dir");
        assert_eq!(out.len(), 1);
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn user_themes_dir_resolves_to_app_data() {
        let dir = user_themes_dir().expect("user_themes_dir");
        // Path structure: <data_dir>/D-Terminal/themes
        assert!(dir.ends_with("D-Terminal/themes") || dir.ends_with("D-Terminal\\themes"));
    }
}
