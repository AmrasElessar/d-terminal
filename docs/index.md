---
layout: page
title: D-Terminal
permalink: /
---

<p align="center">
  <img src="https://raw.githubusercontent.com/AmrasElessar/d-terminal/main/src-tauri/icons/icon.png" width="96" alt="D-Terminal" />
</p>

<h1 align="center">D-Terminal</h1>

<p align="center"><strong>Agent-aware Windows Terminal</strong></p>

<p align="center">
  <em>Çoklu shell, AI entegrasyonu, uzmanlaşmış pane'ler — tek pencerede</em><br>
  <em>Multi-shell, AI-native, specialized panes — all in one window</em>
</p>

<p align="center">
  <a href="https://www.gnu.org/licenses/gpl-3.0.en.html"><img src="https://img.shields.io/badge/license-GPLv3%2B-blue.svg" alt="License: GPL-3.0+"></a>
  <a href="https://github.com/AmrasElessar/d-terminal/releases"><img src="https://img.shields.io/github/v/release/AmrasElessar/d-terminal?include_prereleases&label=release&color=blue" alt="Release"></a>
  <a href="https://github.com/AmrasElessar/d-terminal/actions"><img src="https://img.shields.io/github/actions/workflow/status/AmrasElessar/d-terminal/ci.yml?branch=main&label=CI&logo=github" alt="CI"></a>
  <img src="https://img.shields.io/badge/platform-Windows%2010%2F11%20·%20x64%20%2B%20ARM64-blue" alt="Platform">
  <a href="#-microsoft-store--yakında--coming-soon"><img src="https://img.shields.io/badge/MS_Store-coming_soon-0078D4?logo=microsoftstore&logoColor=white" alt="MS Store"></a>
</p>

<p align="center">
  🌐 <strong>TR · EN</strong> — Bu sayfa iki dillidir / This page is bilingual
</p>

<p align="center">
  <a href="https://github.com/AmrasElessar/d-terminal/releases/latest">📥 İndir / Download</a> ·
  <a href="https://github.com/AmrasElessar/d-terminal">📂 GitHub</a> ·
  <a href="./privacy.html">🔒 Gizlilik / Privacy</a>
</p>

---

## 🇹🇷 Türkçe

### D-Terminal nedir?

**D-Terminal**, Windows için modern, hızlı ve **AI-yerli** açık kaynak bir terminal uygulamasıdır. PowerShell, CMD ve WSL oturumlarını, AI sohbetlerini, sistem bilgisini ve log akışlarını **tek pencerede** birleştirir.

**Tauri v2** üzerine kurulu — Rust çekirdek + WebView2 — Electron alternatifinden **5× daha hafif** (~5 MB binary, ~100 MB RAM).

D Brand kişisel kullanım projesi · **GPL-3.0-or-later** lisanslı · **ARM64 ve x64** build · Windows 10 1809+ ve Windows 11.

### Öne çıkan özellikler

- **🤖 4 AI sağlayıcı + 5 yerel runtime** — Anthropic, OpenAI, Gemini, Ollama, LM Studio, Jan, llama.cpp, Foundry. API key'ler Windows DPAPI ile şifrelenir, hiçbir sunucumuza gitmez.
- **#-komut üretici** — boş prompt'ta `#` yaz + doğal dil → AI shell komutu üretir.
- **Agent Watch** — Claude Code, Cursor Agent gibi ajanlar koşarken canlı maliyet + token rozeti.
- **Block sistemi** — Warp tarzı her komut + çıktı ayrı kart; AI'a tek tıkla gönder.
- **Multi-pane + multi-tab** — split, broadcast input (tmux synchronize), drag-drop yeniden konumla.
- **Yerel-öncelikli** — telemetri yok, kayıt yok, sunucuya bağlı değil.
- **14 tema + 17 mono font** — JetBrains Mono, Fira Code, Cascadia Code, Victor Mono ve daha fazlası.
- **33 dil** — vue-i18n 11 ile build-time compile, çalışma zamanı eval yok (CSP strict).

### Kurulum

