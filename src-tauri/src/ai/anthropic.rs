// Anthropic Claude — Messages API, SSE streaming.

use super::{
    send_with_retry, AiModel, ChatMessage, ChatOptions, ChatProvider, ChunkSink, UsageInfo,
    UsageSink,
};
use async_trait::async_trait;
use eventsource_stream::Eventsource;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::json;

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const VERSION: &str = "2023-06-01";

const MODELS: &[(&str, &str, u32)] = &[
    ("claude-opus-4-7", "Claude Opus 4.7", 1_000_000),
    ("claude-sonnet-4-6", "Claude Sonnet 4.6", 200_000),
    ("claude-haiku-4-5", "Claude Haiku 4.5", 200_000),
];

#[derive(Debug, Deserialize)]
struct Delta {
    #[serde(rename = "type")]
    kind: Option<String>,
    text: Option<String>,
}

/// Anthropic SSE message_start ve message_delta event'lerinde usage gelir.
/// message_start: input_tokens kesin; message_delta: output_tokens kesin son.
/// Bkz. https://docs.anthropic.com/en/api/messages-streaming
#[derive(Debug, Deserialize, Default)]
struct Usage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct Event {
    #[serde(rename = "type")]
    kind: Option<String>,
    delta: Option<Delta>,
    #[serde(default)]
    message: Option<EventMessage>,
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct EventMessage {
    #[serde(default)]
    usage: Option<Usage>,
}

pub struct Anthropic;

#[async_trait]
impl ChatProvider for Anthropic {
    fn id(&self) -> &'static str {
        "anthropic"
    }

    async fn models(&self, _key: Option<&str>) -> Vec<AiModel> {
        // Anthropic models endpoint var ama listesi statik kabul edilir.
        MODELS
            .iter()
            .map(|(id, label, ctx)| AiModel {
                id: (*id).into(),
                label: (*label).into(),
                context_window: Some(*ctx),
                supports_streaming: true,
            })
            .collect()
    }

    async fn chat(
        &self,
        key: Option<&str>,
        messages: Vec<ChatMessage>,
        options: ChatOptions,
        mut on_chunk: ChunkSink,
        mut on_usage: UsageSink,
    ) -> Result<(), String> {
        let key = key.ok_or_else(|| "noKey".to_string())?;

        // System mesajını ayır
        let mut system: Option<String> = None;
        let mut conv = Vec::new();
        for m in messages {
            if m.role == "system" {
                system = Some(m.content);
            } else {
                conv.push(json!({ "role": m.role, "content": m.content }));
            }
        }

        let mut body = json!({
            "model": options.model,
            "max_tokens": options.max_tokens.unwrap_or(4096),
            "stream": true,
            "messages": conv,
        });
        if let Some(t) = options.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(s) = system {
            body["system"] = json!(s);
        }

        // Connect timeout: API erişilemezse UI freeze olmasın.
        // Total timeout YOK (streaming uzun sürebilir) ama her chunk arası
        // IDLE timeout var: 60s yeni chunk gelmezse abort. Yarım kalmış
        // HTTP/2 stream'in Tauri runtime thread'ini sonsuza kadar tutmasını
        // engeller (rate-limited yanıt 60dk gecikse bile bizi takmaz).
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        // 429/503 için exponential backoff retry (max 3 deneme).
        let resp = send_with_retry(|| {
            client
                .post(ENDPOINT)
                .header("x-api-key", key)
                .header("anthropic-version", VERSION)
                .header("content-type", "application/json")
                .json(&body)
        })
        .await?;

        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            tracing::warn!(provider = "anthropic", status = %status, body = %&txt[..txt.len().min(80)], "AI API error");
            return Err(format!("apiFailed:{status}"));
        }

        // input_tokens'i message_start'tan, output_tokens'i message_delta'dan
        // birleştirip stream sonunda on_usage'a yolla. Anthropic resmi streaming
        // event akışı bu şekilde rapor eder.
        let mut input_tokens: u32 = 0;
        let mut output_tokens: u32 = 0;

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
            let parsed: Event = match serde_json::from_str(&ev.data) {
                Ok(p) => p,
                Err(_) => continue,
            };
            match parsed.kind.as_deref() {
                Some("content_block_delta") => {
                    if let Some(d) = parsed.delta {
                        if d.kind.as_deref() == Some("text_delta") {
                            if let Some(text) = d.text {
                                on_chunk(text);
                            }
                        }
                    }
                }
                Some("message_start") => {
                    if let Some(m) = parsed.message {
                        if let Some(u) = m.usage {
                            input_tokens = u.input_tokens;
                        }
                    }
                }
                Some("message_delta") => {
                    if let Some(u) = parsed.usage {
                        output_tokens = u.output_tokens;
                    }
                }
                _ => {}
            }
        }
        if input_tokens > 0 || output_tokens > 0 {
            on_usage(UsageInfo {
                input: input_tokens,
                output: output_tokens,
            });
        }
        Ok(())
    }
}
