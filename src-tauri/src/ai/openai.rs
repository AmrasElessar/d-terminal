// OpenAI ve OpenAI-uyumlu yerel/özel runtime'lar — Chat Completions API, SSE streaming.
//
// Tek struct (`OpenAi`) parametrik base_url ile 6 farklı provider'a hizmet eder:
//   - openai      → api.openai.com (resmi, key zorunlu)
//   - lmstudio    → localhost:1234 (yerel, key opsiyonel)
//   - jan         → localhost:1337 (yerel, key opsiyonel)
//   - llamacpp    → localhost:8080 (yerel, key opsiyonel)
//   - foundry     → localhost:5273 (Microsoft Foundry Local, yerel, key opsiyonel)
//   - custom      → kullanıcı endpoint (ChatOptions.endpoint'ten gelir)
//
// 5 yerel runtime de OpenAI Chat Completions formatını uygular; sadece base_url farklı.

use super::{AiModel, ChatMessage, ChatOptions, ChatProvider, ChunkSink};
use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;

const OPENAI_FALLBACK: &[(&str, &str, u32)] = &[
    ("gpt-5", "GPT-5", 200_000),
    ("gpt-5-mini", "GPT-5 mini", 200_000),
    ("gpt-4o", "GPT-4o", 128_000),
    ("gpt-4o-mini", "GPT-4o mini", 128_000),
    ("o3", "o3", 200_000),
];

#[derive(Debug, Deserialize)]
struct OpenAiModel {
    id: String,
}
#[derive(Debug, Deserialize)]
struct ModelsResp {
    data: Option<Vec<OpenAiModel>>,
}
#[derive(Debug, Deserialize)]
struct Choice {
    delta: Option<DeltaInner>,
}
#[derive(Debug, Deserialize)]
struct DeltaInner {
    content: Option<String>,
}
#[derive(Debug, Deserialize)]
struct ChatChunk {
    choices: Option<Vec<Choice>>,
}

/// Parametrik OpenAI-uyumlu provider. Yerel runtime'lar ve custom endpoint
/// için aynı stream/parse mantığı kullanılır; sadece base URL ve key politikası
/// değişir.
pub struct OpenAi {
    /// "openai" | "lmstudio" | "jan" | "llamacpp" | "foundry" | "custom"
    id: &'static str,
    /// Default base URL (örn. "https://api.openai.com/v1"). Custom provider'da
    /// `ChatOptions.endpoint` bu değeri override eder.
    default_base_url: &'static str,
    /// API key zorunlu mu? Cloud için true, yerel runtime'lar için false.
    key_required: bool,
    /// Resmi OpenAI mi? Sadece bu durumda fallback model listesi gösterilir.
    is_official: bool,
}

impl OpenAi {
    pub fn openai() -> Self {
        Self {
            id: "openai",
            default_base_url: "https://api.openai.com/v1",
            key_required: true,
            is_official: true,
        }
    }
    pub fn lmstudio() -> Self {
        Self {
            id: "lmstudio",
            default_base_url: "http://localhost:1234/v1",
            key_required: false,
            is_official: false,
        }
    }
    pub fn jan() -> Self {
        Self {
            id: "jan",
            default_base_url: "http://localhost:1337/v1",
            key_required: false,
            is_official: false,
        }
    }
    pub fn llamacpp() -> Self {
        Self {
            id: "llamacpp",
            default_base_url: "http://localhost:8080/v1",
            key_required: false,
            is_official: false,
        }
    }
    pub fn foundry() -> Self {
        Self {
            id: "foundry",
            default_base_url: "http://localhost:5273/v1",
            key_required: false,
            is_official: false,
        }
    }
    pub fn custom() -> Self {
        Self {
            id: "custom",
            // Custom için kullanıcının ChatOptions.endpoint vermesi beklenir;
            // boş bırakılırsa hata fırlatılır.
            default_base_url: "",
            key_required: false,
            is_official: false,
        }
    }

