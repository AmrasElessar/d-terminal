# D-Terminal Release Notes

## v0.1.0-alpha — Pre-Alpha (yayınlanmamış)

İlk pre-alpha sürüm. Geliştirme sırasında biriken tüm temel özellikler.

### 🚀 Çekirdek

- **Tauri v2** (Rust core + WebView2) + **Vue 3** + TypeScript stack
- **Length-prefixed binary IPC** ile **node-pty sidecar** (ADR-0001),
  multipleks, heartbeat tabanlı zombi-koruma
- **rusqlite WAL** mode storage, refinery migrations
- **Windows DPAPI** ile şifrelenmiş credential storage (master parola yok)

### 🪟 Pane Sistemi

- Yatay/dikey split, sekme başına bağımsız ağaç
- Pane zoom modu (`Ctrl+Shift+Z`, tmux z paritesi)
- Broadcast input (tmux sync-panes, `Ctrl+Shift+B`)
- Context menu (kopya/yapıştır/temizle/böl/kapat)
- PTY persistence: split kapatma sonrası komut/buffer korunur

### 🤖 AI

- 4 sağlayıcı: **Anthropic**, **OpenAI**, **Gemini**, **Ollama** (offline)
- **Rust HTTP proxy** — API key Windows DPAPI'da kalır, frontend'e
  hiçbir zaman plain key sızmaz (XSS sıfır risk)
- Komut üretici: `Ctrl+Shift+G` modal veya boş prompt'ta `#` interception
- Block'tan AI'a tek tıkla prompt enjeksiyonu

### 📦 Block Tabanlı Komut Tarihi

- OSC 133 shell integration — her komut + çıktı + exit kodu yakalanır
- PowerShell init script gömülü (Cmd için ANSI prompt)
- Komut yeniden çalıştır, çıktı kopyala, AI'a gönder
- History full-text search (Ctrl+Shift+F)

### 🎯 Output Triggers (iTerm2 paritesi)

- Regex eşleşmesinde aksiyon: toast / sendToAI / runSnippet / capture
- Cooldown + per-pane scope
- `{{0}}` `{{1}}` template ile match groups

### 🔌 Shell Profilleri

- Built-in: PowerShell / CMD / WSL
- Kullanıcı: SSH host, Docker exec, pwsh 7, Python REPL...
- shell + args + cwd + env + ikon + renk

### 🎨 Tema

- 14 dahili tema (D-Dark, D-Light, D-Matrix, D-Nord, D-Dracula,
  D-TokyoNight, D-Catppuccin, D-Gruvbox, D-Retro, D-Solarized-Dark/Light,
  D-OneDark, D-RosePine, D-GitHub-Dark)
- Settings'te kart-grid önizleme + ANSI swatches
- JSON ile özel tema, runtime renk değişimi
- Mica / Acrylic / None — runtime vibrancy switch (Win11 22H2+)

### 📊 DFetch

- Yerleşik sistem bilgi: CPU, GPU (WMI), disk, ekran + DPI, batarya, tema,
  locale, timezone, swap, boot time
- Yerel IP (IPv4/IPv6), public IP'ye dokunmaz (offline-first)
- **KVKK/GDPR maskeleme**: hostname + IP varsayılan gizli, 👁 toggle
- 4-renkli Windows OS logosu (neofetch konvansiyonu)
- 16 ANSI color blocks bant

### 🔍 xterm

- WebGL renderer + Canvas/DOM otomatik fallback
- Scrollback search (`Ctrl+F`, regex/case/word)
- Sixel + iTerm2 inline image
- Unicode 11 (emoji + CJK width)
- Smart link: file path, git SHA, IP/host
- **Inline autocomplete** (fish/Warp tarzı history öneri, Tab/→ ile kabul)

### 📜 Log Stream Pane (yeni)

- `tail -f` benzeri canlı dosya izleme
- File picker, regex filter, auto-scroll detection
- 5K satır rolling buffer

### ⌨️ Klavye

- 24 varsayılan kısayol, kapsayıcı editör (Settings → Kısayollar)
- Tuş yakalama overlay, çakışma tespiti, override persist
- Command palette (`Ctrl+Shift+P`)
- Quake hotkey (`F1`)

### 💾 Kalıcılık

- Session restore (layout + komut geçmişi)
- Snippet & history search
- PSReadLine import
- Snippet export/import (JSON, Warp Drive lite)

### 🔒 Güvenlik

- AI key Rust tarafında, frontend'e sızmaz
- CSP enforced — `script-src 'self' 'wasm-unsafe-eval'` (unsafe-eval YOK,
  vue-i18n 11 + build-time AST compile)
- Plugin sandbox iskeleti: Web Worker + capability permissions (v1.1+)

### 🧪 Bilinen sınırlar / TODO (v1.0.5+)

- Code signing yok — installer Windows SmartScreen uyarısı verir
- Microsoft Store dağıtımı için manifest hazırlığı yapılmamış
- HTTP/SSH gelişmiş özellikler (config.ssh okuma) v1.1+
- Plugin marketplace v1.1+
- Free-form grid layout (Tilix tarzı) v1.1+
- Kitty Graphics Protocol v2.0
- Snippet bulut senkronizasyonu (Warp Drive paritesi) v2.0
- Multi-agent orkestrasyon v2.0

### 📝 Lisans

MIT © Orhan Engin OKAY
