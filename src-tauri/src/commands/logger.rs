// Frontend → Rust → tracing → dosya akışı.
//
// `log_event` Tauri command'i frontend'den çağrılır; mesaj `tracing` üzerinden
// hem stderr'a hem de daily-rotate dosyaya akar.

use crate::error::AppResult;
use crate::logger::LogPaths;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Trace,
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Debug, Deserialize)]
pub struct LogEvent {
    pub level: LogLevel,
    pub source: String,
    pub message: String,
    #[serde(default)]
    pub fields: Option<serde_json::Value>,
}

#[tauri::command]
pub fn log_event(event: LogEvent) -> AppResult<()> {
    let target = format!("frontend::{}", event.source);
    let fields_str = event
        .fields
        .as_ref()
        .map(|v| v.to_string())
        .unwrap_or_default();

    match event.level {
        LogLevel::Trace => {
            tracing::trace!(target: "frontend", source = %event.source, fields = %fields_str, "{}", event.message)
        }
        LogLevel::Debug => {
            tracing::debug!(target: "frontend", source = %event.source, fields = %fields_str, "{}", event.message)
        }
        LogLevel::Info => {
            tracing::info!(target: "frontend", source = %event.source, fields = %fields_str, "{}", event.message)
        }
        LogLevel::Warn => {
            tracing::warn!(target: "frontend", source = %event.source, fields = %fields_str, "{}", event.message)
        }
        LogLevel::Error => {
            tracing::error!(target: "frontend", source = %event.source, fields = %fields_str, "{}", event.message)
        }
    }
    let _ = target;
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct LogPathsInfo {
    pub directory: String,
    pub current_file: String,
}

#[tauri::command]
pub fn log_paths(paths: State<'_, LogPaths>) -> AppResult<LogPathsInfo> {
    Ok(LogPathsInfo {
        directory: paths.dir.to_string_lossy().into_owned(),
        current_file: paths.current_file().to_string_lossy().into_owned(),
    })
}
