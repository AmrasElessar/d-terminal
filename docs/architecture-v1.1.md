# D-Terminal — Teknik Mimari Belgesi v1.1

**Agent-Aware Windows Terminal**

| Alan | Değer |
|---|---|
| Sürüm | 1.1 |
| Tarih | 2026-05-02 |
| Önceki | `D-Terminal-Mimari-v1.0.docx` |
| Yapımcı | Engin Demirel |
| Lisans | MIT |
| D Brand Ailesi | D-Player · DCar Launcher · D-Terminal |

---

## İçindekiler

1. [Vizyon ve Proje Kimliği](#1-vizyon-ve-proje-kimliği)
2. [Mimari Genel Bakış](#2-mimari-genel-bakış)
3. [Teknoloji Stack'i](#3-teknoloji-stacki)
4. [Evrensel AI Entegrasyonu](#4-evrensel-ai-entegrasyonu)
5. [Pane Sistemi ve Layout](#5-pane-sistemi-ve-layout)
6. [Tema Sistemi](#6-tema-sistemi)
7. [Çok Dil Desteği (i18n)](#7-çok-dil-desteği-i18n)
8. [Dağıtım ve Yayın Stratejisi](#8-dağıtım-ve-yayın-stratejisi)
9. [MVP Kapsamı ve Yol Haritası](#9-mvp-kapsamı-ve-yol-haritası)
10. [Proje Klasör Yapısı](#10-proje-klasör-yapısı)
11. [Açık Kaynak ve Topluluk](#11-açık-kaynak-ve-topluluk)
12. [DFetch — Sistem Bilgi Ekranı](#12-dfetch--sistem-bilgi-ekranı)
13. [Modüler Mimari, Performans ve Stabilite](#13-modüler-mimari-performans-ve-stabilite)
14. [Komut Geçmişi ve Yeniden Kullanım](#14-komut-geçmişi-ve-yeniden-kullanım)
15. [Erişilebilirlik ve Klavye Kısayolları](#15-erişilebilirlik-ve-klavye-kısayolları)
16. [Güncelleme Sistemi](#16-güncelleme-sistemi)
17. [Kalite Standartları ve ISO Uyumu](#17-kalite-standartları-ve-iso-uyumu)

---

## 1. Vizyon ve Proje Kimliği

D-Terminal, Windows platformu için tasarlanmış **agent-aware** (ajan farkındalıklı), çoklu pane yapısına sahip modern bir terminal uygulamasıdır. Temel hedefi, Linux/macOS'ta yaygın olan tmux/Warp benzeri çoklu görev deneyimini Windows'a getirmek ve bunu evrensel AI entegrasyonu ile zenginleştirmektir.

### 1.1 Motivasyon

Windows terminal ekosistemi belirgin bir boşluk barındırır:

- **Windows Terminal**: Tab/split var, AI farkındalığı ve agent stream görüntüleme yok
- **tmux**: Sadece WSL içinde, Windows'a native değil, görsel arayüz kısıtlı
- **Warp**: Mac/Linux only, Windows planı yok
- **Hyper, Tabby**: Görsel olarak güçlü, agent kavramından yoksun

D-Terminal bu boşluğu doldurmak için tasarlanmıştır: tek pencerede CMD, PowerShell, AI agent stream'leri ve özel pane tipleri bir arada çalışır.

### 1.2 D Brand Bağlantısı

D-Terminal, D Brand ailesinin Windows ayağıdır. Aile üyeleri "Denizhan" adından ilham alır:

| Proje | Platform | Açıklama |
|---|---|---|
| D-Player | Android | Kişisel müzik çalar, DSP motoru |
| DCar Launcher | Android Head Unit | Araç içi OS katmanı |
| D-Terminal | Windows | Agent-aware terminal (bu belge) |

### 1.3 Lisans ve Dağıtım

- **Lisans**: MIT — ticari kullanım dahil tamamen özgür
- **Birincil dağıtım**: GitHub Releases (MSIX + portable ZIP)
- **İkincil dağıtım**: Microsoft Store (ücretsiz uygulama)
- **Code signing**: SignPath Foundation veya Microsoft FOSS programı
- **Topluluk katkısı**: tema, dil paketi, pane plugin'leri

---

## 2. Mimari Genel Bakış

D-Terminal katmanlı bir mimari üzerine inşa edilmiştir. Her katman bağımsız geliştirilip test edilebilir.

### 2.1 Katman Yapısı

| Katman | Teknoloji | Açıklama |
|---|---|---|
| UI Katmanı | Vue 3 + TypeScript | Pane grid, tema sistemi, kullanıcı arayüzü |
| Session Manager | Rust (Tauri) | Pane yaşam döngüsü, layout state, kayıt/yükleme |
| Process Layer | node-pty sidecar | CMD/PowerShell spawn ve I/O köprüsü |
| AI Abstraction | TypeScript | Evrensel AI provider katmanı, OpenAI-compat |
| Plugin Layer | TypeScript (Web Worker) | Sandboxed pane tip registry — bkz. [ADR-0004](./adr/0004-plugin-worker-sandbox.md) |
| Storage Layer | **Rust + rusqlite (WAL)** | Session, geçmiş, ayarlar — bkz. [ADR-0003](./adr/0003-storage-rusqlite-only.md) |

**v1.0'dan değişiklik**: Storage Layer önceden `better-sqlite3` (Node) idi; tek storage process ilkesi gereği Rust tarafına alındı. Sidecar artık sadece PTY ile ilgilenir.

### 2.2 Pane Mimarisi

Her pane bağımsız bir context olarak modellenir. Kullanıcı pane oluştururken tipini seçer:

| Pane Tipi | Renderer | Açıklama |
|---|---|---|
| `cmd` | TerminalRenderer | Windows CMD instance |
| `powershell` | TerminalRenderer | PowerShell 7+ instance |
| `wsl` | TerminalRenderer | WSL2 shell (varsa) |
| `ai-chat` | AIRenderer | Seçili AI provider ile chat |
| `log-stream` | LogRenderer | Claude Code / process log akışı |
| `file-watch` | WatchRenderer | Dosya/klasör değişiklik izleme |
| `custom` | PluginRenderer | Topluluk plugin'i (Web Worker sandbox) |

---

## 3. Teknoloji Stack'i

Stack seçiminde üç kriter belirleyici olmuştur: uzun vadeli sürdürülebilirlik, Windows native performans ve Vue 3 ekosistemi ile uyum.

### 3.1 Core Stack

| Teknoloji | Versiyon | Kullanım Amacı |
|---|---|---|
| Tauri | v2.x | Cross-platform masaüstü shell, hafif binary (~5 MB) |
| Vue 3 | 3.x + Composition API | UI framework, D Brand ekosistemi uyumu |
| TypeScript | 5.x | Tip güvenliği, tüm katmanlarda strict mode |
| Vite | 6.x | Build tool, HMR desteği |
| Rust | stable | Tauri core, sistem API çağrıları |
| xterm.js | 5.x | Terminal rendering, VT100/ANSI emülasyon |
| node-pty | latest | PTY process management, Tauri sidecar olarak |
| **rusqlite** | 0.31+ | Local storage: session, history, config (WAL mode) |
| Pinia | 2.x | Reaktif state yönetimi |

### 3.2 Neden Tauri? (Electron Karşılaştırması)

| Kriter | Electron | Tauri v2 ✓ |
|---|---|---|
| Binary boyutu | 80–150 MB | 3–8 MB |
| RAM kullanımı | 200–400 MB | 50–120 MB |
| Windows native | Chromium bundle | WebView2 (sistem) |
| Güvenlik | Node.js full erişim | Rust permission model |

`node-pty` Tauri'de doğrudan çalışmaz. Çözüm: ayrı bir Node.js sidecar process. İletişim **length-prefixed binary frame protokolü** ile yapılır — detay için bkz. [ADR-0001](./adr/0001-pty-sidecar-ipc-protocol.md).

---

## 4. Evrensel AI Entegrasyonu

D-Terminal belirli bir AI provider'a bağımlı değildir. Sistem OpenAI-compatible API standardı üzerine inşa edilmiştir.

### 4.1 Desteklenen Provider'lar

| Provider | API Tipi | Notlar |
|---|---|---|
| Anthropic (Claude) | Native SDK | claude-opus-4-7, claude-sonnet-4-6, claude-haiku-4-5 |
| OpenAI (GPT) | Native | gpt-4o, o3 |
| Google (Gemini) | OpenAI compat | gemini-2.0-flash |
| Grok (xAI) | OpenAI compat | grok-3 |
| Mistral | OpenAI compat | mistral-large |
| Ollama (local) | OpenAI compat | Llama, Gemma, Phi — tamamen offline |
| LM Studio | OpenAI compat | Yerel model sunucusu |
| Özel endpoint | OpenAI compat | Kurumsal/şirket içi modeller |

### 4.2 AIProvider Abstraction

```typescript
interface AIProvider {
  name: string;
  chat(messages: Message[], options: ChatOptions): AsyncIterable<string>;
  models(): Promise<Model[]>;
  isAvailable(): Promise<boolean>;
}
```

Yeni provider eklemek için sadece adapter yazmak yeterlidir.

### 4.3 API Key Saklama

API key'ler **Windows DPAPI** ile şifrelenmiş olarak SQLite'ta saklanır. Master parola yok, OS yönetir. Plaintext key sadece API çağrısı süresince bellekte (`zeroize` ile temizlenir). Hiçbir key D-Terminal sunucusuna gönderilmez — zira böyle bir sunucu yoktur.

Detay: [ADR-0002](./adr/0002-secret-storage-dpapi.md).

### 4.4 AI Pane Kullanım Senaryoları

- Kullanıcı terminal pane'inde bir hata alır, yanındaki AI pane'ine yapıştırır, anında analiz ister
- Claude Code çalışırken log-stream pane'i açık kalır, AI pane'i ile log üzerine soru sorulur
- Birden fazla AI pane açılır, aynı soruya farklı modellerin cevabı karşılaştırılır
- Offline çalışma: Ollama pane'i ile internet bağlantısı olmadan yerel model kullanılır

---

## 5. Pane Sistemi ve Layout

D-Terminal'in kalbi pane sistemidir. Kullanıcı istediği kadar pane açabilir, yatay/dikey bölebilir, iç içe geçirebilir.

### 5.1 Layout Modelleri

- **Yatay split (HSplit)**: İki pane yan yana
- **Dikey split (VSplit)**: İki pane alt alta
- **Grid**: NxM ızgara düzeni (v1.0.5)
- **Floating**: Üste kayan pane (v1.1+)
- **Fullscreen**: Tek pane tam ekran, diğerleri arka planda çalışmaya devam eder

### 5.2 Pane Yaşam Döngüsü

```
IDLE → SPAWNING → RUNNING → SUSPENDED → CLOSED
                       ↓              ↑
                    ERROR ────────────┘
```

### 5.3 Session Restore Matrisi

Session her 30 saniyede SQLite'a yazılır. Restore davranışı:

| Element | Davranış |
|---|---|
| Pane tipi, konum, boyut | ✅ Tam restore |
| CWD (working directory) | ✅ Restore |
| Environment variables | ✅ Restore |
| Çalışan process | ❌ Yeniden spawn (kullanıcı manuel çalıştırır) |
| Terminal scrollback | ⚙️ Opsiyonel (son 1000 satır, ayardan açılır) |
| Komut geçmişi | ✅ Zaten SQLite'ta |
| AI konuşma geçmişi | ✅ Restore |
| AI yarım stream | ❌ İptal, kullanıcı yeniden sorar |
| SSH bağlantısı | ❌ Yeniden bağlanma promptu |
| Pipe mode bağlantıları | ✅ Yeniden kurulur |

### 5.4 Pane Arası İletişim

- **Pipe Mode**: Pane A'nın stdout'u Pane B'ye stdin olarak gönderilir (opt-in)
- **Clipboard Share**: Seçilen çıktı isteğe bağlı AI pane'ine gönderilir (varsayılan **kapalı**)
- **Context Injection**: Terminal pane'inin son N satırı AI konuşmasına eklenir

#### Güvenlik: Pre-send Redaction

Terminal çıktısı AI'a gönderilmeden önce regex tabanlı redaction'dan geçer:

```typescript
const SECRET_PATTERNS = [
  /\b(sk-[a-zA-Z0-9]{20,})\b/g,                                // OpenAI/Anthropic
  /\b(ghp_[a-zA-Z0-9]{36})\b/g,                                 // GitHub PAT
  /(?:password|token|api[_-]?key)\s*[:=]\s*['"]?([^\s'"]+)/gi,  // Generic
  /\bAKIA[0-9A-Z]{16}\b/g,                                      // AWS access key
];
```

Eşleşen değerler `[REDACTED]` ile değiştirilir. Kullanıcıya gönderim öncesi preview modal — "X satır redacte edildi" uyarısı.

---

## 6. Tema Sistemi

Tema sistemi JSON tabanlıdır. Kullanıcılar mevcut temaları özelleştirebilir, yeni tema oluşturabilir, toplulukla paylaşabilir.

### 6.1 Tema JSON Yapısı

```json
{
  "name": "D-Terminal Dark",
  "author": "Engin Demirel",
  "version": "1.0.0",
  "colors": {
    "background": "#0A0E1A",
    "foreground": "#E2E8F0",
    "accent": "#00B4D8",
    "accent2": "#7C3AED",
    "cursor": "#00B4D8",
    "selection": "#1E3A5F",
    "black": "#1A1F2E",
    "red": "#FF5F57",
    "green": "#28C840",
    "yellow": "#FFBD2E",
    "blue": "#1E90FF",
    "magenta": "#B47AEA",
    "cyan": "#00B4D8",
    "white": "#E2E8F0"
  },
  "font": { "family": "JetBrains Mono", "size": 14, "ligatures": true },
  "ui": { "blur": 12, "opacity": 0.92, "borderRadius": 8, "glowEffect": true },
  "paneTitle": { "gradient": ["#00B4D8", "#7C3AED"] }
}
```

### 6.2 Dahili Temalar

| Tema | Sürüm | Açıklama |
|---|---|---|
| D-Dark (varsayılan) | v1.0 | Koyu, neon cyan aksan — D Brand stili |
| D-Light | v1.0 | Açık tema, ofis ortamı |
| D-Matrix | v1.0 | Yeşil karakterler, tam Matrix estetiği |
| D-Nord | v1.0.5 | Soğuk mavi tonları, minimal |
| D-Solarized | v1.0.5 | Sıcak sarı-kırmızı, gün boyu kullanım |
| D-Retro | v1.0.5 | CRT fosfor efekti, amber renk paleti |

### 6.3 Tema Paylaşımı

Topluluk temaları GitHub'da `d-terminal-themes` repository'sinde toplanır. Uygulama içinden browse, install, uninstall (v1.1). Tema dosyaları `%APPDATA%\D-Terminal\themes\` altında saklanır.

---

## 7. Çok Dil Desteği (i18n)

### 7.1 Dil Planı

| Dil | Kod | Statü |
|---|---|---|
| Türkçe | tr | v1.0 master ✓ |
| İngilizce | en | v1.0 master ✓ |
| Almanca, Fransızca, İspanyolca, Rusça vb. | — | Topluluk PR'larıyla, geldikçe |

**v1.0'dan değişiklik**: Çevirmen olmadan çoklu dil release etmek boş string riski. v1.0'da sadece TR + EN; topluluk büyüdükçe diller eklenir.

### 7.2 Teknik Yaklaşım

- Vue I18n v9 (Composition API modu)
- Dil dosyaları: `/locales/tr.json`, `/locales/en.json`
- Otomatik dil algılama: Windows sistem dili
- Runtime dil değişimi: Sayfa yenilenmeden geçiş
- Eksik key fallback: EN'e (boş string yerine)
- Topluluk çevirileri: GitHub PR workflow (v1.1+ için Crowdin/Weblate self-hosted)

---

## 8. Dağıtım ve Yayın Stratejisi

### 8.1 GitHub Releases

- MSIX paket: Windows 10/11 native kurulum
- Portable ZIP: Kurulum gerektirmez, USB'den çalışır
- Otomatik güncelleme: Tauri Updater API
- Release notes: TR + EN

### 8.2 Microsoft Store

- MSIX paketi Store formatına uygun
- Ücretsiz uygulama olarak listelenir
- Store imzası SmartScreen sorununu ortadan kaldırır
- Otomatik Windows Update entegrasyonu

### 8.3 Code Signing Yol Haritası

| Aşama | Aksiyon |
|---|---|
| İlk release | SmartScreen uyarısı olur, README'de açıklanır ("More info → Run anyway") |
| Kısa vadeli | SignPath Foundation başvurusu (açık kaynak, ücretsiz) |
| Alternatif | Microsoft FOSS programına başvuru |
| Store sonrası | Store imzası devreye girer, tüm uyarılar kalkar |

---

## 9. MVP Kapsamı ve Yol Haritası

**v1.0'dan değişiklik**: Tek geliştirici için 8 kalemlik MVP gerçekçi değil. Scope iki sürüme bölündü.

### 9.1 v1.0 — Yayın Hedefi (3-4 ay)

- Yatay/dikey split (grid yok, floating yok)
- 2 pane tipi: PowerShell + AI Chat
- 2 AI provider: Anthropic + Ollama (offline garantisi)
- 3 tema: D-Dark + D-Light + D-Matrix
- TR + EN
- 15 temel kısayol
- SQLite history (snippet/favori sonra)
- Session save/load (temel)

### 9.2 v1.0.5 — Tamamlayıcı (+2 ay)

- CMD + Log Stream pane
- OpenAI + Gemini provider
- Kalan 3 tema (Nord, Solarized, Retro)
- Snippet + favori sistemi
- Grid layout
- Komut geçmişi gelişmiş arama (fuzzy, regex)

### 9.3 v1.1 — Topluluk Özellikleri

- **Plugin API**: Web Worker + capability-based permission ([ADR-0004](./adr/0004-plugin-worker-sandbox.md))
- Tema marketplace: Uygulama içi browse/install
- HTTP Request pane: REST client entegrasyonu
- SSH pane: Uzak sunucu bağlantısı
- Pipe mode: Pane arası veri akışı (UI)

### 9.4 v2.0 — Gelişmiş AI Entegrasyonu

- Multi-agent orkestrasyon: Pane'ler arası AI koordinasyonu
- Terminal AI assist: Komut önerisi, hata açıklama
- Context-aware AI: Terminal çıktısı otomatik AI context'ine eklenir
- Agent monitoring dashboard: Tüm agent pane'lerinin durum özeti

---

## 10. Proje Klasör Yapısı

```
d-terminal/
├── src-tauri/              # Rust core
│   ├── src/
│   │   ├── main.rs         # Tauri entrypoint
│   │   ├── commands/       # IPC komutları (history, session, secrets)
│   │   ├── session/        # Session manager
│   │   ├── sidecar/        # PTY sidecar protokolü ve manager
│   │   ├── secrets/        # DPAPI wrapper, SecretStore trait
│   │   └── storage/        # rusqlite + migration
│   ├── migrations/         # SQL migration dosyaları
│   └── Cargo.toml
├── src/                    # Vue 3 frontend
│   ├── components/
│   │   ├── panes/          # Pane renderer'ları
│   │   ├── layout/         # Grid, split sistemi
│   │   └── ui/             # Genel UI bileşenleri
│   ├── stores/             # Pinia stores
│   ├── providers/          # AI provider adapter'ları
│   ├── plugins/            # Plugin host + sandbox
│   ├── locales/            # i18n dil dosyaları
│   └── main.ts
├── sidecar/                # node-pty process
│   ├── pty-bridge.js       # Frame protokolü + multiplexer
│   └── package.json
├── themes/                 # Dahili tema JSON'ları
├── docs/                   # Proje belgeleri (mimari, ADR'lar)
└── .github/workflows/      # CI
```

---

## 11. Açık Kaynak ve Topluluk

D-Terminal MIT lisansıyla yayınlanır. Topluluk katkıları şu alanlarda beklenmektedir:

| Katkı Alanı | Detay |
|---|---|
| Dil paketleri | `/locales/` klasörüne yeni `.json` dosyası, PR ile |
| Temalar | `d-terminal-themes` repo'suna JSON tema |
| AI provider adapter | `/providers/` klasörüne yeni adapter |
| Pane plugin'leri | Plugin API kullanarak özel renderer (v1.1+) |
| Bug report / PR | GitHub Issues ve Pull Request |

Proje GitHub'da Engin Demirel (D Brand) tarafından yönetilir. README'de D Brand ailesinin hikayesi paylaşılır.

---

## 12. DFetch — Sistem Bilgi Ekranı

DFetch, neofetch benzeri yerleşik sistem bilgi ekranıdır.

### 12.1 Tetiklenme Modları

| Mod | Açıklama |
|---|---|
| Uygulama açılışı | Welcome pane, 2 saniye sonra otomatik kapanır |
| Yeni session | Session başlangıcında üst banner |
| `dfetch` komutu | Terminale yazıldığında inline render |
| Devre dışı | Ayardan tamamen kapatılabilir |

### 12.2 Toplanan Bilgiler

| Bilgi | Birincil Kaynak |
|---|---|
| OS + Build | Windows Registry |
| CPU model + çekirdek | `sysinfo` crate |
| RAM (kullanılan/toplam) | `sysinfo` crate |
| **GPU** | `sysinfo` → DXGI fallback → WMI fallback |
| Disk (C:\ kullanılan/toplam) | `sysinfo` crate |
| Ağ adaptörü + lokal IP | `sysinfo` crate |
| Uptime | `sysinfo` crate |
| D-Terminal versiyonu | Tauri app metadata |
| Aktif pane sayısı | Session Manager |
| Bağlı AI provider | AI Abstraction katmanı |

**v1.0'dan değişiklik**: GPU bilgisinde `sysinfo` Windows'ta sınırlı. 3 katmanlı fallback chain:
1. `sysinfo` (hızlı, sınırlı)
2. DXGI enum adapters (Windows native, GPU adı + VRAM)
3. WMI sorgusu (sadece DFetch için, async, son çare)

### 12.3 Implementasyon Notu

```rust
// src-tauri/src/commands/dfetch.rs
#[tauri::command]
pub fn get_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();
    SystemInfo {
        os: sys.long_os_version().unwrap_or_default(),
        cpu: sys.global_cpu_info().brand().to_string(),
        cores: sys.physical_core_count().unwrap_or(0),
        ram_used: sys.used_memory(),
        ram_total: sys.total_memory(),
        gpu: gpu_info_with_fallback(),
        uptime: sys.uptime(),
    }
}
```

### 12.4 ASCII Art ve Tema Uyumu

- D-T ASCII logo: Sabit, ~6 satır yükseklik
- Renk: Aktif temanın `accent` rengi
- Kullanıcı kendi ASCII art'ını JSON tema dosyasında tanımlayabilir
- Minimal mod: Sadece tek satır özet (ayardan açılır)

---

## 13. Modüler Mimari, Performans ve Stabilite

### 13.1 Modülerlik İlkeleri

- Her modül tek sorumluluk taşır (Single Responsibility)
- Modüller arası iletişim sadece tanımlı interface üzerinden
- Hiçbir modül başka bir modülün iç implementasyonuna dokunmaz
- Yeni özellik = yeni modül; mevcut modülü değiştirmez
- Plugin'ler core'a dokunmadan register edilir (ADR-0004)

### 13.2 Modül Sınırları

| Modül | Sorumluluk | Public Interface |
|---|---|---|
| `SessionManager` | Pane yaşam döngüsü, layout | `createPane` / `closePane` / `saveSession` |
| `PtyBridge` | PTY spawn, I/O akışı | `write(data)` / `onData(cb)` / `kill()` |
| `AIProvider` | AI API çağrıları | `chat()` / `models()` / `isAvailable()` |
| `ThemeEngine` | Tema yükleme, uygulama | `load(name)` / `apply()` / `list()` |
| `HistoryStore` | Komut geçmişi SQLite | `add()` / `search()` / `recent()` |
| `SecretStore` | Şifreli credential storage | `store()` / `retrieve()` / `delete()` / `list()` |
| `DFetch` | Sistem bilgisi toplama | `getSystemInfo()` |
| `PluginRegistry` | Plugin kayıt, resolve, sandbox | `register()` / `resolve(type)` |
| `I18n` | Dil yönetimi | `t(key)` / `setLocale(lang)` |

### 13.3 Performans Kuralları

- PTY output debounce — her karakter DOM güncellenmez, 16ms batch
- xterm.js virtual scroll aktif — sadece görünür satırlar DOM'da
- AI stream chunk'ları throttle — UI 60fps altına düşmez
- `sysinfo` singleton — her dfetch çağrısında yeniden instance yok, lazy refresh
- SQLite sorguları async (`tokio::task::spawn_blocking`) — ana thread bloklanmaz
- Tema değişimi CSS variables ile — komponent yeniden render edilmez
- Pane kapatıldığında PTY hard kill + bellek temizliği garantili
- Session yükleme lazy — pane'ler sıralı açılır

#### Performance Budget

| Metrik | Hedef |
|---|---|
| İlk pane render | < 100ms |
| PTY input → render latency | < 50ms |
| 60fps idle (1 pane, 1000 satır) | ✓ |
| Frontend bundle (gzipped) | < 2 MB |
| Total binary | < 15 MB |
| RAM (1 PowerShell pane) | < 120 MB |

### 13.4 Stabilite Garantileri

- PTY process'leri Tauri kapanışında otomatik temizlenir (cleanup hook)
- xterm.js buffer limiti yapılandırılabilir, varsayılan 10.000 satır
- AI stream'leri AbortController ile iptal edilebilir, GC garantili
- Plugin hataları izole edilir — bir plugin çöktüğünde ana uygulama etkilenmez (Worker scope)
- SQLite WAL mode aktif — okuma/yazma çakışması olmaz
- **Crash recovery**: Session state her 30 saniyede SQLite'a yazılır
- Sidecar crash detection: heartbeat ([ADR-0001](./adr/0001-pty-sidecar-ipc-protocol.md))
- Rust panic'leri UI'a graceful error olarak yansır — uygulama kapanmaz

### 13.5 Kod Kalitesi Kuralları

| Kural | Detay |
|---|---|
| TypeScript strict mode | `any` yasak, her tip tanımlı |
| Vue Composition API only | Options API kullanılmaz |
| Pinia store boyutu | Max 200 satır — büyürse bölünür |
| Komponent boyutu | Max 300 satır `.vue` — büyürse parçalanır |
| **Rust unsafe** | Yasak. İstisna sadece `windows-rs` FFI çağrılarında (DPAPI, sysinfo bazı alanlar) — minimum scope, yorumlu, review zorunlu |
| Bundle analizi | Her release'de `vite-bundle-analyzer` |

**v1.0'dan değişiklik**: v1.0'da "PTY köprüsünde unsafe" deniyordu, ama PTY köprüsü Node sidecar'da çalışıyor; Rust'ta unsafe sadece Win32 FFI için.

---

## 14. Komut Geçmişi ve Yeniden Kullanım

### 14.1 Geçmiş Katmanları

| Katman | Açıklama |
|---|---|
| Shell native | CMD: `doskey` / PowerShell: PSReadLine — korunur, dokunulmaz |
| Pane geçmişi | Pane bazında SQLite — pane kapansa da kalıcı |
| Global geçmiş | Tüm pane'lerin birleşik geçmişi, aranabilir |
| Favori komutlar | Pin'lenen komutlar, hızlı erişim |
| Snippet'lar | İsimlendirilmiş komut grupları, tek tuşla |

### 14.2 Arama ve Filtre

- `Ctrl+R`: Fuzzy search (fzf benzeri)
- Pane filtresi, zaman filtresi, başarı filtresi (exit code 0)
- Regex desteği

### 14.3 SQLite Şeması

```sql
CREATE TABLE command_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  command     TEXT NOT NULL,
  pane_id     TEXT,
  pane_type   TEXT,
  exit_code   INTEGER,
  duration_ms INTEGER,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_favorite BOOLEAN DEFAULT 0,
  tags        TEXT          -- JSON array
);

CREATE TABLE snippets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  description TEXT,
  shortcut    TEXT
);

CREATE TABLE secrets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,    -- 'ai_provider' | 'ssh' | 'plugin'
  name          TEXT NOT NULL,
  ciphertext    BLOB NOT NULL,    -- DPAPI ile şifrelenmiş
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME,
  UNIQUE(scope, name)
);
```

### 14.4 PowerShell Entegrasyonu

- PSReadLine geçmişi okunur, D-Terminal geçmişiyle merge edilir
- Çift kayıt önlenir
- PSReadLine tuş atamaları korunur
- Execution policy değiştirilmez

### 14.5 CMD Entegrasyonu

- Önceki session komutları `doskey` macro olarak inject edilir
- Exit code: native `ERRORLEVEL` okunur
- Renkli prompt: ANSI escape inject (Windows 10 1511+)
- `cmd /k` ile custom init script desteği

---

## 15. Erişilebilirlik ve Klavye Kısayolları

D-Terminal fare kullanmadan tamamen klavye ile yönetilebilir.

### 15.1 Global Kısayollar

| Kısayol | İşlev |
|---|---|
| `Ctrl + Shift + T` | Yeni pane (tip seçici) |
| `Ctrl + Shift + W` | Aktif pane'i kapat |
| `Ctrl + Shift + \` | Yatay split |
| `Ctrl + Shift + -` | Dikey split |
| `Ctrl + Tab` / `Shift + Tab` | Sonraki / önceki pane |
| `Alt + Ok tuşları` | Yön bazlı pane navigasyonu |
| `Ctrl + Shift + F` | Global geçmiş fuzzy search |
| `Ctrl + Shift + S` / `O` | Session kaydet / yükle |
| `Ctrl + Shift + A` | AI pane aç |
| `Ctrl + Shift + D` | dfetch çalıştır |
| `Ctrl + Shift + ,` | Ayarlar |
| `F11` | Tam ekran |
| `Ctrl + Shift + Z` | Aktif pane'i maximize / geri al |

### 15.2 Pane İçi Kısayollar

| Kısayol | İşlev |
|---|---|
| `Ctrl + R` | Pane geçmişi fuzzy search |
| `Ctrl + C` | Çalışan process'i durdur |
| `Ctrl + L` | Ekranı temizle |
| `Ctrl + U` / `K` | Satır temizle / imleçten sona sil |
| `Ctrl + A` / `E` | Satır başı / sonu |
| `Ctrl + Shift + C` / `V` | Kopyala / yapıştır |
| `Ctrl + Shift + F` | Pane içi metin ara |
| `Ctrl + +` / `-` / `0` | Font boyutu artır / azalt / sıfırla |
| `Shift + PgUp` / `PgDn` | Scroll |

### 15.3 Özelleştirme

- Tüm kısayollar JSON config'ten özelleştirilebilir
- Çakışma tespiti otomatik
- Profil desteği
- Vim modu opsiyonel (v1.1+)

### 15.4 Erişilebilirlik (ISO 40500 / WCAG 2.1)

| Kriter | Seviye | Uygulama |
|---|---|---|
| Klavye navigasyon | AA | Tüm işlevler klavyeyle |
| Renk kontrastı | AA | Tema sistemi min 4.5:1 zorlar |
| Focus görünürlüğü | AA | Aktif pane her zaman görsel olarak belli |
| Font boyutu | AA | Runtime değiştirilebilir |
| Animasyon azaltma | AAA | OS "reduce motion" ayarını okur |
| Yüksek kontrast | AA | Windows yüksek kontrast modu desteklenir |

---

## 16. Güncelleme Sistemi

### 16.1 Kanal Karşılaştırması

| Kriter | GitHub + In-App | Microsoft Store |
|---|---|---|
| Hız | Anında (release sonrası dk) | Store onay süreci (1-3 gün) |
| Bildirim | Uygulama içi banner | Store otomatik günceller |
| Rollback | GitHub'dan önceki release | Desteklenmiyor |
| Beta kanal | Pre-release tag | Ayrı listing |
| İmza | SignPath sertifikası | Store imzası |

### 16.2 Tauri In-App Updater

GitHub Releases üzerinden Tauri'nin yerleşik güncelleme sistemi:

1. Açılışta arka planda kontrol (startup'ı yavaşlatmaz)
2. Yeni sürüm varsa sağ alt köşede minimal bildirim
3. Kullanıcı 'Güncelle' derse arka planda indirir
4. Kurulum için yeniden başlatma — kullanıcı onayı
5. Session state güncelleme öncesi otomatik kayıt, sonrasında restore

```json
// tauri.conf.json
"updater": {
  "active": true,
  "endpoints": ["https://github.com/<user>/d-terminal/releases/latest/download/update.json"],
  "dialog": false,
  "pubkey": "..."
}
```

### 16.3 Sürüm Kanalları

| Kanal | Tag | Hedef |
|---|---|---|
| Stable | `v1.0.0` | Tüm kullanıcılar — varsayılan |
| Beta | `v1.1.0-beta.1` | Test edenler — opt-in |
| Nightly | `nightly-YYYY-MM-DD` | Geliştiriciler — opt-in |

### 16.4 Microsoft Store Onay

- MSIX paketi: Tauri v2 native desteğiyle otomatik
- Gizlilik politikası: API key'lerin yerel tutulduğu açıklaması zorunlu
- Yaş derecelendirmesi: Everyone
- İzin beyanı: Shell process spawn (node-pty), network (AI API)

VS Code, Windows Terminal, Notepad++ gibi onlarca terminal/geliştirici aracı Store'da aktif. Red flag yok.

---

## 17. Kalite Standartları ve ISO Uyumu

D-Terminal resmi sertifikasyon almak yerine ISO standartlarının ilkelerini geliştirme sürecine entegre eder.

### 17.1 Uygulanan Standartlar

| Standart | Kapsam | D-Terminal Uygulaması |
|---|---|---|
| ISO/IEC 25010 | Yazılım ürün kalitesi | Performans, güvenilirlik, bakım kriterleri tasarım kararlarını yönlendirir |
| ISO/IEC 27001 | Bilgi güvenliği | DPAPI ile credential storage, hiçbir credential dışarı çıkmaz (ADR-0002) |
| ISO 40500 (WCAG 2.1) | Erişilebilirlik | AA seviyesi |
| ISO/IEC 9241-11 | Kullanılabilirlik | Etkinlik, verimlilik, memnuniyet metrikleri |
| ISO/IEC 12207 | Yazılım yaşam döngüsü | Gereksinim → tasarım → geliştirme → test → dağıtım → bakım |
| ISO/IEC 90003 | Yazılımda kalite yönetimi | Code review, test coverage, sürüm yönetimi |

### 17.2 ISO/IEC 25010 Kalite Kriterleri

| Kriter | Somut Uygulama |
|---|---|
| Performans verimliliği | PTY debounce, virtual scroll, lazy session, 60fps |
| Güvenilirlik | Crash recovery (30s SQLite), PTY cleanup, plugin izolasyonu |
| Güvenlik | DPAPI credential, Rust permission, Tauri CSP |
| Kullanılabilirlik | WCAG AA, özelleştirilebilir kısayollar, tema |
| Bakım kolaylığı | Modüler mimari, max komponent boyutu, TypeScript strict |
| Taşınabilirlik | Windows 10 1511+ desteği, portable ZIP |
| Uyumluluk | OpenAI-compat AI API, xterm.js VT100/ANSI |

### 17.3 Güvenlik Mimarisi

- API key'ler bellekte plain text tutulmaz, sadece gerektiğinde decrypt (ADR-0002)
- Tauri CSP (Content Security Policy) ile XSS koruması
- Plugin'ler **Web Worker sandbox** + capability-based permission (ADR-0004)
- Network izinleri manifest'te beyan, sadece beyan edilenler erişebilir
- Güncelleme paketi imzalı — imza doğrulanmadan uygulanmaz
- SQLite dosyası güvenli `%APPDATA%` yolunda, uygulama klasöründe değil

### 17.4 Test Stratejisi

| Test Tipi | Araç | Kapsam | Hedef |
|---|---|---|---|
| Unit | Vitest (TS), `cargo test` (Rust) | Modül public interface'i | **≥ %70 coverage** |
| Integration | Vitest + Tauri test | Pane yaşam döngüsü, IPC | **≥ %50 coverage** |
| E2E | Playwright | 10 kritik kullanıcı akışı | Hepsi geçmeli |
| Performans | Custom benchmark + Lighthouse CI | Performance budget | Budget aşılırsa CI fail |
| Bundle | `vite-bundle-analyzer` | Bağımlılık şişmesi | < 2 MB gzipped |

#### CI Gate

Coverage düşerse, performans budget aşılırsa veya E2E testlerden biri fail ederse PR merge bloklanır.

#### E2E Test Senaryoları

1. Pane aç (PowerShell + AI)
2. Yatay/dikey split
3. Pane kapat, hard kill
4. AI chat — basit mesaj, stream alımı
5. Session save → app restart → restore
6. Tema değişimi (runtime)
7. Kısayol ile pane navigasyonu
8. History fuzzy search
9. Snippet ekle + çalıştır
10. Settings export/import

---

## Ek: ADR İndeksi

Mimari kararların gerekçeleri ve alternatifleri için:

- [ADR-0001 — PTY Sidecar IPC Protokolü](./adr/0001-pty-sidecar-ipc-protocol.md)
- [ADR-0002 — Secret Storage (DPAPI)](./adr/0002-secret-storage-dpapi.md)
- [ADR-0003 — Storage Layer (rusqlite only)](./adr/0003-storage-rusqlite-only.md)
- [ADR-0004 — Plugin Sandbox (Web Worker)](./adr/0004-plugin-worker-sandbox.md)

---

**D-Terminal**
*"Windows kullanıcıları da matrix'e layık."*
D Brand Ailesi — D-Player · DCar Launcher · D-Terminal
