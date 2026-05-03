// Ollama — yerel sunucu (varsayılan localhost:11434), NDJSON streaming.

use super::{AiModel, ChatMessage, ChatOptions, ChatProvider, ChunkSink};
use async_trait::async_trait;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;

const DEFAULT_BASE: &str = "http://localhost:11434";

#[derive(Debug, Deserialize)]
struct Tag {
    name: String,
}
#[derive(Debug, Deserialize)]
struct TagsResp {
    models: Option<Vec<Tag>>,
}
#[derive(Debug, Deserialize)]
struct ChatMsg {
    content: Option<String>,
}
#[derive(Debug, Deserialize)]
struct ChatLine {
    message: Option<ChatMsg>,
}

pub struct Ollama;

#[async_trait]
impl ChatProvider for Ollama {
    fn id(&self) -> &'static str {
        "ollama"
    }

    async fn models(&self, _key: Option<&str>) -> Vec<AiModel> {
        let client = reqwest::Client::new();
        let url = format!("{DEFAULT_BASE}/api/tags");
        let resp = match client.get(&url).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => return Vec::new(),
        };
        let body: TagsResp = match resp.json().await {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        body.models
            .unwrap_or_default()
            .into_iter()
            .map(|t| AiModel {
                id: t.name.clone(),
                label: t.name,
                context_window: None,
                supports_streaming: true,
            })
            .collect()
    }

    async fn chat(
        &self,
        _key: Option<&str>,
        messages: Vec<ChatMessage>,
        options: ChatOptions,
        mut on_chunk: ChunkSink,
    ) -> Result<(), String> {
        let body = json!({
            "model": options.model,
            "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
            "stream": true,
            "options": options.temperature.map(|t| json!({ "temperature": t })),
        });
        let client = reqwest::Client::new();
        let url = format!("{DEFAULT_BASE}/api/chat");
        let resp = client
            .post(&url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("network: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            return Err(format!("apiFailed:{status}:{}", &txt[..txt.len().min(200)]));
        }
        // NDJSON: bytes stream, satır bazlı buffer
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("stream: {e}"))?;
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(idx) = buf.find('\n') {
                let line = buf[..idx].trim().to_string();
                buf.drain(..=idx);
                if line.is_empty() {
                    continue;
                }
                let parsed: ChatLine = match serde_json::from_str(&line) {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                if let Some(m) = parsed.message {
                    if let Some(text) = m.content {
                        if !text.is_empty() {
                            on_chunk(text);
                        }
                    }
                }
            }
        }
        Ok(())
    }
}
