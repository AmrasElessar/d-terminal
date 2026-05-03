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

### 📥 İndir

| Dosya | Boyut | Açıklama |
|---|---|---|
| `D-Terminal_0.1.0_x64_tr-TR.msi` | 8.5 MB | Türkçe installer (önerilen) |
| `D-Terminal_0.1.0_x64_en-US.msi` | 8.5 MB | English installer |
| `D-Terminal_0.1.0_x64-setup.exe` | 7.5 MB | NSIS — TR/EN dil seçici, tek installer |
| `d-terminal.exe` | 12.4 MB | Standalone (portable, kuruluma gerek yok) |

**SHA-256 doğrulama** (PowerShell):
```powershell
Get-FileHash D-Terminal_0.1.0_x64_tr-TR.msi -Algorithm SHA256
```

| Dosya | SHA-256 |
|---|---|
| `*_x64_en-US.msi` | `108bf871f1350d47ea636d798c3d523dcab7c87ee60e1113f3c295543ccc54ae` |
| `*_x64_tr-TR.msi` | `243840a990c0561f8d499f6755f20f427496b6781ca0e4e673752869eff85291` |
| `*_x64-setup.exe` | `ae8dfd6ff73aa7bd64c565f1ad92107cb794d5f63b184dd7934eeee4c6ada4b0` |

### 🛡️ Güvenlik / Virüs Taraması

VirusTotal sonuçları (2026-05-03):

| Dosya | Sonuç | Yorum |
|---|---|---|
| **TR MSI** | **0/59 ✅** | Tamamen clean |
| **EN MSI** | **0/59 ✅** | Tamamen clean |
| **NSIS setup.exe** | **2/69 ⚠️** | Net false positive |

NSIS installer'da 2 alarm:
- **CrowdStrike Falcon** — `Win/grayware_confidence_60% (D)` — "Grayware" potansiyel istenmeyen anlamına gelir, %60 düşük güven, behavioral heuristic. Tauri/Electron-tipi yeni imzasız binary'ler için CrowdStrike'ın bilinen false positive pattern'i.
- **SecureAge** — `Malicious` (detaysız) — Cloud-only ML engine, yüksek false positive oranıyla bilinir.

**Major engine'ler hepsi clean**: Microsoft Defender, Kaspersky, BitDefender, ESET-NOD32, Sophos, Avast, McAfee, Symantec, Trend Micro, Malwarebytes, Avira.

Bu sonuç sektör standardı: **5'ten az engine flag = false positive** kabul edilir. False positive sebepleri:
- **Code signing yok** (en büyük sebep) — SignPath FOSS başvurusu yapıldığında %95+ alarm gider
- **node-pty sidecar** child process spawn — bazı behavioral engine'leri tetikler
- **WMI sorguları** (DFetch için Win32_VideoController, Win32_Battery)
- **Windows DPAPI** memory access (CryptProtectData) — credential vault korumalı

### 🧪 Bilinen sınırlar / TODO (v1.0.5+)

- Code signing eksik (SignPath Foundation FOSS başvurusu sürecinde) —
  installer Windows SmartScreen "Bilinmeyen yayıncı" uyarısı verir,
  "Yine de çalıştır" ile devam edilir
- Microsoft Store dağıtımı için manifest hazırlığı yapılmamış
- HTTP/SSH gelişmiş özellikler (config.ssh okuma) v1.1+
- Plugin marketplace v1.1+
- Free-form grid layout (Tilix tarzı) v1.1+
- Kitty Graphics Protocol v2.0
- Snippet bulut senkronizasyonu (Warp Drive paritesi) v2.0
- Multi-agent orkestrasyon v2.0

### 📝 Lisans

MIT © Orhan Engin OKAY
