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
use std::net::IpAddr;

/// Custom/override endpoint validasyonu — SSRF koruması.
/// Kabul edilenler: http(s) şeması + (localhost | loopback IP | public host).
/// Reddedilenler: file://, ftp://, vb. + private/link-local/multicast IP.
pub(crate) fn validate_endpoint(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalidUrl:{e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("invalidScheme:{other}")),
    }
    let host = parsed.host_str().ok_or_else(|| "noHost".to_string())?;
    if host.eq_ignore_ascii_case("localhost") {
        return Ok(());
    }
    // url crate IPv6'yı `[...]` parantez içinde döndürür; IpAddr parse için sıyır.
    let host_for_ip = host
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(host);
    if let Ok(ip) = host_for_ip.parse::<IpAddr>() {
        match ip {
            IpAddr::V4(v4) => {
                if v4.is_loopback() {
                    return Ok(());
                }
                if v4.is_private()
                    || v4.is_link_local()
                    || v4.is_broadcast()
                    || v4.is_documentation()
                    || v4.is_unspecified()
                    || v4.is_multicast()
                {
                    return Err(format!("privateIp:{v4}"));
                }
            }
            IpAddr::V6(v6) => {
                if v6.is_loopback() {
                    return Ok(());
                }
                if v6.is_unspecified() || v6.is_multicast() {
                    return Err(format!("privateIp:{v6}"));
                }
                let segs = v6.segments();
                // fc00::/7 unique-local
                if segs[0] & 0xfe00 == 0xfc00 {
                    return Err(format!("privateIp:{v6}"));
                }
                // fe80::/10 link-local
                if segs[0] & 0xffc0 == 0xfe80 {
                    return Err(format!("privateIp:{v6}"));
                }
            }
        }
    }
    Ok(())
}

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
    /// Resmi OpenAI cloud provider'ı (api.openai.com). Constructor adı
    /// type ile aynı olamaz (clippy: same_name_as_type) — `cloud()` semantik
    /// olarak da net (yerel runtime'lardan ayrı).
    pub fn cloud() -> Self {
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
                // SSRF koruması: yalnızca http/https + (localhost | loopback IP | açık host).
                // Custom provider için zorunlu, yerel runtime'lar default URL'e
                // sahip olduğu için bu yol genelde override içindir.
                validate_endpoint(trimmed)?;
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
                    m.id.starts_with("gpt")
                        || m.id.starts_with("o3")
                        || m.id.starts_with("o1")
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
        let trimmed = base.trim_end_matches('/');
        // Kullanıcı tam path verdiyse (örn. https://api.example.com/v1/chat/completions),
        // çiftleşmemek için olduğu gibi kullan.
        let endpoint = if trimmed.ends_with("/chat/completions") {
            trimmed.to_string()
        } else {
            format!("{trimmed}/chat/completions")
        };

        // Body — temperature/max_tokens null gönderilmez (vLLM/llama.cpp bazı
        // sürümlerinde 400 dönebilir; OpenAI cloud da temiz body'yi tercih eder).
        let mut body = json!({
            "model": options.model,
            "messages": messages.iter().map(|m| json!({"role": m.role, "content": m.content})).collect::<Vec<_>>(),
            "stream": true,
        });
        if let Some(t) = options.temperature {
            body["temperature"] = json!(t);
        }
        if let Some(m) = options.max_tokens {
            body["max_tokens"] = json!(m);
        }
        // Connect timeout: yerel/uzak runtime kapalıysa UI freeze olmasın.
        // Total timeout YOK ama stream içinde IDLE timeout (60s) var.
        let client = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap_or_default();
        // 429/503 için exponential backoff retry (max 3 deneme).
        let resp = super::send_with_retry(|| {
            let mut r = client.post(&endpoint).json(&body);
            if let Some(k) = key {
                r = r.header("Authorization", format!("Bearer {k}"));
            }
            r
        })
        .await?;
        if !resp.status().is_success() {
            let status = resp.status();
            let txt = resp.text().await.unwrap_or_default();
            // Body sadece Rust log'a — frontend'e status code yeter
            // (api key prefix/quota detay sızıntısını engeller).
            tracing::warn!(provider = self.id, status = %status, body = %&txt[..txt.len().min(80)], "AI API error");
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
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::validate_endpoint;

    #[test]
    fn allows_localhost_http() {
        assert!(validate_endpoint("http://localhost:11434").is_ok());
        assert!(validate_endpoint("http://localhost:1234/v1").is_ok());
        assert!(validate_endpoint("https://localhost").is_ok());
    }

    #[test]
    fn allows_loopback_ips() {
        assert!(validate_endpoint("http://127.0.0.1:8080").is_ok());
        assert!(validate_endpoint("http://127.1.2.3").is_ok());
        assert!(validate_endpoint("http://[::1]:1337").is_ok());
    }

    #[test]
    fn allows_public_https() {
        assert!(validate_endpoint("https://api.openai.com/v1").is_ok());
        assert!(validate_endpoint("https://openrouter.ai/api/v1").is_ok());
    }

    #[test]
    fn rejects_non_http_schemes() {
        assert!(validate_endpoint("file:///etc/passwd").is_err());
        assert!(validate_endpoint("ftp://example.com").is_err());
        assert!(validate_endpoint("javascript:alert(1)").is_err());
    }

    #[test]
    fn rejects_private_ipv4() {
        assert!(validate_endpoint("http://192.168.1.1").is_err());
        assert!(validate_endpoint("http://10.0.0.1").is_err());
        assert!(validate_endpoint("http://172.16.0.1").is_err());
        assert!(validate_endpoint("http://169.254.169.254/latest/meta-data").is_err());
        // AWS IMDS
    }

    #[test]
    fn rejects_private_ipv6() {
        // fc00::/7 unique-local
        assert!(validate_endpoint("http://[fc00::1]").is_err());
        // fe80::/10 link-local
        assert!(validate_endpoint("http://[fe80::1]").is_err());
    }

    #[test]
    fn rejects_invalid_url() {
        assert!(validate_endpoint("not a url").is_err());
        assert!(validate_endpoint("").is_err());
    }
}
