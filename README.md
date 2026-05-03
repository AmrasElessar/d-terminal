# D-Terminal

> Agent-aware Windows terminal — tek pencerede CMD, PowerShell, AI agent stream'leri ve özel pane'ler.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-pre--alpha-orange)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)

D-Terminal, Linux/macOS'ta var olan tmux/Warp benzeri çoklu pane terminal deneyimini Windows'a getiren ve evrensel AI entegrasyonuyla zenginleştiren açık kaynak bir uygulamadır.

## Vizyon

Windows terminal ekosisteminde belirgin bir boşluk var:

- **Windows Terminal**: tab/split var, AI yok
- **tmux**: sadece WSL içinde
- **Warp**: Mac/Linux only
- **Hyper, Tabby**: güzel ama agent kavramı yok

D-Terminal bu boşluğu doldurur — **modern, hızlı, AI-native ve tamamen açık kaynak**.

## Öne Çıkan Özellikler (Hedef)

- 🪟 Çoklu pane: yatay/dikey split, iç içe layout
- 🤖 Evrensel AI: Anthropic, OpenAI, Gemini, Ollama (offline) ve OpenAI-compat herhangi bir endpoint
- 🎨 Tema sistemi: 6 dahili tema + JSON ile özel tema, topluluk marketplace
- 🌍 i18n: TR + EN (topluluk dilleri eklenebilir)
- ⌨️ Klavye-first: tmux benzeri kısayollar, tamamen fare-bağımsız
- 🔒 Güvenli credential storage: Windows DPAPI, master parola yok
- 🧩 Plugin sistemi: Web Worker sandbox, capability-based permissions (v1.1+)
- 📊 DFetch: yerleşik neofetch benzeri sistem bilgi ekranı
- 💾 Session restore: layout + history kalıcı
- 🚀 Tauri v2: 5 MB binary, ~80 MB RAM (Electron 5x daha küçük)

## Teknoloji

- **Tauri v2** (Rust core + WebView2)
- **Vue 3** + TypeScript + Vite
- **xterm.js** (terminal rendering)
- **node-pty** (sidecar, PTY köprüsü)
- **rusqlite** (storage, WAL mode)

## Mimari Belgeler

Mimari kararlar ve detaylı tasarım için [docs/architecture-v1.1.md](./docs/architecture-v1.1.md) ve [ADR'lar](./docs/adr/).

## Yol Haritası

| Sürüm | Hedef | İçerik |
|---|---|---|
| **v1.0** | 3-4 ay | PowerShell + AI Chat pane, 2 AI provider, 3 tema, TR+EN |
| **v1.0.5** | +2 ay | CMD + Log Stream, OpenAI + Gemini, kalan temalar, snippet/grid |
| **v1.1** | +3 ay | Plugin API, tema marketplace, HTTP/SSH pane |
| **v2.0** | — | Multi-agent orkestrasyon, terminal AI assist |

## Kurulum

> ⚠️ Pre-alpha. Kurulum talimatları ilk release ile birlikte gelecek.

## Katkı

Katkıya açığız! Tema, dil paketi, AI provider adapter veya plugin yazabilirsiniz.

Detaylar için [CONTRIBUTING.md](./CONTRIBUTING.md).

## D Brand Ailesi

D-Terminal, D Brand ailesinin Windows ayağıdır. Aile üyeleri "Denizhan" adından ilham alır:

- **D-Player** (Android) — Kişisel müzik çalar, DSP motoru
- **DCar Launcher** (Android Head Unit) — Araç içi OS katmanı
- **D-Terminal** (Windows) — Bu proje

## Lisans

MIT © Orhan Engin OKAY — bkz. [LICENSE](./LICENSE)

---

*"Windows kullanıcıları da matrix'e layık."*
