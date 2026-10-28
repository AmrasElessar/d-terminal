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

/// Frontend log girdisi sınırları — webview log dosyasını şişiremesin.
const MAX_MESSAGE_CHARS: usize = 4096;
const MAX_SOURCE_CHARS: usize = 64;
const MAX_FIELDS_CHARS: usize = 4096;

/// Kontrol karakterlerini kaçışlar ve uzunluğu sınırlar: mesajdaki `\n` ile
/// sahte log satırı (log forging) üretilemesin.
fn sanitize(s: &str, max_chars: usize) -> String {
    let mut out = String::with_capacity(s.len().min(max_chars));
    for (i, c) in s.chars().enumerate() {
        if i >= max_chars {
            out.push('…');
            break;
        }
        match c {
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push(' '),
            c if c.is_control() => out.push_str(&c.escape_unicode().to_string()),
            c => out.push(c),
        }
    }
    out
}

#[tauri::command]
pub fn log_event(event: LogEvent) -> AppResult<()> {
    let source = sanitize(&event.source, MAX_SOURCE_CHARS);
    let message = sanitize(&event.message, MAX_MESSAGE_CHARS);
    let fields_str = event
        .fields
        .as_ref()
        .map(|v| sanitize(&v.to_string(), MAX_FIELDS_CHARS))
        .unwrap_or_default();

    match event.level {
        LogLevel::Trace => {
            tracing::trace!(target: "frontend", source = %source, fields = %fields_str, "{}", message)
        }
        LogLevel::Debug => {
            tracing::debug!(target: "frontend", source = %source, fields = %fields_str, "{}", message)
        }
        LogLevel::Info => {
            tracing::info!(target: "frontend", source = %source, fields = %fields_str, "{}", message)
        }
        LogLevel::Warn => {
            tracing::warn!(target: "frontend", source = %source, fields = %fields_str, "{}", message)
        }
        LogLevel::Error => {
            tracing::error!(target: "frontend", source = %source, fields = %fields_str, "{}", message)
        }
    }
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

#[cfg(test)]
mod tests {
    use super::sanitize;

    #[test]
    fn escapes_newlines_and_controls() {
        assert_eq!(sanitize("a\nb\rc", 100), "a\\nb\\rc");
        assert_eq!(sanitize("x\u{1b}[31m", 100), "x\\u{1b}[31m");
    }

    #[test]
    fn truncates_on_char_boundary() {
        assert_eq!(sanitize("şşşş", 2), "şş…");
    }
}
