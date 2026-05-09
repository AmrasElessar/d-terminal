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
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
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
        // Ollama options: temperature + num_predict (max_tokens karşılığı).
        let mut ollama_opts = serde_json::Map::new();
        if let Some(t) = options.temperature {
            ollama_opts.insert("temperature".to_string(), json!(t));
        }
        if let Some(mt) = options.max_tokens {
            ollama_opts.insert("num_predict".to_string(), json!(mt));
        }
        let body = json!({
            "model": options.model,
            "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
            "stream": true,
            "options": if ollama_opts.is_empty() { serde_json::Value::Null } else { serde_json::Value::Object(ollama_opts) },
        });
        // Connect timeout: yerel Ollama kapalıysa UI freeze olmasın.
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        let url = format!("{DEFAULT_BASE}/api/chat");
        // Ollama yerel runtime — 429 nadir ama 503 (model load) yaygın.
        let resp = super::send_with_retry(|| client.post(&url).json(&body)).await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            tracing::warn!(provider = "ollama", status = %status, body = %&txt[..txt.len().min(80)], "AI API error");
            return Err(format!("apiFailed:{status}"));
        }
        // NDJSON: bytes stream, satır bazlı buffer + IDLE timeout (60s/chunk)
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        loop {
            let next = tokio::time::timeout(std::time::Duration::from_secs(60), stream.next())
                .await
                .map_err(|_| "stream: idle timeout (60s)".to_string())?;
            let Some(chunk) = next else { break };
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