| Platformun | İndir |
|---|---|
| 💻 Modern Windows PC (Intel/AMD) | [`D-Terminal_0.11.0_x64_tr-TR.msi`](https://github.com/AmrasElessar/d-terminal/releases/latest) |
| 🪶 ARM64 (Surface Pro X, Snapdragon) | [`D-Terminal_0.11.0_arm64_tr-TR.msi`](https://github.com/AmrasElessar/d-terminal/releases/latest) |
| 🛒 Microsoft Store | Yakında — v1.0 hedefli |

Sistem türünü öğrenmek için **Ayarlar → Sistem → Hakkında → Sistem türü**.

### Güvenlik & gizlilik

- **DPAPI vault** — AI API key'leri Windows kullanıcı oturumuna bağlı, başka hesaba/PC'ye taşınamaz.
- **CSP strict** — `unsafe-eval` yok, XSS sertleştirme tam.
- **Telemetri yok** — internet erişimi sadece kullanıcının açıkça yapılandırdığı AI sağlayıcılarına.
- **VirusTotal + Hybrid Analysis** — her release otomatik tarama, `hashes.txt` release sayfasında.
- **Code signing** — SignPath FOSS başvurusu süresinde.

Detaylı gizlilik metni: [Gizlilik Politikası](./privacy.html) (KVKK + GDPR uyumlu).

### 🛒 Microsoft Store — Yakında / Coming soon

**v1.0** hedefli MSIX paketleme + Store submission hazırlığı sürmekte (10/13 madde tamamlandı):

- ✅ Privacy policy GitHub Pages'te canlı
- ✅ Listing metinleri TR + EN final
- ✅ Migration wizard (legacy → Store veri aktarımı)
- ✅ Code signing rehberi (SignPath FOSS)
- ✅ MSIX build guide step-by-step
- ✅ CI workflow taslağı (manual trigger)
- 🕐 Partner Center hesabı + identity reservation + screenshot — kullanıcı tarafı

Store sürümü çıktığında mevcut **v0.9.x / v0.10.x verilerin otomatik aktarılır** ([detay](./privacy.html#sürüm-geçişi)).

### Mimari kısa özeti

- **Frontend**: Vue 3 (Composition API) + Pinia + vue-i18n 11 + xterm.js
- **Backend**: Rust (Tauri 2) + rusqlite + r2d2 + tokio + reqwest (rustls)
- **Sidecar**: Node.js (pkg standalone) — node-pty PTY köprüsü
- **Storage**: tek SQLite DB (WAL mode) — history/snippets/sessions/settings/secrets
- **Updater**: Tauri auto-updater + minisign

Detaylı: [Architecture v1.1](https://github.com/AmrasElessar/d-terminal/blob/main/docs/architecture-v1.1.md).

### Bağlantılar

- 🏠 **Ana repo**: [github.com/AmrasElessar/d-terminal](https://github.com/AmrasElessar/d-terminal)
- 📦 **Yayınlar**: [releases](https://github.com/AmrasElessar/d-terminal/releases)
- 🐛 **Hata bildir**: [issues](https://github.com/AmrasElessar/d-terminal/issues)
- 💖 **Destek**: [GitHub Sponsors](https://github.com/sponsors/AmrasElessar)
- 📜 **Lisans**: [GPL-3.0-or-later](https://github.com/AmrasElessar/d-terminal/blob/main/LICENSE)

---

## 🇬🇧 English

### What is D-Terminal?

**D-Terminal** is a modern, fast, **AI-native** open-source terminal for Windows. It unifies PowerShell, CMD and WSL sessions, AI conversations, system info and log streams in **one window**.

Built on **Tauri v2** — Rust core + WebView2 — **5× lighter** than Electron alternatives (~5 MB binary, ~100 MB RAM).

A personal-use D Brand project · **GPL-3.0-or-later** licensed · **ARM64 and x64** builds · Windows 10 1809+ and Windows 11.

### Highlights

- **🤖 4 AI providers + 5 local runtimes** — Anthropic, OpenAI, Gemini, Ollama, LM Studio, Jan, llama.cpp, Foundry. API keys encrypted with Windows DPAPI, never leave your machine.
- **#-command generator** — type `#` on an empty prompt + natural language → AI generates a shell command.
- **Agent Watch** — live cost + token badge while Claude Code, Cursor Agent and similar agents run.
- **Block system** — Warp-style: every command + output is a separate card; send to AI in one click.
- **Multi-pane + multi-tab** — split, broadcast input (tmux synchronize-panes), drag-drop reposition.
- **Local-first** — no telemetry, no logging to a server, no account required.
- **14 themes + 17 monospace fonts** — JetBrains Mono, Fira Code, Cascadia Code, Victor Mono and more.
- **33 languages** — vue-i18n 11 with build-time compilation, no runtime eval (strict CSP).

### Install

| Your platform | Download |
|---|---|
| 💻 Modern Windows PC (Intel/AMD) | [`D-Terminal_0.11.0_x64_en-US.msi`](https://github.com/AmrasElessar/d-terminal/releases/latest) |
| 🪶 ARM64 (Surface Pro X, Snapdragon laptops) | [`D-Terminal_0.11.0_arm64_en-US.msi`](https://github.com/AmrasElessar/d-terminal/releases/latest) |
| 🛒 Microsoft Store | Coming soon — v1.0 target |

To find your system type: **Settings → System → About → System type**.

### Security & privacy

- **DPAPI vault** — AI API keys are bound to your Windows user account; they cannot move to another user/PC.
- **Strict CSP** — no `unsafe-eval`, full XSS hardening.
- **No telemetry** — network access only for AI providers you explicitly configure.
- **VirusTotal + Hybrid Analysis** — every release is auto-scanned; `hashes.txt` on the release page.
- **Code signing** — SignPath FOSS application in progress.

Detailed privacy text: [Privacy Policy](./privacy.html) (KVKK + GDPR aligned).

### Architecture in brief

- **Frontend**: Vue 3 (Composition API) + Pinia + vue-i18n 11 + xterm.js
- **Backend**: Rust (Tauri 2) + rusqlite + r2d2 + tokio + reqwest (rustls)
- **Sidecar**: Node.js (pkg standalone) — node-pty PTY bridge
- **Storage**: single SQLite DB (WAL mode) — history/snippets/sessions/settings/secrets
- **Updater**: Tauri auto-updater + minisign

Detailed: [Architecture v1.1](https://github.com/AmrasElessar/d-terminal/blob/main/docs/architecture-v1.1.md).

### Links

- 🏠 **Main repo**: [github.com/AmrasElessar/d-terminal](https://github.com/AmrasElessar/d-terminal)
- 📦 **Releases**: [releases](https://github.com/AmrasElessar/d-terminal/releases)
- 🐛 **Report a bug**: [issues](https://github.com/AmrasElessar/d-terminal/issues)
- 💖 **Support**: [GitHub Sponsors](https://github.com/sponsors/AmrasElessar)
- 📜 **License**: [GPL-3.0-or-later](https://github.com/AmrasElessar/d-terminal/blob/main/LICENSE)

---

<p align="center">
  <sub>© 2026 Orhan Engin OKAY · D Brand · Licensed under <strong>GPL-3.0-or-later</strong> (v0.9.9 ve öncesi MIT / and earlier remain MIT)</sub><br>
  <sub>Bu site yalnızca statik dökümanlar barındırır — kullanıcı verisi toplanmaz / This site only hosts static documents — no user data is collected.</sub>
</p>
