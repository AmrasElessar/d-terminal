// Tema dosyalarını dahili klasörden okuma + kullanıcı temaları için AppData.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Debug, Serialize)]
pub struct ThemeFile {
    pub name: String,
    pub path: String,
    pub content: String,
}

#[tauri::command]
pub fn themes_list(app: tauri::AppHandle) -> AppResult<Vec<ThemeFile>> {
    let mut out = Vec::new();
    // Bundled (resources/themes) — dev modunda repo'daki themes/ klasörü
    let bundled = bundled_themes_dir(&app)?;
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

#[tauri::command]
pub fn themes_save_user(name: String, content: String) -> AppResult<String> {
    let dir = user_themes_dir()?;
    std::fs::create_dir_all(&dir)?;
    // Path traversal koruması
    let safe = name
        .chars()
        .filter(|c| c.is_alphanumeric() || matches!(*c, '-' | '_'))
        .collect::<String>();
    if safe.is_empty() {
        return Err(AppError::InvalidArg("theme name".into()));
    }
    let path = dir.join(format!("{safe}.json"));
    std::fs::write(&path, content)?;
    Ok(path.to_string_lossy().into_owned())
}

fn bundled_themes_dir(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    // Dev: <project>/themes — cargo run sırasında cwd src-tauri olabilir, bir yukarı bak.
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
        let content = std::fs::read_to_string(&path)?;
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown")
            .to_string();
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
    fn user_themes_dir_resolves_to_app_data() {
        let dir = user_themes_dir().expect("user_themes_dir");
        // Path structure: <data_dir>/D-Terminal/themes
        assert!(dir.ends_with("D-Terminal/themes") || dir.ends_with("D-Terminal\\themes"));
    }
}
