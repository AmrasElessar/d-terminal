# D-Terminal

**🌐 Dil:** **🇹🇷 Türkçe** · [🇬🇧 English](./README.en.md)

> Agent-aware Windows terminali — tek pencerede çoklu shell, AI entegrasyonu ve uzmanlaşmış pane tipleri.

[![CI](https://img.shields.io/github/actions/workflow/status/AmrasElessar/d-terminal/ci.yml?branch=main&label=CI&logo=github)](https://github.com/AmrasElessar/d-terminal/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/AmrasElessar/d-terminal?include_prereleases&label=release&color=blue)](https://github.com/AmrasElessar/d-terminal/releases)
[![Downloads](https://img.shields.io/github/downloads/AmrasElessar/d-terminal/total?label=indirme&color=green)](https://github.com/AmrasElessar/d-terminal/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-pre--alpha-orange)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20%C2%B7%20x64%20%2B%20ARM64-blue)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri)
![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs)
![Rust](https://img.shields.io/badge/Rust-stable-CE412B?logo=rust)

**🛡 Güvenlik:**
[![VT ARM64 MSI](https://img.shields.io/badge/VT_ARM64_MSI-0%2F57_clean-brightgreen?logo=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/13ec82c543a05e48d897a1735582264a3af97d89694799dc8d9eb8751992afec)
[![VT x64 MSI](https://img.shields.io/badge/VT_x64_MSI-2%2F57_(false_positive)-success?logo=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/c82bc54c4b18e0efa6f4cf4a323d51cbec8965617b3c95ec004c47b42a271a06)
[![VT NSIS](https://img.shields.io/badge/VT_NSIS-1--2%2F70_(false_positive)-yellow?logo=virustotal&logoColor=white)](https://www.virustotal.com/gui/file/62bad45a2202729be9e8e29999258677b4008d84f3cf1c3c2565cce762380c76)
[![Hybrid Analysis](https://img.shields.io/badge/Hybrid_Analysis-6%2F6_clean-brightgreen)](https://hybrid-analysis.com/sample/4b75ea036cf61201a6fea40adb151a044fc69bcae35a73a09aca17d2ec64f3ad)
[![Code Signing](https://img.shields.io/badge/code_signing-SignPath_FOSS_bekliyor-orange)](https://signpath.org/foundation)
[![DPAPI](https://img.shields.io/badge/secret_storage-Windows_DPAPI-blue?logo=windows)](https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection)
[![CSP](https://img.shields.io/badge/CSP-strict_(no_unsafe--eval)-success)](./src-tauri/tauri.conf.json)

D-Terminal, Windows kullanıcılarına modern, hızlı ve AI-yerli bir terminal deneyimi sunan, tamamen açık kaynak bir uygulamadır.

## 🆕 v0.1.1 Yenilikleri

- 🚀 **Node.js artık gerekmez** — sidecar `pkg` ile tek `.exe`'ye paketlendi (Node 20 runtime gömülü). Önceki sürümde kullanıcı sisteminde Node yoksa PowerShell pane açılmıyordu, artık **her makinede sıfır bağımlılıkla** çalışır.
- 🪟 **Ekstra console penceresi yok** — sidecar görünmez spawn edilir (`CREATE_NO_WINDOW`).
- 📐 **Pane resize stabilize edildi** — divider sürüklerken artık metin kesilmesi ve prompt duplikasyonu yok (ResizeObserver + PTY resize IPC debounce).
- 🤏 **Pane sürükle-bırak yeniden konumlandırma** — pane title bar'ını yakala, başka pane'in 4 kenarından (sol/sağ/üst/alt) birine bırak → otomatik split + ağaç restructure. Görsel drop-zone vurgu.
- ✏️ **Yerinde yeniden adlandırma** — tab veya pane başlığına çift tık → modal yok, yerinde input. Enter kaydet, Esc iptal.
- 🏷️ **Grup etiketleri (renkli rozetler)** — pane title bar'ındaki `#` butonuna tıkla, grup adı yaz. Aynı etiketteki pane'ler otomatik **aynı renkte** gösterilir (8 renkli palet, hash tabanlı). Çalışma odağı için sade ama etkili — örn: 3 pane "api", 2 pane "frontend".
- 🎨 **Tema paketleri prod build'de çalışır** — bundle path resolution düzeltildi (`_up_/themes/` Tauri glob notation).
- 📦 **Akıllı installer davranışı** — NSIS pre-install hook açık D-Terminal süreçlerini sessizce sonlandırır, version bump (0.1.1) ile MSI/NSIS auto-upgrade tetiklenir (eski sürüm otomatik kaldırılır, kullanıcı verisi korunur).
- 🛡️ **Tauri webview HTML5 drag/drop açık** — `dragDropEnabled: false` ile native file-drop handler bypass edildi, in-app drag işlemleri sorunsuz.

## Vizyon

D-Terminal, Windows üzerinde günlük çalışma akışını terminal merkezli yürüten kullanıcılar için, dağıtık araçlara duyulan ihtiyacı tek bir uygulamada toplamayı hedefler. PowerShell, CMD ve WSL oturumlarını; AI sohbetlerini; sistem ve log akışlarını ortak bir kabuğun altında birleştirir.

Windows Terminal sağlam bir tab/split altyapısı sunar; D-Terminal bunun üzerine native AI entegrasyonu, output triggers, blok tabanlı komut tarihi ve profil sistemi ekleyerek terminali bir geliştirme platformuna dönüştürür.

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
- **Drag-rearrange**: pane title bar'ını sürükle, başka pane'in 4 kenarından birine bırak (v0.1.1)
- **Inline rename + grup tag'leri** — çift tık ile yerinde, # ile renkli grup (v0.1.1)
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
- CSP enforced (script-src 'self'), wasm-unsafe-eval limited

### 💾 Kalıcılık
- Session restore (layout + komut geçmişi)
- SQLite WAL mode, kullanıcı dosyalarına dokunmaz
- Snippet & history full-text search
- PSReadLine geçmiş içe aktarma

### 🚀 Mimari
- Tauri v2 — Rust core + WebView2, ~5 MB binary, ~100 MB RAM (Electron 5x daha hafif)
- Length-prefixed binary IPC ile node-pty sidecar (ADR-0001), pkg-bundled standalone (Node.js gereksiz)
- Heartbeat tabanlı zombi-koruma (Tauri crash → sidecar otomatik kapanır)

## Teknoloji

- **Tauri v2** — Rust core + WebView2
- **Vue 3** + TypeScript + Vite
- **xterm.js** — WebGL/canvas renderer, OSC 133, image addon, search, unicode 11
- **node-pty** — sidecar PTY köprüsü (`@yao-pkg/pkg` ile standalone exe)
- **rusqlite** — yerel storage (WAL mode)
- **Windows DPAPI** — secret storage

## Mimari Belgeler

Mimari kararlar ve detaylı tasarım için [docs/architecture-v1.1.md](./docs/architecture-v1.1.md) ve [ADR'lar](./docs/adr/).

## Yol Haritası

| Sürüm | Hedef | İçerik |
|---|---|---|
| **v1.0** | 3-4 ay | Çoğu özellik mevcut; release polish + test + docs |
| **v1.0.5** | +2 ay | vue-i18n 11 migration (CSP `unsafe-eval` kaldır), Log Stream pane, snippet senkron |
| **v1.1** | +3 ay | Gelişmiş SSH (config.ssh okuyucu), free-form grid layout, Lua/JS programmatic config |
| **v2.0** | — | Multi-agent orkestrasyon, terminal AI assist (Warp Drive benzeri ekip paylaşımı), Kitty graphics protokolü |

## Kurulum

### İndir (v0.1.1)

[GitHub Releases sayfasından](https://github.com/AmrasElessar/d-terminal/releases) en son sürümü indir:

| Dosya | Boyut | Mimari | Açıklama |
|---|---|---|---|
| `D-Terminal_0.1.1_x64_tr-TR.msi` | ~41 MB | x86_64 | **Türkçe installer** (önerilen) |
| `D-Terminal_0.1.1_x64_en-US.msi` | ~41 MB | x86_64 | English installer |
| `D-Terminal_0.1.1_x64-setup.exe` | ~27 MB | x86_64 | NSIS — TR/EN dil seçici tek dosya |
| `D-Terminal_0.1.1_arm64_tr-TR.msi` | 36.9 MB | aarch64 | **ARM64 Türkçe** (Surface Pro X, Snapdragon laptops) |
| `D-Terminal_0.1.1_arm64_en-US.msi` | 36.9 MB | aarch64 | ARM64 English |
| `D-Terminal_0.1.1_arm64-setup.exe` | 23.8 MB | aarch64 | ARM64 NSIS |

> Boyut artışı (önceki ~22 MB → 40 MB MSI) Node.js runtime'ın bundle'a gömülmesinden kaynaklanır — kullanıcıda Node.js gereksinim **kalktı**.

### Güvenlik (v0.1.1, 2026-05-04)

Tüm 6 dosya **VirusTotal** + **Hybrid Analysis MetaDefender**'de tarandı (detay: [RELEASE_NOTES.md](./RELEASE_NOTES.md)):

**ARM64** ✨
- **MSI TR**: [0/57 clean](https://www.virustotal.com/gui/file/13ec82c543a05e48d897a1735582264a3af97d89694799dc8d9eb8751992afec) ✅
- **MSI EN**: [0/57 clean](https://www.virustotal.com/gui/file/11a371cb957821567cbd4abed1cdcac60cef06d166778300b95902a0b11b8feb) ✅
- **NSIS setup**: [1/70](https://www.virustotal.com/gui/file/ef7edc19b301adf61ca8e0f80e3c5980883b537f8f939a0bf993a177c4c6b927) — sadece Sophos ML PUA (unsigned NSIS tipik)

**x64**
- **MSI TR**: [2/57](https://www.virustotal.com/gui/file/c82bc54c4b18e0efa6f4cf4a323d51cbec8965617b3c95ec004c47b42a271a06) — Antiy-AVL + Rising generic ML false positive
- **MSI EN**: [2/58](https://www.virustotal.com/gui/file/4b75ea036cf61201a6fea40adb151a044fc69bcae35a73a09aca17d2ec64f3ad) — aynı 2 motor
- **NSIS setup**: [2/70](https://www.virustotal.com/gui/file/62bad45a2202729be9e8e29999258677b4008d84f3cf1c3c2565cce762380c76) — Sophos ML PUA + VirIT

Microsoft Defender, Kaspersky, BitDefender, ESET, Symantec, McAfee, CrowdStrike, Trend Micro, Fortinet — **hepsi clean** her dosya için.
Hybrid Analysis MetaDefender Multi-Scan: **6/6 dosya clean**.

Code signing eksik (SignPath FOSS başvurusu sürecinde) — Windows SmartScreen "Bilinmeyen yayıncı" uyarısı verir, "Yine de çalıştır" ile devam edilir. Sertifika sonrası bu kalkar; yukarıdaki ML false positive'lerin de neredeyse hepsi düşer.

### Sistem Gereksinimleri

- Windows 10 1809 (ConPTY için) veya Windows 11
- ~80 MB RAM, ~15 MB disk
- WebView2 runtime (Win11'de yerleşik, Win10'da ilk kurulumda otomatik gelir)

## Katkı

Bu proje **kişisel bir Windows terminal projesidir** ve topluluk katkı kapsamı bilinçli olarak dar tutulmuştur. Çekirdek mimari ve özellik geliştirme tek elden ilerliyor — ama topluluğun değer katabileceği iki şerit açık:

| ✅ Kabul edilen | ❌ Şu an kabul edilmeyen |
|---|---|
| 🐛 Bug raporu | 🤖 AI provider adapter PR'ı |
| 💡 Feature **fikri** (Issue) | 🏗️ Mimari / refactor PR'ı |
| 🌍 Dil paketi (`src/locales/<kod>.json`) | ✨ Özellik kodu PR'ı |
| 🎨 Tema (`themes/D-<isim>.json`) | |

`src/locales/` altında **30+ stub dil dosyası** çevirmen bekliyor (Almanca, İspanyolca, Fransızca, Japonca, Çince, Arapça, Rusça, …).

Detaylar için: [CONTRIBUTING.md](./CONTRIBUTING.md) · [Tema rehberi](./themes/COMMUNITY.md)

## D Brand Ailesi

D-Terminal, D Brand ailesinin Windows ayağıdır. Aile üyeleri "Denizhan" adından ilham alır:

- **D-Player** — Android için kişisel müzik çalar, DSP motoru *(geliştirme aşamasında)*
- **DCar Launcher** — Android Head Unit araç içi OS katmanı *(geliştirme aşamasında)*
- **D-Watchtower** — gözetim ve izleme platformu *(geliştirme aşamasında)*
- **D-Terminal** — Windows agent-aware terminal *(bu proje, pre-alpha)*

## Lisans

MIT © Orhan Engin OKAY — bkz. [LICENSE](./LICENSE)
