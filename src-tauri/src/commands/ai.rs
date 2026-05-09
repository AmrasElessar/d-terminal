// AI proxy command'ları.
//
// Frontend AI çağrıları artık Rust'ta yapılır — API key DPAPI vault'tan
// alınır, HTTP istekleri reqwest ile, streaming yanıt Tauri Channel<String>
// üzerinden frontend'e push.

use crate::ai::{provider_for, AiModel, ChatMessage, ChatOptions};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{ipc::Channel, State};
use tokio::sync::oneshot;
use zeroize::Zeroizing;

#[tauri::command]
pub async fn ai_models(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Vec<AiModel>, String> {
    let p = provider_for(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    let key = retrieve_key(&state, &provider);
    // key.as_deref() Zeroizing<String> üzerinden Option<&str> verir; çağrı
    // bittikten sonra `key` drop edilir ve plaintext bellekte sıfırlanır.
    Ok(p.models(key.as_deref().map(|s| s.as_str())).await)
}

#[tauri::command]
pub async fn ai_chat_stream(
    state: State<'_, AppState>,
    provider: String,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
    stream_id: u64,
    on_chunk: Channel<String>,
) -> Result<(), String> {
    let p = provider_for(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    let key = retrieve_key(&state, &provider);

    // Channel send'i background thread'da safe — clone yap.
    let chunk_sink: crate::ai::ChunkSink = Box::new(move |text: String| {
        // send hata dönerse (frontend abort etti), drop edilir; provider
        // kendi error handler'ında tespit eder.
        let _ = on_chunk.send(text);
    });

    // Abort kanalı: frontend `ai_abort_stream(stream_id)` çağırırsa cancel_tx
    // `()` gönderir; tokio::select! chat future'ını drop eder, reqwest HTTP
    // bağlantısı kapatılır, daha fazla token harcanmaz (AI providers H1).
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    state.ai_aborts.lock().insert(stream_id, cancel_tx);

    let chat_future = p.chat(
        key.as_deref().map(|s| s.as_str()),
        messages,
        options,
        chunk_sink,
    );

    let result = tokio::select! {
        res = chat_future => res,
        _ = cancel_rx => Err("aborted".to_string()),
    };

    // Cleanup: stream sonlandı → handle map'ten çıkar (cancelled veya complete).
    state.ai_aborts.lock().remove(&stream_id);
    drop(key); // explicit zeroize sinyali (drop sırasında zaten gerçekleşir)
    result
}

/// Çalışan bir AI stream'i iptal eder. `stream_id` `ai_chat_stream`'i
/// başlatırken frontend'in ürettiği unique sayı (Date.now() + counter).
/// Stream zaten bittiyse no-op (entry map'te yok).
#[tauri::command]
pub fn ai_abort_stream(state: State<'_, AppState>, stream_id: u64) {
    if let Some(tx) = state.ai_aborts.lock().remove(&stream_id) {
        // send hata dönerse (receiver zaten drop) — yine de OK.
        let _ = tx.send(());
    }
}

/// DPAPI vault'tan provider key'ini düz metne çek. Provider id "ai_provider"
/// scope'unda saklanır. Ollama key gerektirmez (None döner).
///
/// Plaintext key `Zeroizing<String>` ile sarmalı — fonksiyondan dışarı
/// çıktığında veya drop edildiğinde memory'de sıfırlanır. Process memory
/// dump'ında plaintext key kalmaz.
fn retrieve_key(state: &State<'_, AppState>, provider: &str) -> Option<Zeroizing<String>> {
    if provider == "ollama" {
        return None;
    }
    let secrets = crate::secrets::build(Arc::new(crate::storage::secrets::SecretsRepo::new(
        state.storage.pool().clone(),
    )));
    let bytes = secrets.retrieve("ai_provider", provider).ok()?;
    // bytes: Zeroizing<Vec<u8>>. UTF-8 invalid ise None döndür — provider
    // sadece ASCII/UTF-8 key kabul eder; bozuk byte zaten kullanılmaz.
    let s = std::str::from_utf8(&bytes).ok()?.to_owned();
    Some(Zeroizing::new(s))
}
