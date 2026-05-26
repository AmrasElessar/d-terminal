// Config as Code — kullanıcı ayarlarının TOML dosyasına export/import.
//
// Path: %APPDATA%\D-Terminal\config.toml (Windows) — `config_dotfile_path` ile sorgu.
// Schema: tüm `ui.*` settings tablosu girdileri tek seviye flat key/value (string).
// JSON.parse'lı ham değer korunur; TOML her zaman string olarak yazılır, frontend
// settings store'u JSON.parse ile interpret eder.
//
// Hot-reload v1.0.5+ — notify crate zaten dependency'de, bu commit eklemiyor.

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

const FILE_NAME: &str = "config.toml";

fn dotfile_path() -> AppResult<PathBuf> {
    let base = dirs::data_dir().ok_or_else(|| AppError::Internal("data_dir unresolved".into()))?;
    Ok(base.join("D-Terminal").join(FILE_NAME))
}

#[tauri::command]
pub fn config_dotfile_path() -> AppResult<String> {
    Ok(dotfile_path()?.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn config_export(state: State<'_, AppState>) -> AppResult<String> {
    let path = dotfile_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let all = state.storage.settings.all()?;
    let mut tbl = toml::value::Table::new();
    for (k, v) in all {
        // SQLite settings tablosunda key formatı `ui.<name>` — config.toml'a
        // direkt aynı key ile yazıyoruz. Değer raw JSON string'i.
        tbl.insert(k, toml::Value::String(v));
    }
    let mut doc = toml::value::Table::new();
    doc.insert("settings".into(), toml::Value::Table(tbl));
    let serialized = toml::to_string_pretty(&doc)
        .map_err(|e| AppError::Internal(format!("toml serialize: {e}")))?;
    let header = "# D-Terminal Config — TOML format. Hot-reload v1.0.5+.\n\
                  # Tüm değerler raw JSON string'i (settings store JSON.parse uygular).\n\n";
    std::fs::write(&path, format!("{header}{serialized}"))?;
    Ok(path.to_string_lossy().into_owned())
}

/// Bilinen settings key prefix'leri — config_import bunların dışında bir key
/// görürse atlar (warn'a yazar). Kullanıcı TOML'a rastgele `app.foo` yazıp
/// schema kirletmesin diye allowlist; settings store kanonik prefix sahipliği
/// buradan koruma altında.
const ALLOWED_SETTING_PREFIXES: &[&str] = &[
    "ui.",
    "ai.",
    "shortcut.",
    "trigger.",
    "profile.",
    "agent.",
    "theme.",
    "session.",
    "updater.",
    "logger.",
    "pane.",
    "snippet.",
    "window.",
    "app.",
];

#[tauri::command]
pub fn config_import(state: State<'_, AppState>) -> AppResult<usize> {
    let path = dotfile_path()?;
    if !path.exists() {
        return Err(AppError::InvalidArg(format!(
            "config file not found: {}",
            path.display()
        )));
    }
    let content = std::fs::read_to_string(&path)?;
    let doc: toml::Value =
        toml::from_str(&content).map_err(|e| AppError::InvalidArg(format!("toml parse: {e}")))?;
    let settings = doc
        .get("settings")
        .and_then(|v| v.as_table())
        .ok_or_else(|| AppError::InvalidArg("missing [settings] section".into()))?;
    let mut count = 0;
    for (k, v) in settings {
        // Allowlist dışı key → atla. Hata yerine warn — TOML'a yorum-uyumlu
        // kalsın, kullanıcı silmediyse silent ignore yerine log'a düşsün.
        if !ALLOWED_SETTING_PREFIXES.iter().any(|p| k.starts_with(p)) {
            tracing::warn!("config_import: skipping unknown setting key '{k}'");
            continue;
        }
        let value_str = match v {
            toml::Value::String(s) => s.clone(),
            other => other.to_string(),
        };
        state.storage.settings.set(k, &value_str)?;
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dotfile_path_under_app_data() {
        let p = dotfile_path().expect("dotfile_path");
        let s = p.to_string_lossy();
        assert!(s.contains("D-Terminal"));
        assert!(s.ends_with("config.toml"));
    }
}
