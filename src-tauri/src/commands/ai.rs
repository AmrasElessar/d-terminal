// AI proxy command'ları.
//
// Frontend AI çağrıları artık Rust'ta yapılır — API key DPAPI vault'tan
// alınır, HTTP istekleri reqwest ile, streaming yanıt Tauri Channel<String>
// üzerinden frontend'e push.

use crate::ai::{provider_for, AiModel, ChatMessage, ChatOptions};
use crate::state::AppState;
use std::sync::Arc;
use tauri::{ipc::Channel, State};

#[tauri::command]
pub async fn ai_models(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Vec<AiModel>, String> {
    let p = provider_for(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    let key = retrieve_key(&state, &provider);
    Ok(p.models(key.as_deref()).await)
}

#[tauri::command]
pub async fn ai_chat_stream(
    state: State<'_, AppState>,
    provider: String,
    messages: Vec<ChatMessage>,
    options: ChatOptions,
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

    p.chat(key.as_deref(), messages, options, chunk_sink).await
}

/// DPAPI vault'tan provider key'ini düz metne çek. Provider id "ai_provider"
/// scope'unda saklanır. Ollama key gerektirmez (None döner).
fn retrieve_key(state: &State<'_, AppState>, provider: &str) -> Option<String> {
    if provider == "ollama" {
        return None;
    }
    let secrets = crate::secrets::build(Arc::new(crate::storage::secrets::SecretsRepo::new(
        state.storage.pool().clone(),
    )));
    secrets
        .retrieve("ai_provider", provider)
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
}
