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

/// Custom/override endpoint validasyonu — SSRF koruması (sync, hızlı reddler).
/// Kabul edilenler: http(s) şeması + (localhost | loopback IP | public host).
/// Reddedilenler: file://, ftp://, vb. + private/link-local/multicast IP.
///
/// **Not:** Public hostname'ler için DNS resolve check'i `validate_endpoint_dns`
/// içinde yapılır (async, chat path'inde çağrılır). Bu fonksiyon tek başına
/// DNS rebinding'i kapatmaz — IP literal saldırılarını bloklar.
pub(crate) fn validate_endpoint(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalidUrl:{e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("invalidScheme:{other}")),
    }
    // Kimlik bilgisi gömülü URL (`https://user:pass@host`) ve query/fragment
    // kabul edilmez: path sonuna `/chat/completions` eklenirken query'li bir
    // URL (`http://localhost/admin?x=/chat/completions`) keyfi yerel path'e
    // POST atmaya izin veriyordu.
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("credentialsInUrl".to_string());
    }
    if parsed.query().is_some() || parsed.fragment().is_some() {
        return Err("queryNotAllowed".to_string());
    }
    let host = parsed.host_str().ok_or_else(|| "noHost".to_string())?;
    if is_localhost_name(host) {
        return Ok(());
    }
    if let Some(ip) = host_ip_literal(host) {
        return check_ip_public(&ip);
    }
    Ok(())
}

/// `localhost` / `localhost.` / `*.localhost` (RFC 6761) — hepsi loopback'e çözülür.
fn is_localhost_name(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h == "localhost" || h.ends_with(".localhost")
}

/// url crate IPv6'yı `[...]` parantez içinde döndürür; IpAddr parse için sıyır.
fn host_ip_literal(host: &str) -> Option<IpAddr> {
    host.strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(host)
        .parse::<IpAddr>()
        .ok()
}

/// Host loopback mu (localhost adı veya loopback IP literal)? Yerel runtime
/// endpoint override'ları yalnızca bu durumda kabul edilir.
pub(crate) fn is_loopback_host(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    let Some(host) = parsed.host_str() else {
        return false;
    };
    if is_localhost_name(host) {
        return true;
    }
    match host_ip_literal(host) {
        Some(IpAddr::V4(v4)) => v4.is_loopback(),
        Some(IpAddr::V6(v6)) => {
            v6.is_loopback() || v6.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
        }
        None => false,
    }
}

/// `scheme://host:port` — key'in hangi origin'e bağlı olduğunu karşılaştırmak için.
pub(crate) fn origin_of(url: &str) -> Option<String> {
    let parsed = reqwest::Url::parse(url).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    let port = parsed.port_or_known_default()?;
    Some(format!("{}://{}:{}", parsed.scheme(), host, port))
}

/// Tek bir IP'nin bağlanılabilir olup olmadığını kontrol eder. Loopback geçerli
/// kabul edilir (yerel runtime'lar için). Global unicast olmayan her şey
/// (private, link-local, CGNAT, benchmark, reserved, multicast, dokümantasyon,
/// IPv4-mapped/NAT64/6to4 içine gömülü private IPv4) reddedilir.
pub(crate) fn check_ip_public(ip: &IpAddr) -> Result<(), String> {
    match ip {
        IpAddr::V4(v4) => check_v4(*v4),
        IpAddr::V6(v6) => {
            if v6.is_loopback() {
                return Ok(());
            }
            // ::ffff:a.b.c.d (IPv4-mapped) — `[::ffff:169.254.169.254]` eskiden geçiyordu.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return check_v4(v4);
            }
            let segs = v6.segments();
            let embedded_v4 = |hi: u16, lo: u16| {
                std::net::Ipv4Addr::new((hi >> 8) as u8, hi as u8, (lo >> 8) as u8, lo as u8)
            };
            // 64:ff9b::/96 NAT64 — gömülü IPv4'ü kontrol et.
            if segs[0] == 0x0064 && segs[1] == 0xff9b && segs[2..6] == [0, 0, 0, 0] {
                return check_v4(embedded_v4(segs[6], segs[7]));
            }
            // 2002::/16 6to4 — gömülü IPv4 segs[1..3].
            if segs[0] == 0x2002 {
                return check_v4(embedded_v4(segs[1], segs[2]));
            }
            let reject = v6.is_unspecified()
                || v6.is_multicast()
                // Global unicast yalnızca 2000::/3; geri kalan her şey (::/8
                // IPv4-compatible dahil, fc00::/7 ULA, fe80::/10, fec0::/10) reddedilir.
                || segs[0] & 0xe000 != 0x2000
                // 2001::/32 Teredo, 2001:db8::/32 dokümantasyon, 2001:10::/28 ORCHID
                || (segs[0] == 0x2001 && (segs[1] == 0 || segs[1] == 0x0db8))
                || (segs[0] == 0x2001 && segs[1] & 0xfff0 == 0x0010);
            if reject {
                return Err(format!("privateIp:{v6}"));
            }
            Ok(())
        }
    }
}

