// Tema dosyalarını dahili klasörden okuma + kullanıcı temaları için AppData.

use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::path::PathBuf;

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
    // Önce dev: <project>/themes
    if let Some(dir) = std::env::current_dir().ok().and_then(|cwd| {
        let candidate = cwd.join("themes");
        if candidate.exists() {
            Some(candidate)
        } else {
            None
        }
    }) {
        return Ok(dir);
    }
    // Prod: app resource path
    let _ = app;
    Ok(std::env::current_exe()?
        .parent()
        .unwrap_or(std::path::Path::new("."))
        .join("themes"))
}

fn user_themes_dir() -> AppResult<PathBuf> {
    let base = dirs::data_dir()
        .ok_or_else(|| AppError::Internal("data_dir unresolved".into()))?;
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