    fn resolve_base_url<'a>(&'a self, options: &'a ChatOptions) -> Result<&'a str, String> {
        if let Some(ep) = options.endpoint.as_deref() {
            let trimmed = ep.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed);
            }
        }
        if self.default_base_url.is_empty() {
            return Err("custom endpoint not configured".to_string());
        }
        Ok(self.default_base_url)
    }

    fn fallback_models(&self) -> Vec<AiModel> {
        if !self.is_official {
            // Yerel runtime'lar için fallback yok — kullanıcı kendi modellerini
            // çekmiş olmalı, runtime'a sorgu atılır. Kapalıysa boş liste döner.
            return Vec::new();
        }
        OPENAI_FALLBACK
            .iter()
            .map(|(id, l, c)| AiModel {
                id: (*id).into(),
                label: (*l).into(),
                context_window: Some(*c),
                supports_streaming: true,
            })
            .collect()
    }
}

#[async_trait]
impl ChatProvider for OpenAi {
    fn id(&self) -> &'static str {
        self.id
    }

    async fn models(&self, key: Option<&str>) -> Vec<AiModel> {
        if self.key_required && key.is_none() {
            return self.fallback_models();
        }
        // Yerel runtime'lar için: default base_url kullan; custom için bu
        // çağrı bypass edilir (custom models() için ChatOptions yok, listed
        // models çağrısı endpoint'siz yapılırsa varsayılan boş döner).
        let base = if self.default_base_url.is_empty() {
            return Vec::new();
        } else {
            self.default_base_url
        };
        let url = format!("{}/models", base.trim_end_matches('/'));
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        let mut req = client.get(&url);
        if let Some(k) = key {
            req = req.header("Authorization", format!("Bearer {k}"));
        }
        let resp = match req.send().await {
            Ok(r) if r.status().is_success() => r,
            _ => return self.fallback_models(),
        };
        let body: ModelsResp = match resp.json().await {
            Ok(b) => b,
            Err(_) => return self.fallback_models(),
        };
        let list: Vec<AiModel> = body
            .data
            .unwrap_or_default()
            .into_iter()
            .filter(|m| {
                if self.is_official {
                    m.id.starts_with("gpt") || m.id.starts_with("o3") || m.id.starts_with("o1")
                        || m.id.starts_with("chatgpt")
                } else {
                    // Yerel runtime'larda tüm modelleri göster
                    true
                }
            })
            .map(|m| AiModel {
                id: m.id.clone(),
                label: m.id,
                context_window: None,
                supports_streaming: true,
            })
            .collect();
        if list.is_empty() && self.is_official {
            self.fallback_models()
        } else {
            list
        }
    }

    async fn chat(
        &self,
        key: Option<&str>,
        messages: Vec<ChatMessage>,
        options: ChatOptions,
        mut on_chunk: ChunkSink,
    ) -> Result<(), String> {
        if self.key_required && key.is_none() {
            return Err("noKey".to_string());
        }
        let base = self.resolve_base_url(&options)?;
        let endpoint = format!("{}/chat/completions", base.trim_end_matches('/'));

        let body = json!({
            "model": options.model,
            "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
            "stream": true,
            "temperature": options.temperature,
            "max_tokens": options.max_tokens,
        });
        let client = reqwest::Client::new();
        let mut req = client.post(&endpoint).json(&body);
        if let Some(k) = key {
            req = req.header("Authorization", format!("Bearer {k}"));
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("network: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(format!("apiFailed:{status}:{}", &txt[..txt.len().min(200)]));
        }
        let mut stream = resp.bytes_stream().eventsource();
        while let Some(ev) = stream.next().await {
            let ev = ev.map_err(|e| format!("stream: {e}"))?;
            if ev.data == "[DONE]" || ev.data.is_empty() {
                continue;
            }
            let chunk: ChatChunk = match serde_json::from_str(&ev.data) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Some(choices) = chunk.choices {
                if let Some(c) = choices.into_iter().next() {
                    if let Some(d) = c.delta {
                        if let Some(text) = d.content {
                            if !text.is_empty() {
                                on_chunk(text);
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
