# D-Terminal Mimari v1.1 — Değişiklikler ve Düzeltmeler

**Tarih**: 2026-05-02
**Önceki sürüm**: `D-Terminal-Mimari-v1.0.docx`
**Değişiklik sahibi**: Orhan Engin OKAY

Bu belge v1.0 mimari belgesindeki tutarsızlıkları, eksikleri ve scope düzeltmelerini listeler. v1.1 belgesi yazılmadan önce kabul edilmesi gereken değişiklikler.

---

## 1. Storage Layer netleşti — `better-sqlite3` kaldırıldı

**v1.0 (Tablo 1)**: `Storage Layer | SQLite (better-sqlite3)`

**v1.1**: `Storage Layer | Rust (rusqlite, WAL mode)`

**Detay**: ADR-0003. SQLite sadece Rust ana process'inde yaşar. Sidecar SQLite kullanmaz. Frontend Tauri command'leri üzerinden erişir.

---

## 2. PTY Sidecar IPC protokolü tanımlandı

**v1.0**: "Tauri'nin IPC köprüsü üzerinden iletişim" — protokol detayı yok.

**v1.1**: Length-prefixed binary frame, tek sidecar multiplexing (max 50 pane), ring buffer + SIGSTOP backpressure, heartbeat tabanlı crash detection.

**Detay**: ADR-0001.

---

## 3. Secret storage mekanizması netleşti

**v1.0 (17.3)**: "AES-256 ile şifreli SQLite" — master key kaynağı belirsiz.

**v1.1**: Windows DPAPI, per-user binding. Master key yok, OS yönetiyor. Plaintext key sadece API çağrısı süresince bellekte (`zeroize` ile temizlenir).

**README'ye eklenecek uyarı**: "Aynı Windows kullanıcı hesabında çalışan kötü amaçlı yazılım API key'lerinizi okuyabilir. Bu, browser password manager'ları ve 1Password dahil tüm desktop uygulamalarda geçerli olan bir trust modelidir."

**Detay**: ADR-0002.

---

## 4. Plugin sandbox modeli tanımlandı

**v1.0 (17.3)**: "Plugin'ler sandboxed çalışır" — mekanizma yok.

**v1.1**: Web Worker + capability-based permission API. Plugin manifest'inde permission listesi, kurulumda kullanıcı onayı, yüksek riskli capability'ler için runtime prompt. Render virtual node tabanlı (XSS imkânsız).

**Detay**: ADR-0004.

---

## 5. Rust unsafe kuralı düzeltildi

**v1.0 (13.5)**: "Rust unsafe sadece zorunlu PTY köprüsünde"

**Çelişki**: PTY köprüsü Node sidecar'da çalışıyor, Rust'ta değil.

**v1.1**: "Rust unsafe yasak. İstisna sadece Windows-rs FFI çağrılarında (DPAPI, sysinfo bazı alanlar) — minimum scope, yorumlu, review zorunlu."

---

## 6. MVP scope ikiye bölündü

**v1.0 (Bölüm 9.1)**: Tek MVP — 4 pane tipi, 4 AI provider, 6 tema, 2 dil, history, snippet, session, kısayollar.

**v1.1 — v1.0 (yayın hedefi 3-4 ay)**:
- Yatay/dikey split (grid yok, floating yok)
- 2 pane tipi: PowerShell + AI Chat
- 2 AI provider: Anthropic + Ollama
- 3 tema: D-Dark + D-Light + D-Matrix
- TR + EN
- 15 temel kısayol
- SQLite history (snippet/favori sonra)

**v1.1 — v1.0.5 (+2 ay)**:
- CMD + Log Stream pane
- OpenAI + Gemini provider
- Kalan 3 tema (Nord, Solarized, Retro)
- Snippet + favori sistemi
- Session save/load
- Grid layout

**v1.1 — v1.1+ (mevcut planlanan)**:
- Plugin API + marketplace
- HTTP/SSH pane
- Multi-agent orkestrasyon

**Why**: Tek geliştirici, 8 kalemlik MVP gerçekçi değil. Erken yayın = erken topluluk feedback.

---

## 7. i18n dil planı gerçekçileşti

**v1.0 (Tablo 7)**: TR, EN master + DE, FR, RU, ES "v1.0" işaretli.

