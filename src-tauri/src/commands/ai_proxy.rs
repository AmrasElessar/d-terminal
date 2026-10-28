// AI key maskeli gösterim.
//
// API key frontend'e hiçbir zaman düz metin olarak dönmez; AI çağrıları
// `commands::ai::ai_chat_stream` üzerinden Rust'ta yapılır. Bu dosyada
// yalnızca Settings UI'ın "key kayıtlı" göstergesi için maskeli özet var.

use crate::error::{run_blocking, AppError, AppResult};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub async fn ai_key_masked(
    state: State<'_, AppState>,
    provider: String,
) -> AppResult<Option<String>> {
    let storage = state.storage.clone();
    run_blocking(move || {
        // `peek`: last_used_at güncellenmez, legacy blob yeniden yazılmaz —
        // maskeyi göstermek "kullanım" sayılmaz ve DB'ye yazmaz.
        match crate::secrets::for_storage(&storage).peek("ai_provider", &provider) {
            Ok(plain) => Ok(Some(mask_key(&plain))),
            Err(AppError::Secret(msg)) if msg.contains("not found") => Ok(None),
            Err(e) => Err(e),
        }
    })
    .await
}

/// Key'in maskeli özeti. Uzunluk sızmasın diye maske sabit genişlikte;
/// yalnızca yeterince uzun (≥16 karakter) key'lerde son 4 karakter gösterilir.
/// Eskiden 9-12 karakterlik key'lerde 7 karakter (anahtarın çoğu) görünüyordu.
/// Char tabanlı — UTF-8 çok baytlı karakterlerde byte-slice paniği yok.
fn mask_key(plain: &[u8]) -> String {
    const MASK: &str = "••••••••";
    let Ok(key_str) = std::str::from_utf8(plain) else {
        return MASK.to_string();
    };
    let chars: Vec<char> = key_str.chars().collect();
    if chars.len() < 16 {
        return MASK.to_string();
    }
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{MASK}{tail}")
}

#[cfg(test)]
mod tests {
    use super::mask_key;

    #[test]
    fn short_keys_fully_masked() {
        assert_eq!(mask_key(b"abc"), "••••••••");
        assert_eq!(mask_key(b"123456789012"), "••••••••");
    }

    #[test]
    fn long_keys_show_only_last_four() {
        assert_eq!(mask_key(b"sk-abcdefghijklmnopWXYZ"), "••••••••WXYZ");
    }

    #[test]
    fn non_utf8_masked() {
        assert_eq!(mask_key(&[0xff, 0xfe, 0xfd]), "••••••••");
    }

    #[test]
    fn multibyte_safe() {
        assert_eq!(mask_key("şşşşşşşşşşşşşşşşğğğğ".as_bytes()), "••••••••ğğğğ");
    }
}
