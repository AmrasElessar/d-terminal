// OpenAI — Chat Completions API, SSE streaming.

use super::{AiModel, ChatMessage, ChatOptions, ChatProvider, ChunkSink};
use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;

const ENDPOINT: &str = "https://api.openai.com/v1/chat/completions";
const MODELS_URL: &str = "https://api.openai.com/v1/models";

const FALLBACK: &[(&str, &str, u32)] = &[
    ("gpt-4o", "GPT-4o", 128_000),
    ("gpt-4o-mini", "GPT-4o mini", 128_000),
    ("o3", "o3", 200_000),
    ("o3-mini", "o3-mini", 200_000),
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

pub struct OpenAi;

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

#[async_trait]
impl ChatProvider for OpenAi {
    fn id(&self) -> &'static str {
        "openai"
    }

    async fn models(&self, key: Option<&str>) -> Vec<AiModel> {
        let Some(key) = key else { return fallback() };
        let client = reqwest::Client::new();
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
            .filter(|m| {
                m.id.starts_with("gpt") || m.id.starts_with("o3") || m.id.starts_with("chatgpt")
            })
            .map(|m| AiModel {
                id: m.id.clone(),
                label: m.id,
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
    ) -> Result<(), String> {
        let key = key.ok_or_else(|| "noKey".to_string())?;
        let body = json!({
            "model": options.model,
            "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
            "stream": true,
            "temperature": options.temperature,
            "max_tokens": options.max_tokens,
        });
        let client = reqwest::Client::new();
        let resp = client
            .post(ENDPOINT)
            .header("Authorization", format!("Bearer {key}"))
            .json(&body)
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
