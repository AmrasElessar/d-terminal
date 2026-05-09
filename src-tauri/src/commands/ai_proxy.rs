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
pub fn ai_key_masked(state: State<'_, AppState>, provider: String) -> AppResult<Option<String>> {
    let store = crate::secrets::build(Arc::new(crate::storage::secrets::SecretsRepo::new(
        state.storage.pool().clone(),
    )));
    match store.retrieve("ai_provider", &provider) {
        Ok(plain) => {
            // plain: Zeroizing<Vec<u8>>. UTF-8 multi-byte içeren key (kullanıcı
            // yanlışlıkla emoji yapıştırırsa) byte-slice ile panic atabilir;
            // bu yüzden char tabanlı mask'liyoruz.
            let key_str = match std::str::from_utf8(&plain) {
                Ok(s) => s,
                // UTF-8 değilse tüm karakterleri • ile maskele (uzunluk byte'a
                // değil, lossy karakter sayısına dayalı — yine de güvenli).
                Err(_) => {
                    let len = String::from_utf8_lossy(&plain).chars().count();
                    return Ok(Some("•".repeat(len)));
                }
            };
            let chars: Vec<char> = key_str.chars().collect();
            let len = chars.len();
            if len <= 8 {
                Ok(Some("•".repeat(len)))
            } else {
                let head: String = chars.iter().take(3).collect();
                let tail: String = chars.iter().skip(len - 4).collect();
                Ok(Some(format!("{head}…{tail}")))
            }
        }
        Err(AppError::Secret(msg)) if msg.contains("not found") => Ok(None),
        Err(e) => Err(e),
    }
}

// ai_key_reveal KALDIRILDI — API key artık frontend'e sızmıyor.
// AI çağrıları commands::ai::ai_chat_stream üzerinden Rust'tan yapılır.
