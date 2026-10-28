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
    /// Ollama son chunk'ta `done: true` + token sayıları döner.
    /// Bkz. https://github.com/ollama/ollama/blob/main/docs/api.md#response-15
    #[serde(default)]
    done: bool,
    #[serde(default)]
    prompt_eval_count: u32,
    #[serde(default)]
    eval_count: u32,
}

pub struct Ollama;

/// `buf` içindeki tamamlanmış (`\n` ile biten) satırları çıkarıp UTF-8'e
/// çevirir; yarım kalan son satır (ve yarım çok baytlı karakter) buffer'da
/// sonraki chunk için bekler.
fn drain_lines(buf: &mut Vec<u8>) -> Vec<String> {
    let mut out = Vec::new();
    while let Some(idx) = buf.iter().position(|&b| b == b'\n') {
        let line: Vec<u8> = buf.drain(..=idx).collect();
        out.push(String::from_utf8_lossy(&line).trim().to_string());
    }
    out
}

#[async_trait]
impl ChatProvider for Ollama {
    fn id(&self) -> &'static str {
        "ollama"
    }

    async fn models(&self, _key: Option<&str>) -> Vec<AiModel> {
        let Ok(client) = super::http_client() else {
            return Vec::new();
        };
        let url = format!("{DEFAULT_BASE}/api/tags");
        let resp = match client
            .get(&url)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await
        {
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
        mut on_usage: super::UsageSink,
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
        // Paylaşılan client: connect timeout 5s — yerel Ollama kapalıysa UI
        // freeze olmasın.
        let client = super::http_client()?;
        let url = format!("{DEFAULT_BASE}/api/chat");
        // Ollama yerel runtime — 429 nadir ama 503 (model load) yaygın.
        let resp = super::send_with_retry(|| client.post(&url).json(&body)).await?;
        if !resp.status().is_success() {
            let status = resp.status();
            // Hata gövdesi prompt içeriğini echo edebilir — log'a yazılmaz.
            tracing::warn!(provider = "ollama", status = %status, "AI API error");
            return Err(format!("apiFailed:{status}"));
        }
        // NDJSON: bytes stream, satır bazlı buffer + IDLE timeout (60s/chunk).
        // Buffer byte olarak tutulur ve yalnızca tam satırlar UTF-8'e çevrilir:
        // ağ chunk'ı çok baytlı bir karakterin (ş, ğ, ı, emoji) ortasından
        // bölünürse chunk başına lossy decode U+FFFD üretiyordu.
        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        loop {
            let next = tokio::time::timeout(std::time::Duration::from_secs(60), stream.next())
                .await
                .map_err(|_| "stream: idle timeout (60s)".to_string())?;
            let Some(chunk) = next else { break };
            let chunk = chunk.map_err(|e| format!("stream: {e}"))?;
            buf.extend_from_slice(&chunk);
            for line in drain_lines(&mut buf) {
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
                // Ollama son chunk'ta `done: true` + exact token rapor.
                if parsed.done && (parsed.prompt_eval_count > 0 || parsed.eval_count > 0) {
                    on_usage(super::UsageInfo {
                        input: parsed.prompt_eval_count,
                        output: parsed.eval_count,
                    });
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::drain_lines;

    #[test]
    fn multibyte_char_split_across_chunks_is_preserved() {
        let full = "{\"x\":\"ş\"}\n".as_bytes();
        // 'ş' = C5 9F; ikinci baytın öncesinden böl.
        let split = full.iter().position(|&b| b == 0xC5).unwrap() + 1;
        let mut buf = Vec::new();
        buf.extend_from_slice(&full[..split]);
        assert!(drain_lines(&mut buf).is_empty());
        buf.extend_from_slice(&full[split..]);
        let lines = drain_lines(&mut buf);
        assert_eq!(lines, vec!["{\"x\":\"ş\"}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn keeps_partial_trailing_line() {
        let mut buf = b"a\nb\npartial".to_vec();
        assert_eq!(drain_lines(&mut buf), vec!["a", "b"]);
        assert_eq!(buf, b"partial");
    }
}
