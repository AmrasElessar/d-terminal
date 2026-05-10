// Google Gemini — OpenAI-compat endpoint kullanır.
// https://generativelanguage.googleapis.com/v1beta/openai/chat/completions

use super::{AiModel, ChatMessage, ChatOptions, ChatProvider, ChunkSink};
use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;

const ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/openai/models";

const FALLBACK: &[(&str, &str, u32)] = &[
    ("gemini-2.5-pro", "Gemini 2.5 Pro", 2_000_000),
    ("gemini-2.5-flash", "Gemini 2.5 Flash", 1_000_000),
    ("gemini-2.0-flash", "Gemini 2.0 Flash", 1_000_000),
    ("gemini-1.5-pro", "Gemini 1.5 Pro", 2_000_000),
    ("gemini-1.5-flash", "Gemini 1.5 Flash", 1_000_000),
];

#[derive(Debug, Deserialize)]
struct GeminiModelEntry {
    id: String,
}
#[derive(Debug, Deserialize)]
struct ModelsResp {
    data: Option<Vec<GeminiModelEntry>>,
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
    /// Gemini OpenAI-compat endpoint `stream_options.include_usage` ile son
    /// chunk'ta usage döner.
    #[serde(default)]
    usage: Option<UsageBlock>,
}

#[derive(Debug, Deserialize, Default)]
struct UsageBlock {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

fn fallback() -> Vec<AiModel> {
    FALLBACK
        .iter()
        .map(|(id, l, c)| AiModel {
            id: (*id).into(),
            label: (*l).into(),
            context_window: Some(*c),
            supports_streaming: true,
        })
        .collect()
}

pub struct Gemini;

#[async_trait]
impl ChatProvider for Gemini {
    fn id(&self) -> &'static str {
        "gemini"
    }

    async fn models(&self, key: Option<&str>) -> Vec<AiModel> {
        let Some(key) = key else { return fallback() };
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        let resp = match client
            .get(MODELS_URL)
            .header("Authorization", format!("Bearer {key}"))
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => r,
            _ => return fallback(),
        };
        let body: ModelsResp = match resp.json().await {
            Ok(b) => b,
            Err(_) => return fallback(),
        };
        let list: Vec<AiModel> = body
            .data
            .unwrap_or_default()
            .into_iter()
            .map(|m| m.id.trim_start_matches("models/").to_string())
            .filter(|id| id.starts_with("gemini-"))
            .map(|id| AiModel {
                id: id.clone(),
                label: id,
                context_window: None,
                supports_streaming: true,
            })
            .collect();
        if list.is_empty() {
            fallback()
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
        mut on_usage: super::UsageSink,
    ) -> Result<(), String> {
        let key = key.ok_or_else(|| "noKey".to_string())?;
        // Body — null parametreler dışarıda tutulur (M3); include_usage true.
        let mut body = json!({
            "model": options.model,
            "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
            "stream": true,
            "stream_options": { "include_usage": true },
        });
        if let Some(t) = options.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(m) = options.max_tokens {
            body["max_tokens"] = json!(m);
        }
        // Connect timeout: API erişilemezse UI freeze olmasın.
        // Total timeout YOK ama IDLE timeout (60s/chunk) var.
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        // 429/503 için exponential backoff retry (max 3 deneme).
        let resp = super::send_with_retry(|| {
            client
                .post(ENDPOINT)
                .header("Authorization", format!("Bearer {key}"))
                .json(&body)
        })
        .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            tracing::warn!(provider = "gemini", status = %status, "AI API error");
            tracing::debug!(provider = "gemini", body = %&txt[..txt.len().min(80)], "AI API error body");
            return Err(format!("apiFailed:{status}"));
        }
        let mut stream = resp.bytes_stream().eventsource();
        loop {
            let next = tokio::time::timeout(std::time::Duration::from_secs(60), stream.next())
                .await
                .map_err(|_| "stream: idle timeout (60s)".to_string())?;
            let Some(ev) = next else { break };
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
            if let Some(u) = chunk.usage {
                if u.prompt_tokens > 0 || u.completion_tokens > 0 {
                    on_usage(super::UsageInfo {
                        input: u.prompt_tokens,
                        output: u.completion_tokens,
                    });
                }
            }
        }
        Ok(())
    }
}
