// AI provider proxy modülü.
//
// Frontend AI çağrıları artık Rust'ta yapılır — API key DPAPI vault'tan
// alınır, HTTP istekleri reqwest ile gönderilir, streaming yanıtlar
// Tauri Channel üzerinden frontend'e push edilir. Frontend hiçbir zaman
// plain key görmez.
//
// Mimari:
//   ChatProvider trait (async stream)
//      ↓ implementations
//   anthropic.rs / openai.rs / gemini.rs / ollama.rs

pub mod anthropic;
pub mod gemini;
pub mod ollama;
pub mod openai;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String, // "system" | "user" | "assistant"
    pub content: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ChatOptions {
    pub model: String,
    #[serde(default)]
    pub temperature: Option<f32>,
    #[serde(default)]
    pub max_tokens: Option<u32>,
    /// OpenAI-uyumlu provider'lar için kullanıcı override endpoint'i.
    /// Custom provider'da zorunlu; LM Studio/Jan/llama.cpp/Foundry için
    /// kullanıcı default localhost portunu değiştirmek isterse kullanır.
    #[serde(default)]
    pub endpoint: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AiModel {
    pub id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context_window: Option<u32>,
    pub supports_streaming: bool,
}

/// Stream tüketicisi — her chunk için on_chunk çağrılır (text içerik).
pub type ChunkSink = Box<dyn FnMut(String) + Send>;

/// Provider'ın stream sonunda raporladığı kesin token kullanımı.
/// Anthropic `message_delta` event'inde, OpenAI `stream_options.include_usage`
/// ile son chunk'ta gelir. Yoksa frontend `estimateTokens` (4 char/token) ile
/// tahmin eder — Türkçe gibi morfolojik diller için %30 underestimate.
#[derive(Debug, Clone, Serialize)]
pub struct UsageInfo {
    pub input: u32,
    pub output: u32,
}

/// Provider tarafından raporlanan kesin token usage. Stream bittiğinde
/// (veya provider exact rapor verdiğinde) çağrılır. Provider rapor vermezse
/// hiç çağrılmaz; frontend o durumda tahmine düşer.
pub type UsageSink = Box<dyn FnMut(UsageInfo) + Send>;

#[async_trait]
pub trait ChatProvider: Send + Sync {
    /// Provider id ("anthropic", "openai", ...). Sentinel/dispatch için.
    fn id(&self) -> &'static str;

    /// Model listesi. Network hatasında fallback döner.
    async fn models(&self, key: Option<&str>) -> Vec<AiModel>;

    /// Streaming chat. Her chunk geldikçe on_chunk çağrılır; provider exact
    /// usage raporlarsa on_usage da bir kez çağrılır.
    /// Hata durumunda anlamlı bir mesaj döner.
    async fn chat(
        &self,
        key: Option<&str>,
        messages: Vec<ChatMessage>,
        options: ChatOptions,
        on_chunk: ChunkSink,
        on_usage: UsageSink,
    ) -> Result<(), String>;
}

/// 429/503 için exponential backoff retry. `Retry-After` header'ı varsa
/// ona uy; yoksa 1s/2s/4s artarak max 3 deneme. Build_request bir closure
/// olduğu için her denemede yeni `RequestBuilder` üretilir (ownership reuse
/// reqwest'in alışkanlığında değil).
///
/// Stream başlatma noktasında çağrılır — chunk akışı başladıktan sonra retry
/// güvensiz (kullanıcı yarım yanıt görür); yalnızca initial response alana
/// kadar.
pub async fn send_with_retry<F>(mut build_request: F) -> Result<reqwest::Response, String>
where
    F: FnMut() -> reqwest::RequestBuilder,
{
    let max_attempts = 3;
    let mut attempt = 0u32;
    loop {
        attempt += 1;
        let resp = build_request()
            .send()
            .await
            .map_err(|e| format!("network: {e}"))?;
        let status = resp.status();
        // 429 (rate limit) veya 503 (service unavailable) → backoff
        if (status.as_u16() == 429 || status.as_u16() == 503) && attempt < max_attempts {
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or_else(|| 1u64 << (attempt - 1)); // 1, 2, 4
            let wait = std::time::Duration::from_secs(retry_after.min(30));
            tracing::info!(status = %status, attempt, wait_ms = wait.as_millis() as u64, "AI rate-limit, retrying");
            // resp drop edilir, soketler temizlenir.
            tokio::time::sleep(wait).await;
            continue;
        }
        return Ok(resp);
    }
}

pub fn provider_for(id: &str) -> Option<Box<dyn ChatProvider>> {
    match id {
        "anthropic" => Some(Box::new(anthropic::Anthropic)),
        "openai" => Some(Box::new(openai::OpenAi::cloud())),
        "gemini" => Some(Box::new(gemini::Gemini)),
        "ollama" => Some(Box::new(ollama::Ollama)),
        // OpenAI-uyumlu yerel runtime'lar — kullanıcının kendi makinesinde
        // koşan AI sunucularına bağlanır.
        "lmstudio" => Some(Box::new(openai::OpenAi::lmstudio())),
        "jan" => Some(Box::new(openai::OpenAi::jan())),
        "llamacpp" => Some(Box::new(openai::OpenAi::llamacpp())),
        "foundry" => Some(Box::new(openai::OpenAi::foundry())),
        // Esnek slot — kullanıcı endpoint girer (OpenRouter, Together AI,
        // DeepInfra, kendi proxy'si, vb).
        "custom" => Some(Box::new(openai::OpenAi::custom())),
        _ => None,
    }
}