**v1.1**:
- v1.0: Sadece TR + EN
- v1.0.5+: Topluluk PR'ları geldiğinde dil eklenir
- Eksik key fallback EN'e (boş string yerine)
- Crowdin/Weblate self-hosted v1.1 sonrası değerlendirilecek

**Why**: Çevirmen olmadan 6 dilli release boş string riski. Topluluk büyüdükçe doğal yayılım.

---

## 8. Pane Pipe Mode güvenliği eklendi

**v1.0 (5.3)**: Clipboard share, context injection — güvenlik notu yok.

**v1.1**:
- Clipboard share **opt-in** (varsayılan kapalı)
- Pre-send redaction: regex tabanlı secret pattern tespiti (`sk-...`, `ghp_...`, `password=...`), eşleşenler `[REDACTED]` olarak gönderilir
- Visual confirmation: AI'a gönderilmeden önce preview modal — "X satır redacte edildi"
- Kullanıcı kendi regex pattern'ini ekleyebilir

---

## 9. DFetch GPU bilgisi fallback chain'i

**v1.0 (12.3)**: "WMI bağımlılığı yoktur" — ancak `sysinfo` Windows GPU bilgisinde sınırlı.

**v1.1**: 3 katmanlı fallback:
1. `sysinfo` (hızlı, sınırlı)
2. DXGI enum adapters (Windows native, GPU adı + VRAM)
3. WMI (sadece DFetch için, async, son çare)

DFetch zaten 1x çağrılıyor; WMI'ı yasaklamak yerine "sadece burada, lazy" kuralı.

---

## 10. Test coverage ve performans budget'ı sayısallaştı

**v1.0 (17.4)**: Test araçları listesi, hedef yok.

**v1.1**:
- Unit test coverage: ≥ %70 (Rust + TS)
- Integration test coverage: ≥ %50 (kritik akışlar)
- E2E test: 10 senaryo (pane aç/kapat/split, AI chat, session save/restore, tema, kısayol, history search)
- Performance budget:
  - İlk pane render < 100ms
  - PTY input → render latency < 50ms
  - 60fps idle (1 pane, 1000 satır buffer)
  - Bundle boyutu: frontend < 2 MB gzipped, total binary < 15 MB
- CI gate: coverage düşerse veya budget aşılırsa PR merge bloklanır

---

## 11. Session restore matrisi tanımlandı

**v1.0 (5.2)**: "Process'ler yeniden başlar" — hangi state restore, hangisi değil belirsiz.

**v1.1**: Net restore matrisi:

| Element | Restore |
|---|---|
| Pane tipi, konum, boyut | ✅ |
| CWD, env vars | ✅ |
| Çalışan process | ❌ Yeniden spawn |
| Scrollback buffer | ⚙️ Opsiyonel (son 1000 satır) |
| Komut geçmişi | ✅ (zaten SQLite) |
| AI konuşma geçmişi | ✅ |
| AI yarım stream | ❌ İptal |
| SSH bağlantısı | ❌ Yeniden bağlan promptu |
| Pipe mode | ✅ |

---

## 12. Küçük düzeltmeler

- Tablo 5 model isimleri güncellenecek: `claude-opus-4` → `claude-opus-4-7` (Opus 4.7), `claude-sonnet-4-6` (Sonnet 4.6), `claude-haiku-4-5` (Haiku 4.5)
- 16.2 `tauri.conf.json` örneğindeki repo URL'si gerçek ile değiştirilecek (örn. `engin-demirel/d-terminal`)
- Bölüm 11 ("Açık Kaynak ve Topluluk") boş bırakılmış — katkı kategorileri tablosu eklenecek

---

## Uygulama Sırası

1. ✅ ADR-0001, 0002, 0003, 0004 yazıldı
2. ⏳ v1.0 belgesindeki çelişkili bölümler işaretlenecek
3. ⏳ v1.1 belgesi yeniden yazılacak (markdown olarak — `.docx` versioning için kötü)
4. ⏳ README scaffold (proje açılış metni, lisans, katkı rehberi)
5. ⏳ `CONTRIBUTING.md` — plugin/tema/dil katkı süreci

Hedef: kod yazımına başlamadan önce tüm ADR'lar `Accepted` durumunda, mimari belge v1.1 yayında.
