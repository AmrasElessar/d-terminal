# Güvenlik Politikası

## Desteklenen Sürümler

Yalnızca en son stable sürüm güvenlik güncellemeleri alır.

| Sürüm  | Destek      |
| ------ | ----------- |
| 0.9.x  | ✓ Aktif     |
| < 0.9  | ✗ Destek dışı |

## Güvenlik Açığı Bildirimi

D-Terminal'de bir güvenlik açığı bulduysanız, lütfen **public issue
açmayın**. Bunun yerine:

1. **GitHub Security Advisory** üzerinden özel olarak bildirin:
   <https://github.com/AmrasElessar/d-terminal/security/advisories/new>
2. Veya repository sahibine e-posta ile ulaşın
   (GitHub profilindeki bağlantı).

Lütfen şunları ekleyin:

- Açığın türü (RCE, path traversal, SSRF, secret leak, vb.)
- Etkilenen modül/dosya yolu
- Tetikleme adımları (PoC ideal)
- Olası etki ve önerdiğiniz CWE sınıfı

İlk yanıtı **72 saat içinde** vermeye çalışırız.

## Tehdit Modeli

D-Terminal yerel bir Windows terminal uygulamasıdır. Tehdit modelimizde:

**Korunan varlıklar:**

- Kullanıcının AI provider API anahtarları (DPAPI + entropy ile şifrelenir,
  frontend'e plaintext sızdırılmaz)
- Lokal dosya sistemi (PTY shell whitelist + UNC reddi + path canonicalize)
- Outbound HTTP istekleri (SSRF guard: localhost + public hostname'ler;
  private/link-local/multicast IP reddi; DNS rebinding hardening)

**Kapsam dışı (sınırlamalarımız):**

- Same-user post-compromise: kullanıcının kendi makinesinde başka bir
  process çalıştıran saldırgan, DPAPI ile aynı kullanıcı altında secret'ları
  decrypt edebilir. Bu OS-level güven sınırıdır.
- Frontend XSS sonrası capability'lerin kötüye kullanımı: WebView2'nin XSS
  saldırı yüzeyi düşük, devtools release'de kapalı, CSP kısıtlı. Yine de
  frontend compromise olursa Tauri command'ları kullanılabilir.
- Supply chain: bağımlılıklar `cargo audit` + Dependabot ile taranır,
  ancak transitive supply chain saldırıları kapsam dışıdır.

## Güvenlik Uygulamaları

Aktif önlemler:

- ✓ DPAPI (Windows Data Protection) + per-user entropy ile secret storage
- ✓ Tauri capabilities ACL (`src-tauri/capabilities/default.json`)
- ✓ CSP politikası (yalnızca whitelist edilmiş localhost portları)
- ✓ PTY shell whitelist (`commands/pty.rs`) + env var blacklist + UNC reddi
- ✓ Path canonicalize + traversal segment reddi (snapshot save vb.)
- ✓ SQL prepared statements (rusqlite `params!` 100%)
- ✓ Reqwest rustls-tls (system root CA)
- ✓ Tauri updater minisign signature doğrulaması
- ✓ Release artifact'lar VirusTotal + Hybrid Analysis ile taranır
- ✓ `cargo audit` CI job'u her commit'te
- ✓ Dependabot grouped PR'larla minor/patch otomatik

## Açıklama Politikası

Bir güvenlik açığını düzelttikten sonra:

1. CHANGELOG'da CVE/CWE referansı + remediation özeti yayınlarız.
2. Kritik açıklar için release notes'ta belirtilir.
3. Reporters'lara (istenirse) credit verilir.

## Cryptographic Trust

- **DPAPI:** Windows OS-level credential vault. Per-user entropy ile
  rotation v0.9.4'te yapıldı. Legacy (NULL entropy) blob'lar v1.0'da
  kaldırılacak.
- **Tauri Updater:** minisign public key uygulamada embedded
  (`src-tauri/tauri.conf.json:73`). Key compromise durumunda v1.0'da
  rollover key mekanizması eklenecek.
