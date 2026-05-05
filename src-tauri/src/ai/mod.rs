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

/// Stream tüketicisi — her chunk için on_chunk çağrılır.
pub type ChunkSink = Box<dyn FnMut(String) + Send>;

#[async_trait]
pub trait ChatProvider: Send + Sync {
    /// Provider id ("anthropic", "openai", ...). Sentinel/dispatch için.
    fn id(&self) -> &'static str;

    /// Model listesi. Network hatasında fallback döner.
    async fn models(&self, key: Option<&str>) -> Vec<AiModel>;

    /// Streaming chat. Her chunk geldikçe on_chunk çağrılır.
    /// Hata durumunda anlamlı bir mesaj döner.
    async fn chat(
        &self,
        key: Option<&str>,
        messages: Vec<ChatMessage>,
        options: ChatOptions,
        on_chunk: ChunkSink,
    ) -> Result<(), String>;
}

pub fn provider_for(id: &str) -> Option<Box<dyn ChatProvider>> {
    match id {
        "anthropic" => Some(Box::new(anthropic::Anthropic)),
        "openai" => Some(Box::new(openai::OpenAi::openai())),
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
