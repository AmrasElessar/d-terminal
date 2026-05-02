// AI provider proxy.
//
// Frontend AI çağrılarını doğrudan provider'a gönderebilir, AMA API key bu
// durumda frontend'e ulaşmak zorundadır. Daha güvenli olan: bu komutlar
// üzerinden Rust tarafında key'i decrypt edip HTTP isteğini Rust yapar,
// frontend'e sadece response stream'i gider.
//
// v1.0'da basit yaklaşım: frontend isteği gönderir, biz key'i decrypt edip
// `Authorization` header'ı ekleyip aynı body'yi proxy ederiz. Streaming
// için Tauri channel kullanırız.
//
// Bu dosyada şimdilik sadece `ai_get_key_masked` (UI'da göstermek için
// son 4 karakter) ve key varlığı tespiti var. Tam HTTP proxy v1.0
// implementasyonunda doldurulur (provider crate kararına göre).

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn ai_key_masked(
    state: State<'_, AppState>,
    provider: String,
) -> AppResult<Option<String>> {
    let store = crate::secrets::build(Arc::new(crate::storage::secrets::SecretsRepo::new(
        state.storage.pool().clone(),
    )));
    match store.retrieve("ai_provider", &provider) {
        Ok(plain) => {
            let s = String::from_utf8_lossy(&plain);
            let len = s.len();
            if len <= 8 {
                Ok(Some("•".repeat(len)))
            } else {
                Ok(Some(format!("{}…{}", &s[..3], &s[len - 4..])))
            }
        }
        Err(AppError::Secret(msg)) if msg.contains("not found") => Ok(None),
        Err(e) => Err(e),
    }
}

/// Frontend'in proxy'siz çağrı için kullanabileceği şifresiz key dönüşü.
/// **DİKKAT**: Bu API frontend bellekte plaintext key bulundurmasına yol açar.
/// v1.1'de tam HTTP proxy ile değiştirilecek; v1.0'da Anthropic/Ollama
/// fetch'leri renderer process'inden yapılır (Tauri allowlist + CSP korur).
#[tauri::command]
pub fn ai_key_reveal(
    state: State<'_, AppState>,
    provider: String,
) -> AppResult<Option<String>> {
    let store = crate::secrets::build(Arc::new(crate::storage::secrets::SecretsRepo::new(
        state.storage.pool().clone(),
    )));
    match store.retrieve("ai_provider", &provider) {
        Ok(plain) => Ok(Some(String::from_utf8_lossy(&plain).to_string())),
        Err(AppError::Secret(msg)) if msg.contains("not found") => Ok(None),
        Err(e) => Err(e),
    }
}
