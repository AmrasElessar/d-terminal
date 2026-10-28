// AI proxy command'ları.
//
// Frontend AI çağrıları artık Rust'ta yapılır — API key DPAPI vault'tan
// alınır, HTTP istekleri reqwest ile, streaming yanıt Tauri Channel<String>
// üzerinden frontend'e push.

use crate::ai::{provider_for, AiModel, ChatMessage, ChatOptions, UsageInfo};
use crate::state::AppState;
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
    on_usage: Channel<UsageInfo>,
) -> Result<(), String> {
    let p = provider_for(&provider).ok_or_else(|| format!("unknown provider: {provider}"))?;
    let key = retrieve_key(&state, &provider);
    if key.is_some() {
        check_key_binding(&state, &provider, &options)?;
    }

    // Channel send'i background thread'da safe — clone yap.
    let chunk_sink: crate::ai::ChunkSink = Box::new(move |text: String| {
        // send hata dönerse (frontend abort etti), drop edilir; provider
        // kendi error handler'ında tespit eder.
        let _ = on_chunk.send(text);
    });
    // Provider exact token raporlarsa frontend'e UsageInfo gönder; estimate
    // yerine kesin değer kullanılır (Türkçe gibi morfolojik dillerde %30+ iyi).
    let usage_sink: crate::ai::UsageSink = Box::new(move |info: UsageInfo| {
        let _ = on_usage.send(info);
    });

    // Abort kanalı: frontend `ai_abort_stream(stream_id)` çağırırsa cancel_tx
    // `()` gönderir; tokio::select! chat future'ını drop eder, reqwest HTTP
    // bağlantısı kapatılır, daha fazla token harcanmaz (AI providers H1).
    let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
    {
        // Aynı id ile ikinci stream eskisinin sender'ını eziyordu: eski stream
        // `cancel_rx` Err ile abort oluyor, bitince de yeni stream'in entry'sini
        // silip onu iptal edilemez bırakıyordu. Çakışan id'yi reddet.
        let mut aborts = state.ai_aborts.lock();
        if aborts.contains_key(&stream_id) {
            return Err("duplicateStreamId".to_string());
        }
        aborts.insert(stream_id, cancel_tx);
    }

    let chat_future = p.chat(
        key.as_deref().map(|s| s.as_str()),
        messages,
        options,
        chunk_sink,
        usage_sink,
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
///
/// Race güvenliği: `ai_chat_stream` başarılı tamamlandığında entry'yi
/// `ai_aborts.remove()` ile siler — bu fonksiyon aynı anda çağrılırsa lock
/// senkronize olduğu için sadece biri tx alır. tx.send() başarısızsa
/// (receiver drop edildi) zaten chat tamamlanmış demektir, no-op.
#[tauri::command]
pub fn ai_abort_stream(state: State<'_, AppState>, stream_id: u64) {
    let maybe_tx = state.ai_aborts.lock().remove(&stream_id);
    if let Some(tx) = maybe_tx {
        // is_closed → chat zaten Sender drop edildi (tamamlandı/cancel oldu).
        if tx.is_closed() {
            tracing::debug!(stream_id, "abort no-op — receiver already closed");
            return;
        }
        if tx.send(()).is_err() {
            tracing::debug!(stream_id, "abort send failed — chat finished concurrently");
        }
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
    let secrets = crate::secrets::for_storage(&state.storage);
    let bytes = secrets.retrieve("ai_provider", provider).ok()?;
    // bytes: Zeroizing<Vec<u8>>. UTF-8 invalid ise None döndür — provider
    // sadece ASCII/UTF-8 key kabul eder; bozuk byte zaten kullanılmaz.
    let s = std::str::from_utf8(&bytes).ok()?.to_owned();
    Some(Zeroizing::new(s))
}

/// Custom provider key'inin bağlı olduğu origin'i tutan rezerve settings key'i.
/// `_` önekli key'ler webview'dan `settings_set`/`settings_delete` ile
/// değiştirilemez (bkz. `commands::settings`).
pub(crate) const BOUND_ORIGIN_PREFIX: &str = "_ai_bound_origin.";

/// Frontend settings store'unun custom endpoint'i sakladığı key
/// (`src/stores/settings.ts` → `ui.` + `aiCustomEndpoint`, JSON string).
const CUSTOM_ENDPOINT_SETTING: &str = "ui.aiCustomEndpoint";

/// Saklı bir key'in yalnızca kaydedildiği endpoint'e gönderilmesini garanti eder.
///
/// Custom provider'da endpoint her çağrıda webview'dan gelir; XSS ile
/// `endpoint: "https://evil.example/v1"` verilirse vault'taki key oraya
/// `Authorization: Bearer` olarak giderdi. Key kaydedilirken (veya ilk
/// kullanımda) endpoint origin'i backend'de saklanır; farklı bir origin'e
/// key eklenmez — kullanıcı endpoint'i değiştirdiyse key'i yeniden girmelidir.
fn check_key_binding(
    state: &State<'_, AppState>,
    provider: &str,
    options: &ChatOptions,
) -> Result<(), String> {
    if provider != "custom" {
        // openai: endpoint override yok sayılır; yerel runtime'lar: yalnızca
        // loopback override (bkz. ai::openai::resolve_base_url).
        return Ok(());
    }
    let endpoint = options.endpoint.as_deref().unwrap_or("").trim();
    let origin = crate::ai::openai::origin_of(endpoint).ok_or("invalidUrl")?;
    let setting = format!("{BOUND_ORIGIN_PREFIX}{provider}");
    let bound = state
        .storage
        .settings
        .get(&setting)
        .map_err(|e| e.to_string())?;
    if binding_allows(bound.as_deref(), &origin)? && bound.is_none() {
        state
            .storage
            .settings
            .set(&setting, &origin)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// `Ok(true)` → izin ver; bound yoksa çağıran TOFU olarak origin'i kaydeder.
fn binding_allows(bound: Option<&str>, origin: &str) -> Result<bool, String> {
    match bound {
        None => Ok(true),
        Some(b) if b == origin => Ok(true),
        Some(_) => Err("endpointNotBoundToKey".to_string()),
    }
}

/// Bir provider key'i kaydedildiğinde / silindiğinde bağlı origin'i sıfırlar.
/// Custom provider için o an ayarlarda kayıtlı endpoint varsa key hemen ona
/// bağlanır (TOFU penceresi kalmaz).
pub(crate) fn rebind_key_origin(storage: &crate::storage::Storage, provider: &str, stored: bool) {
    let setting = format!("{BOUND_ORIGIN_PREFIX}{provider}");
    if let Err(e) = storage.settings.delete(&setting) {
        tracing::warn!("ai key rebind: delete failed: {e}");
    }
    if !stored || provider != "custom" {
        return;
    }
    let endpoint = storage
        .settings
        .get(CUSTOM_ENDPOINT_SETTING)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str::<String>(&json).ok());
    if let Some(origin) = endpoint.as_deref().and_then(crate::ai::openai::origin_of) {
        if let Err(e) = storage.settings.set(&setting, &origin) {
            tracing::warn!("ai key rebind: set failed: {e}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::binding_allows;

    #[test]
    fn binding_first_use_allowed() {
        assert_eq!(binding_allows(None, "https://a.example:443"), Ok(true));
    }

    #[test]
    fn binding_same_origin_allowed() {
        assert_eq!(
            binding_allows(Some("https://a.example:443"), "https://a.example:443"),
            Ok(true)
        );
    }

    #[test]
    fn binding_other_origin_rejected() {
        assert!(binding_allows(Some("https://a.example:443"), "https://evil.example:443").is_err());
    }
}
