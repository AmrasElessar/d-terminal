# D-Terminal

> Agent-aware Windows terminali — tek pencerede çoklu shell, AI entegrasyonu ve uzmanlaşmış pane tipleri.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-pre--alpha-orange)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)

D-Terminal, Windows kullanıcılarına modern, hızlı ve AI-yerli bir terminal deneyimi sunan, tamamen açık kaynak bir uygulamadır.

## 🆕 v0.1.1 Yenilikleri / What's New

### 🇹🇷 Türkçe

- 🚀 **Node.js artık gerekmez** — sidecar `pkg` ile tek `.exe`'ye paketlendi (Node 20 runtime gömülü). Önceki sürümde kullanıcı sisteminde Node yoksa PowerShell pane açılmıyordu, artık **her makinede sıfır bağımlılıkla** çalışır.
- 🪟 **Ekstra console penceresi yok** — sidecar görünmez spawn edilir (`CREATE_NO_WINDOW`).
- 📐 **Pane resize stabilize edildi** — divider sürüklerken artık metin kesilmesi ve prompt duplikasyonu yok (ResizeObserver + PTY resize IPC debounce).
- 🤏 **Pane sürükle-bırak yeniden konumlandırma** — pane title bar'ını yakala, başka pane'in 4 kenarından (sol/sağ/üst/alt) birine bırak → otomatik split + ağaç restructure. Görsel drop-zone vurgu.
- ✏️ **Yerinde yeniden adlandırma** — tab veya pane başlığına çift tık → modal yok, yerinde input. Enter kaydet, Esc iptal.
- 🏷️ **Grup etiketleri (renkli rozetler)** — pane title bar'ındaki `#` butonuna tıkla, grup adı yaz. Aynı etiketteki pane'ler otomatik **aynı renkte** gösterilir (8 renkli palet, hash tabanlı). Çalışma odağı için sade ama etkili — örn: 3 pane "api", 2 pane "frontend".
- 🎨 **Tema paketleri prod build'de çalışır** — bundle path resolution düzeltildi (`_up_/themes/` Tauri glob notation).
- 📦 **Akıllı installer davranışı** — NSIS pre-install hook açık D-Terminal süreçlerini sessizce sonlandırır, version bump (0.1.1) ile MSI/NSIS auto-upgrade tetiklenir (eski sürüm otomatik kaldırılır, kullanıcı verisi korunur).
- 🛡️ **Tauri webview HTML5 drag/drop açık** — `dragDropEnabled: false` ile native file-drop handler bypass edildi, in-app drag işlemleri sorunsuz.

### 🇬🇧 English

- 🚀 **No more Node.js requirement** — sidecar bundled into a single `.exe` via `pkg` (Node 20 runtime embedded). Previous release failed on machines without Node; now works **everywhere with zero dependencies**.
- 🪟 **No extra console window** — sidecar spawns invisibly (`CREATE_NO_WINDOW`).
- 📐 **Pane resize stabilized** — no more text clipping or prompt duplication when dragging dividers (ResizeObserver + PTY resize IPC debounce).
- 🤏 **Pane drag-and-drop rearrange** — grab any pane's title bar, drop on another pane's edge (left/right/top/bottom) → auto-split + tree restructure. Visual drop-zone highlight.
- ✏️ **Inline rename** — double-click tab or pane title for in-place edit (no modal). Enter to save, Esc to cancel.
- 🏷️ **Group tags (colored badges)** — click the `#` button in the pane title bar to enter a group name. Panes sharing a tag get the **same color** automatically (8-color hash-based palette). Simple but effective work focus — e.g. tag 3 panes "api", 2 panes "frontend".
- 🎨 **Theme packages now load in production builds** — fixed bundle path resolution (`_up_/themes/` Tauri glob notation).
- 📦 **Smarter installer** — NSIS pre-install hook silently terminates running D-Terminal processes; version bump (0.1.1) triggers MSI/NSIS auto-upgrade (old version uninstalled automatically, user data preserved).
- 🛡️ **Tauri webview HTML5 drag/drop enabled** — `dragDropEnabled: false` bypasses the native file-drop handler so in-app drag works correctly.

## Vizyon

D-Terminal, Windows üzerinde günlük çalışma akışını terminal merkezli yürüten kullanıcılar için, dağıtık araçlara duyulan ihtiyacı tek bir uygulamada toplamayı hedefler. PowerShell, CMD ve WSL oturumlarını; AI sohbetlerini; sistem ve log akışlarını ortak bir kabuğun altında birleştirir.

