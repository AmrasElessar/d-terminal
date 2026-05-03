# D-Terminal

> Agent-aware Windows terminali — tek pencerede çoklu shell, AI entegrasyonu ve uzmanlaşmış pane tipleri.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-pre--alpha-orange)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)

D-Terminal, Windows kullanıcılarına modern, hızlı ve AI-yerli bir terminal deneyimi sunan, tamamen açık kaynak bir uygulamadır.

## Vizyon

D-Terminal, Windows üzerinde günlük çalışma akışını terminal merkezli yürüten kullanıcılar için, dağıtık araçlara duyulan ihtiyacı tek bir uygulamada toplamayı hedefler. PowerShell, CMD ve WSL oturumlarını; AI sohbetlerini; sistem ve log akışlarını ortak bir kabuğun altında birleştirir.

Windows Terminal sağlam bir tab/split altyapısı sunar; D-Terminal bunun üzerine native AI entegrasyonu, output triggers, blok tabanlı komut tarihi, profil sistemi ve eklenti çerçevesi ekleyerek terminali bir geliştirme platformuna dönüştürür.

## Öne Çıkan Özellikler

- 🪟 **Çoklu pane**: yatay/dikey split, sekme başına bağımsız ağaç, zoom modu, broadcast input
- 🤖 **AI yerleşik**: Anthropic, OpenAI, Gemini, Ollama (offline) ve OpenAI-uyumlu özel endpoint'ler
- ⚡ **Komut üretici**: doğal dilden shell komutu (`Ctrl+Shift+G` veya boş prompt'ta `#`)
- 📦 **Blok tabanlı tarih**: OSC 133 ile her komut + çıktı + exit kodu yakalanır, AI'a gönder/yeniden çalıştır
- 🎯 **Output triggers**: regex eşleşmesinde toast / AI'a iletme / snippet çalıştırma
- 🔌 **Shell profilleri**: PowerShell, CMD, WSL, SSH, Docker exec, Python REPL... profile-aware spawn
- 🎨 **Tema sistemi**: 3 dahili tema + JSON ile özel tema, runtime renk değişimi
- 🌍 **TR + EN**: tam yerelleştirme, topluluk dil paketi desteği
- ⌨️ **Klavye-first**: 20+ varsayılan kısayol, command palette
- 🔒 **Güvenli credential storage**: Windows DPAPI, master parola yok
- 📊 **Yerleşik DFetch**: neofetch tarzı sistem bilgi (CPU, GPU, disk, ekran, batarya, tema, locale)
- 🔍 **Modern xterm motoru**: WebGL renderer + canvas/DOM fallback, scrollback search, sixel + iTerm2 inline image
- 💾 **Session restore**: layout + komut geçmişi kalıcı, oturum kaydet/yükle
- 🪟 **Quake hotkey**: `F1` ile pencere göster/gizle (sistem tepsisinden bağımsız)
- 🚀 **Tauri v2**: ~5 MB binary, ~80 MB RAM (Electron alternatiflerine göre 5x daha hafif)
- 🧩 **Eklenti çerçevesi**: Web Worker sandbox + capability-based permission API (v1.1+)

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
| **v1.0** | 3-4 ay | PowerShell + AI Chat pane, 4 AI provider, 3 tema, TR+EN |
| **v1.0.5** | +2 ay | CMD + Log Stream, kalan temalar, snippet/grid, profil ek özellikleri |
| **v1.1** | +3 ay | Plugin API, tema marketplace, HTTP/SSH pane gelişmiş özellikler |
| **v2.0** | — | Multi-agent orkestrasyon, terminal AI assist, takım paylaşımı |

## Kurulum

> ⚠️ Pre-alpha. Kurulum talimatları ilk release ile birlikte gelecek.

## Katkı

Katkıya açığız. Tema, dil paketi, AI provider adapter veya plugin yazabilirsiniz.

Detaylar için [CONTRIBUTING.md](./CONTRIBUTING.md).

## D Brand Ailesi

D-Terminal, D Brand ailesinin Windows ayağıdır. Aile üyeleri "Denizhan" adından ilham alır:

- **D-Player** — Android için kişisel müzik çalar, DSP motoru *(geliştirme aşamasında)*
- **DCar Launcher** — Android Head Unit araç içi OS katmanı *(geliştirme aşamasında)*
- **D-Terminal** — Windows agent-aware terminal *(bu proje, pre-alpha)*

## Lisans

MIT © Orhan Engin OKAY — bkz. [LICENSE](./LICENSE)