fn check_v4(v4: std::net::Ipv4Addr) -> Result<(), String> {
    if v4.is_loopback() {
        return Ok(());
    }
    let o = v4.octets();
    let reject = v4.is_private()
        || v4.is_link_local()
        || v4.is_broadcast()
        || v4.is_documentation()
        || v4.is_unspecified()
        || v4.is_multicast()
        || o[0] == 0 // 0.0.0.0/8 "this network"
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // 100.64.0.0/10 CGNAT
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // 192.0.0.0/24 IETF protocol
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // 198.18.0.0/15 benchmark
        || o[0] >= 240; // 240.0.0.0/4 reserved
    if reject {
        return Err(format!("privateIp:{v4}"));
    }
    Ok(())
}

/// Async DNS resolve check — public hostname'in tüm resolved IP'lerinin de
/// public olduğunu doğrular ve kullanıcıya anlamlı bir hata verir.
///
/// Asıl koruma `ai::http_client()`'ın DNS resolver'ındadır: reqwest'in
/// gerçekte bağlandığı adresler orada süzülür, böylece bu ön kontrol ile
/// bağlantı arasındaki DNS rebinding (TOCTOU) penceresi de kapanır.
pub(crate) async fn validate_endpoint_dns(url: &str) -> Result<(), String> {
    validate_endpoint(url)?;
    let parsed = reqwest::Url::parse(url).map_err(|e| format!("invalidUrl:{e}"))?;
    let host = parsed.host_str().ok_or_else(|| "noHost".to_string())?;
    if is_localhost_name(host) {
        return Ok(());
    }
    if host_ip_literal(host).is_some() {
        return Ok(()); // literal IP — sync validate_endpoint zaten kontrol etti
    }
    let port = parsed.port_or_known_default().unwrap_or(443);
    let lookup_target = format!("{host}:{port}");
    // 5s timeout — DNS blackhole / blocked resolver durumunda chat çağrısı
    // sonsuz hang etmesin. Normal DNS round-trip 50-200ms; 5s hatalı network
    // için bile yeterli buffer. Timeout fail = chat fail (saldırgan resolver
    // hijack senaryosu da reddedilir).
    let lookup = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        tokio::net::lookup_host(&lookup_target),
    )
    .await
    .map_err(|_| "dnsResolveTimeout".to_string())?
    .map_err(|e| format!("dnsResolveFailed:{e}"))?;
    for sa in lookup {
        check_ip_public(&sa.ip())?;
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
    /// `stream_options.include_usage: true` ile son chunk'ta kesin token
    /// kullanımı gelir. Cloud'da [DONE]'dan hemen önceki chunk'tadır;
    /// yerel runtime'lar (Ollama-OpenAI compat, llama.cpp vs.) destekleyebilir
    /// veya destekleyemez.
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

    /// Endpoint override politikası:
    /// - resmi OpenAI: override YOK SAYILIR. Aksi halde webview'dan gelen
    ///   `endpoint` ile vault'taki `sk-…` key'i keyfi bir host'a
    ///   `Authorization: Bearer` olarak gönderilebiliyordu.
    /// - yerel runtime'lar (LM Studio, Jan, llama.cpp, Foundry): yalnızca
    ///   loopback host'a override (port değiştirme amaçlı).
    /// - custom: doğrulanmış her endpoint; key'in bu endpoint'e bağlı olup
    ///   olmadığı `commands::ai` içinde kontrol edilir.
    fn resolve_base_url<'a>(&'a self, options: &'a ChatOptions) -> Result<&'a str, String> {
        if let Some(ep) = options.endpoint.as_deref() {
            let trimmed = ep.trim();
            if !trimmed.is_empty() {
                if self.is_official {
                    tracing::warn!(
                        provider = self.id,
                        "endpoint override ignored for official provider"
                    );
                } else {
                    validate_endpoint(trimmed)?;
                    if !self.default_base_url.is_empty() && !is_loopback_host(trimmed) {
                        return Err("endpointMustBeLocal".to_string());
                    }
                    return Ok(trimmed);
                }
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
        let Ok(client) = super::http_client() else {
            return self.fallback_models();
        };
        let mut req = client.get(&url).timeout(std::time::Duration::from_secs(5));
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
        mut on_usage: super::UsageSink,
    ) -> Result<(), String> {
        if self.key_required && key.is_none() {
            return Err("noKey".to_string());
        }
        let base = self.resolve_base_url(&options)?;
        // DNS rebinding hardening — public hostname'in tüm resolved IP'lerinin
        // public olduğunu doğrula (M4). resolve_base_url sync validate_endpoint
        // ile literal IP saldırılarını kapatıyor; burada async DNS check ile
        // saldırgan-controlled domain → private IP rebind'i de kapatılır.
        validate_endpoint_dns(base).await?;
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
        // stream_options.include_usage: true → son chunk'ta kesin token usage.
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
        // Paylaşılan client: connect 5s, redirect yok, DNS filtreli.
        // Total timeout YOK ama stream içinde IDLE timeout (60s) var.
        let client = super::http_client()?;
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
            // Frontend'e sadece status code; provider hata gövdesi prompt/model
            // içeriği echo edebileceği için log'a hiç düşürmüyoruz (v0.9.8:
            // debug log filter env-driven olduğu için release'de bypass riski
            // vardı — body tamamen drop edildi). resp drop edilince stream kapanır.
            tracing::warn!(provider = self.id, status = %status, "AI API error");
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
            // include_usage: true → son chunk usage bloğu içerir
            // (choices boş olur). Frontend'e exact token rapor.
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

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn rejects_ipv4_mapped_and_embedded_private() {
        assert!(validate_endpoint("http://[::ffff:169.254.169.254]/").is_err());
        assert!(validate_endpoint("http://[::ffff:10.0.0.1]/").is_err());
        assert!(validate_endpoint("http://[64:ff9b::a00:1]/").is_err()); // NAT64 → 10.0.0.1
        assert!(validate_endpoint("http://[2002:a00:1::1]/").is_err()); // 6to4 → 10.0.0.1
        assert!(validate_endpoint("http://[::10.0.0.1]/").is_err()); // IPv4-compatible
        assert!(validate_endpoint("http://[fec0::1]/").is_err()); // site-local
        assert!(validate_endpoint("http://[2001:db8::1]/").is_err());
        // mapped loopback hâlâ loopback
        assert!(validate_endpoint("http://[::ffff:127.0.0.1]:1234/").is_ok());
        // gerçek global IPv6
        assert!(validate_endpoint("https://[2606:4700::1111]/").is_ok());
    }

    #[test]
    fn rejects_non_global_ipv4_ranges() {
        for ip in [
            "100.64.0.1",
            "100.127.255.254",
            "0.1.2.3",
            "198.18.0.1",
            "198.19.255.1",
            "240.0.0.1",
            "192.0.0.8",
        ] {
            assert!(validate_endpoint(&format!("http://{ip}/")).is_err(), "{ip}");
        }
        assert!(validate_endpoint("http://100.128.0.1/").is_ok());
        assert!(validate_endpoint("http://8.8.8.8/").is_ok());
    }

    #[test]
    fn rejects_query_and_credentials() {
        assert!(validate_endpoint("http://localhost/admin?x=/chat/completions").is_err());
        assert!(validate_endpoint("https://user:pw@example.com/v1").is_err());
        assert!(validate_endpoint("https://example.com/v1#frag").is_err());
    }

    #[test]
    fn loopback_host_detection() {
        assert!(is_loopback_host("http://localhost:1234/v1"));
        assert!(is_loopback_host("http://foo.localhost/v1"));
        assert!(is_loopback_host("http://127.0.0.5/"));
        assert!(is_loopback_host("http://[::1]/"));
        assert!(!is_loopback_host("https://evil.example/v1"));
        assert!(!is_loopback_host("http://10.0.0.1/"));
    }

    #[test]
    fn origin_normalization() {
        assert_eq!(
            origin_of("https://OpenRouter.ai/api/v1").as_deref(),
            Some("https://openrouter.ai:443")
        );
        assert_eq!(
            origin_of("http://localhost:1234/v1").as_deref(),
            Some("http://localhost:1234")
        );
    }

    fn opts(endpoint: &str) -> ChatOptions {
        ChatOptions {
            model: "m".into(),
            endpoint: Some(endpoint.into()),
            ..Default::default()
        }
    }

    #[test]
    fn official_provider_ignores_endpoint_override() {
        let p = OpenAi::cloud();
        let o = opts("https://evil.example/v1");
        assert_eq!(p.resolve_base_url(&o).unwrap(), "https://api.openai.com/v1");
    }

    #[test]
    fn local_runtime_override_must_be_loopback() {
        let p = OpenAi::lmstudio();
        assert!(p
            .resolve_base_url(&opts("https://evil.example/v1"))
            .is_err());
        assert_eq!(
            p.resolve_base_url(&opts("http://localhost:4321/v1"))
                .unwrap(),
            "http://localhost:4321/v1"
        );
    }

    #[test]
    fn custom_accepts_public_endpoint() {
        let p = OpenAi::custom();
        assert!(p
            .resolve_base_url(&opts("https://openrouter.ai/api/v1"))
            .is_ok());
        assert!(p.resolve_base_url(&ChatOptions::default()).is_err());
    }
}
