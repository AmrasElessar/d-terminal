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
        // Yanıt başlıkları için üst sınır — sunucu bağlantıyı kabul edip hiç
        // yanıt vermezse komut sonsuza kadar asılı kalmasın.
        let resp = tokio::time::timeout(std::time::Duration::from_secs(60), build_request().send())
            .await
            .map_err(|_| "network: response timeout (60s)".to_string())?
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

/// Tüm AI provider'larının paylaştığı HTTP client.
///
/// - Redirect takip edilmez: public bir host 302 ile `169.254.169.254` /
///   `10.x` gibi iç adreslere yönlendirip SSRF filtresini atlatamaz.
/// - DNS çözümlemesi [`FilteringResolver`] üzerinden yapılır: reqwest'in
///   gerçekte bağlandığı IP'ler `check_ip_public` ile süzülür (validate →
///   connect arası DNS rebinding TOCTOU'su kapanır).
/// - connect 5s, okuma arası 60s timeout (stream idle timeout ile aynı).
///
/// Builder başarısız olursa (TLS backend init hatası) panik yerine hata döner.
pub fn http_client() -> Result<reqwest::Client, String> {
    static CLIENT: std::sync::OnceLock<Result<reqwest::Client, String>> =
        std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(5))
                .read_timeout(std::time::Duration::from_secs(60))
                .redirect(reqwest::redirect::Policy::none())
                .dns_resolver(std::sync::Arc::new(FilteringResolver))
                .build()
                .map_err(|e| format!("httpClient:{e}"))
        })
        .clone()
}

/// reqwest DNS resolver'ı: sistem resolver'ı ile çözer, sonra private /
/// link-local / CGNAT / reserved adresleri eler. Hiç izinli adres kalmazsa
/// bağlantı reddedilir. Loopback izinlidir (yerel runtime'lar).
struct FilteringResolver;

type BoxError = Box<dyn std::error::Error + Send + Sync>;

impl reqwest::dns::Resolve for FilteringResolver {
    fn resolve(&self, name: reqwest::dns::Name) -> reqwest::dns::Resolving {
        let host = name.as_str().to_string();
        Box::pin(async move {
            let addrs = tokio::time::timeout(
                std::time::Duration::from_secs(5),
                tokio::net::lookup_host((host.as_str(), 0)),
            )
            .await
            .map_err(|_| -> BoxError { "dnsResolveTimeout".into() })??;
            let allowed: Vec<std::net::SocketAddr> = addrs
                .filter(|sa| openai::check_ip_public(&sa.ip()).is_ok())
                .collect();
            if allowed.is_empty() {
                return Err::<reqwest::dns::Addrs, BoxError>(format!("dnsBlocked:{host}").into());
            }
            let iter: reqwest::dns::Addrs = Box::new(allowed.into_iter());
            Ok(iter)
        })
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