Windows Terminal sağlam bir tab/split altyapısı sunar; D-Terminal bunun üzerine native AI entegrasyonu, output triggers, blok tabanlı komut tarihi, profil sistemi ve eklenti çerçevesi ekleyerek terminali bir geliştirme platformuna dönüştürür.

## Öne Çıkan Özellikler

### 🤖 Yapay Zeka — kendi anahtarın, hiç buluta sızmadan
- **4 sağlayıcı**: Anthropic, OpenAI, Gemini, Ollama (offline) + OpenAI-uyumlu özel endpoint
- **Rust HTTP proxy**: API key Windows DPAPI vault'tan Rust tarafında alınır, frontend hiçbir zaman plaintext key görmez (XSS riski sıfırlandı)
- **Komut üretici**: doğal dilden shell komutu (`Ctrl+Shift+G` modal veya boş prompt'ta `#` interception)
- **Blok'tan AI'a**: terminal komut bloklarını tek tıkla AI Chat'e enjekte et

### 📦 Blok Tabanlı Komut Tarihi (OSC 133)
- Her komut + çıktı + exit kodu otomatik yakalanır
- Renkli durum: ✓ success / ✗ error / ◌ running / ⊘ aborted
- Komut yeniden çalıştır, çıktı kopyala, AI'a gönder
- PowerShell shell-integration prompt yerleşik (CMD da)

### 🎯 Output Triggers (iTerm2 paritesi)
- Regex eşleşmesinde otomatik aksiyon: toast, AI'a iletme, snippet çalıştırma
- Cooldown + scope (per shell tipi) kontrolü
- `{{0}}`, `{{1}}` template ile match groups

### 🪟 Pane Sistemi
- Yatay/dikey split, **sekme başına bağımsız ağaç**
- Pane zoom modu (tmux z paritesi, `Ctrl+Shift+Z`)
- Broadcast input (tmux sync-panes — tüm pane'lere paralel klavye)
- Context menu: kopya, yapıştır, temizle, böl, kapat

### 🔌 Shell Profilleri (iTerm2/Tabby paritesi)
- Built-in: PowerShell / CMD / WSL
- Kullanıcı tanımlı: SSH host, Docker exec, pwsh 7, Python REPL...
- Her profil: shell + args + cwd + env + ikon + renk badge

### 🎨 Tema ve Görünüm
- **14 dahili tema**: D-Dark, D-Light, D-Matrix, D-Nord, D-Dracula, D-TokyoNight, D-Catppuccin, D-Gruvbox, D-Retro, D-Solarized-Dark/Light, D-OneDark, D-RosePine, D-GitHub-Dark
- JSON ile özel tema, runtime renk değişimi
- Mica / Acrylic / None — runtime vibrancy switch (Win11 22H2+)
- Settings'te kart-grid önizleme + ANSI swatches

### 📊 DFetch (neofetch paritesi)
- Yerleşik sistem bilgi: CPU, GPU (WMI), disk, ekran + DPI, batarya, tema, locale, timezone, swap, boot time
- **Yerel IP** (IPv4/IPv6) — public IP'ye dokunmaz (offline-first)
- **KVKK/GDPR maskeleme**: hostname + IP varsayılan gizli, 👁 tıklayınca aç/kapa, oturum içi
- 4-renkli Windows OS logosu (neofetch konvansiyonu)
- 16 ANSI color blocks alttaki bant

### 🔍 xterm Motoru
- WebGL renderer + Canvas/DOM otomatik fallback
- Scrollback search (`Ctrl+F`, regex/case/word, decoration highlight)
- Sixel + iTerm2 inline image protokolleri
- Unicode 11 (emoji + CJK doğru genişlik)
- Smart link: file path, git SHA, IP/host tıklanabilir
- Buffer serialize → clipboard

### ⌨️ Klavye-first
- 24 varsayılan kısayol, **kapsayıcı editör** (Settings → Kısayollar)
- Tuş yakalama capture overlay, çakışma tespiti, override persist
- Command palette (`Ctrl+Shift+P`)
- Quake hotkey (`F1` — pencere göster/gizle)

### 🔒 Güvenlik
- Windows DPAPI ile credential storage (master parola yok)
- AI key Rust tarafında, frontend'e sızmaz
- Plugin sandbox iskeleti: Web Worker + capability-based permissions (v1.1+)
- CSP enforced (script-src 'self'), wasm-unsafe-eval limited

### 💾 Kalıcılık
- Session restore (layout + komut geçmişi)
- SQLite WAL mode, kullanıcı dosyalarına dokunmaz
- Snippet & history full-text search
- PSReadLine geçmiş içe aktarma

### 🚀 Mimari
- Tauri v2 — Rust core + WebView2, ~5 MB binary, ~100 MB RAM (Electron 5x daha hafif)
- Length-prefixed binary IPC ile node-pty sidecar (ADR-0001)
- Heartbeat tabanlı zombi-koruma (Tauri crash → sidecar otomatik kapanır)

## Teknoloji

- **Tauri v2** — Rust core + WebView2
- **Vue 3** + TypeScript + Vite
- **xterm.js** — WebGL/canvas renderer, OSC 133, image addon, search, unicode 11
- **node-pty** — sidecar PTY köprüsü
- **rusqlite** — yerel storage (WAL mode)
- **Windows DPAPI** — secret storage

## Mimari Belgeler

Mimari kararlar ve detaylı tasarım için [docs/architecture-v1.1.md](./docs/architecture-v1.1.md) ve [ADR'lar](./docs/adr/).

## Yol Haritası

| Sürüm | Hedef | İçerik |
|---|---|---|
| **v1.0** | 3-4 ay | Çoğu özellik mevcut; release polish + test + docs |
| **v1.0.5** | +2 ay | vue-i18n 11 migration (CSP `unsafe-eval` kaldır), Log Stream pane, snippet senkron |
| **v1.1** | +3 ay | Plugin API marketplace, gelişmiş SSH (config.ssh okuyucu), free-form grid, Lua/JS programmatic config |
| **v2.0** | — | Multi-agent orkestrasyon, terminal AI assist (Warp Drive benzeri ekip paylaşımı), Kitty graphics protokolü |

## Kurulum

### İndir (v0.1.1)

[GitHub Releases sayfasından](https://github.com/AmrasElessar/d-terminal/releases) en son sürümü indir:

| Dosya | Boyut | Açıklama |
|---|---|---|
| `D-Terminal_0.1.1_x64_tr-TR.msi` | 40.9 MB | **Türkçe installer** (önerilen) |
| `D-Terminal_0.1.1_x64_en-US.msi` | 40.8 MB | English installer |
| `D-Terminal_0.1.1_x64-setup.exe` | 27.2 MB | NSIS — TR/EN dil seçici tek dosya |

> Boyut artışı (önceki ~22 MB → 40 MB MSI) Node.js runtime'ın bundle'a gömülmesinden kaynaklanır — kullanıcıda Node.js gereksinim **kalktı**.

### Güvenlik

Tüm dosyalar **VirusTotal**'de tarandı (sonuçlar [RELEASE_NOTES.md](./RELEASE_NOTES.md)'de):
- **MSI installer'lar**: 0/59 ✅ tamamen clean
- **NSIS setup.exe**: 2/69 — ikisi de net false positive (CrowdStrike grayware-60%, SecureAge ML)
- Microsoft Defender, Kaspersky, BitDefender, ESET, Sophos vb. major engine'ler hepsi clean

Code signing eksik (SignPath FOSS başvurusu sürecinde) — Windows SmartScreen "Bilinmeyen yayıncı" uyarısı verir, "Yine de çalıştır" ile devam edilir. Sertifika sonrası bu kalkar.

### Sistem Gereksinimleri

- Windows 10 1809 (ConPTY için) veya Windows 11
- ~80 MB RAM, ~15 MB disk
- WebView2 runtime (Win11'de yerleşik, Win10'da ilk kurulumda otomatik gelir)

## Katkı

Katkıya açığız. Tema, dil paketi, AI provider adapter veya plugin yazabilirsiniz.

Detaylar için [CONTRIBUTING.md](./CONTRIBUTING.md).

## D Brand Ailesi

D-Terminal, D Brand ailesinin Windows ayağıdır. Aile üyeleri "Denizhan" adından ilham alır:

- **D-Player** — Android için kişisel müzik çalar, DSP motoru *(geliştirme aşamasında)*
- **DCar Launcher** — Android Head Unit araç içi OS katmanı *(geliştirme aşamasında)*
- **D-Watchtower** — gözetim ve izleme platformu *(geliştirme aşamasında)*
- **D-Terminal** — Windows agent-aware terminal *(bu proje, pre-alpha)*

## Lisans

MIT © Orhan Engin OKAY — bkz. [LICENSE](./LICENSE)
