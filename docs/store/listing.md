# D-Terminal — Microsoft Store Listing

> Bu dökümandaki metinler MS Store submission formuna direkt yapıştırılabilir.
> All text here is ready to paste into the MS Store submission form.

---

## 🇹🇷 Türkçe

### Uygulama adı
**D-Terminal**

### Kısa açıklama (Short description — max 100 char)
Agent-aware Windows terminali — çoklu shell, AI entegrasyonu ve uzmanlaşmış pane'ler tek pencerede.

### Tam açıklama (Description — max 10K char)

**D-Terminal**, Windows için modern, hızlı ve **AI-yerli** açık kaynak bir terminal uygulamasıdır. PowerShell, CMD ve WSL oturumlarını; AI sohbetlerini; sistem bilgisi ve log akışlarını **tek bir pencerede** birleştirir.

#### 🤖 Yapay zeka, kendi anahtarınla
- 4 sağlayıcı: Anthropic, OpenAI, Google Gemini, Ollama (offline) + OpenAI-uyumlu özel endpoint
- 5 yerel runtime: Ollama, LM Studio, Jan, Text Generation WebUI, Llama.cpp
- API key'lerin Windows DPAPI ile şifrelenir; bizim sunucularımıza **kesinlikle** sızmaz
- Boş prompt'a `#` yaz → doğal dilden shell komutu üretir
- Block'tan AI'a tek tıkla — komut çıktısını AI Chat'e enjekte et
- Canlı maliyet + token takibi her oturum için

#### 🛰️ AI Agent Watch (D-Terminal'e özgü)
- Pane başına AI agent gözlemcisi — Claude Code, Codex, Aider, Cursor otomatik tespit
- OSC 9999 protokolü ile sessizce takip — tool çağrıları, bekleyen onaylar, tamamlanan adımlar
- Canlı maliyet rozeti, "running / waiting / interrupted" durum göstergesi
- Auto-split + heuristik dedektör paralel agent'ler için

#### 🪟 Pane sistemi
- Yatay/dikey split, sekme başına bağımsız ağaç
- Drag-rearrange — pane başlığını sürükle, başka pane'in kenarına bırak
- Inline rename, renkli grup tag'leri, pane zoom modu
- Broadcast input (tmux sync-panes paritesi)

#### 📦 Block tabanlı komut tarihi (OSC 133)
- Her komut + çıktı + exit kodu otomatik yakalanır
- Komut yeniden çalıştır, çıktı kopyala, AI'a gönder
- Pane başlığında git diff +/- chip canlı

#### 🎨 14 dahili tema + custom JSON
D-Dark, D-Light, D-Matrix, D-Nord, D-Dracula, D-TokyoNight, D-Catppuccin, D-Gruvbox, D-Retro, D-Solarized-Dark/Light, D-OneDark, D-RosePine, D-GitHub-Dark. Mica/Acrylic/None vibrancy switch (Win11 22H2+).

#### 🔍 xterm motoru
- WebGL renderer + Canvas/DOM fallback
- Scrollback search (regex/case/word)
- Sixel + iTerm2 inline image
- Unicode 11 (emoji + CJK)
- Smart link (file path, git SHA, IP/host tıklanabilir)

#### 🚀 Hafif ve hızlı
**Tauri v2** ile yazıldı (Rust core + WebView2). Electron'a göre **5× daha hafif** — ~5 MB binary, ~100 MB RAM.

#### 🔒 Güvenlik
- Windows DPAPI credential storage (master parola yok)
- CSP enforced (`script-src 'self'`)
- KVKK/GDPR uyumlu — IP/hostname varsayılan gizli
- Açık kaynak (MIT) — kodu inceleyebilirsin

#### Sistem gereksinimleri
- Windows 10 1809+ veya Windows 11
- ~80 MB RAM, ~50 MB disk
- WebView2 runtime (Win11'de yerleşik, Win10'da ilk kurulumda otomatik)
- ARM64 ve x64 mimarileri tam destekli

### Anahtar kelimeler (Keywords — max 7)
1. terminal
2. powershell
3. ai
4. developer
5. agent
6. windows terminal
7. shell

### Kategori (Category)
**Developer tools** (alt kategori: **Development kits**)

### Yaş derecelendirmesi (Age rating)
**3+ (Everyone)** — kullanıcı üretimi içerik yok, in-app satın alma yok, reklam yok.

### Sertifika notları (Notes for certification)
> D-Terminal is a developer-focused terminal emulator. It declares `runFullTrust` capability because it spawns native shells (PowerShell, CMD, WSL) via Windows ConPTY API — this is required for any Windows terminal application. The bundled `dterminal-pty-bridge.exe` (Node.js sidecar) is a length-prefixed binary IPC bridge to node-pty (https://github.com/microsoft/node-pty), packaged via @yao-pkg/pkg into a standalone executable. No external network telemetry. AI requests go directly from user to user-configured providers; no proxy or relay through our servers. Privacy policy: https://amraselessar.github.io/d-terminal/privacy.html

---

## 🇬🇧 English

### App name
**D-Terminal**

### Short description (max 100 char)
Agent-aware Windows terminal — multi-shell, AI integration, specialized panes in one window.

### Description (max 10K char)

**D-Terminal** is a modern, fast, **AI-native**, open-source terminal for Windows. It collapses PowerShell, CMD, and WSL sessions, AI conversations, system metrics, and log streams into a **single window**.

#### 🤖 AI with your own keys
- 4 providers: Anthropic, OpenAI, Google Gemini, Ollama (offline) + custom OpenAI-compatible endpoint
- 5 local runtimes: Ollama, LM Studio, Jan, Text Generation WebUI, Llama.cpp
- API keys are encrypted in Windows DPAPI; **never** leave for our servers
- Type `#` on empty prompt → AI generates shell command from natural language
- Block → AI in one click — pipe command output to AI Chat
- Live cost + token tracking per session

#### 🛰️ AI Agent Watch (unique to D-Terminal)
- Per-pane AI agent observer — auto-detects Claude Code, Codex, Aider, Cursor
- OSC 9999 protocol silently tracks — tool calls, pending approvals, completed steps
- Live cost badge, "running / waiting / interrupted" state indicator
- Auto-split + heuristic detector for parallel agents

#### 🪟 Pane system
- Horizontal/vertical splits, per-tab independent tree
- Drag-rearrange — drop a pane title onto another pane's edge
- Inline rename, colored group tags, pane zoom mode
- Broadcast input (tmux sync-panes parity)

#### 📦 Block-based command history (OSC 133)
- Every command + output + exit code captured automatically
- Re-run a command, copy output, send to AI
- Live git diff +/- chip in pane title

#### 🎨 14 built-in themes + custom JSON
D-Dark, D-Light, D-Matrix, D-Nord, D-Dracula, D-TokyoNight, D-Catppuccin, D-Gruvbox, D-Retro, D-Solarized-Dark/Light, D-OneDark, D-RosePine, D-GitHub-Dark. Mica/Acrylic/None vibrancy switch (Win11 22H2+).

#### 🔍 xterm engine
- WebGL renderer + Canvas/DOM fallback
- Scrollback search (regex/case/word)
- Sixel + iTerm2 inline image
- Unicode 11 (emoji + CJK)
- Smart links (file paths, git SHAs, IPs/hosts clickable)

#### 🚀 Light & fast
Built on **Tauri v2** (Rust core + WebView2). **5× lighter** than Electron — ~5 MB binary, ~100 MB RAM.

#### 🔒 Security
- Windows DPAPI credential storage (no master password)
- CSP enforced (`script-src 'self'`)
- GDPR/KVKK compliant — IP/hostname hidden by default
- Open source (MIT) — review the code yourself

#### System requirements
- Windows 10 1809+ or Windows 11
- ~80 MB RAM, ~50 MB disk
- WebView2 runtime (built-in on Win11, auto-installed on Win10 first run)
- Full ARM64 and x64 architecture support

### Keywords (max 7)
1. terminal
2. powershell
3. ai
4. developer
5. agent
6. windows terminal
7. shell

### Category
**Developer tools** (subcategory: **Development kits**)

### Age rating
**3+ (Everyone)** — no user-generated content, no in-app purchases, no ads.

### Notes for certification
> D-Terminal is a developer-focused terminal emulator. It declares `runFullTrust` capability because it spawns native shells (PowerShell, CMD, WSL) via Windows ConPTY API — this is required for any Windows terminal application. The bundled `dterminal-pty-bridge.exe` (Node.js sidecar) is a length-prefixed binary IPC bridge to node-pty (https://github.com/microsoft/node-pty), packaged via @yao-pkg/pkg into a standalone executable. No external network telemetry. AI requests go directly from user to user-configured providers; no proxy or relay through our servers. Privacy policy: https://amraselessar.github.io/d-terminal/privacy.html

---

## 📸 Required screenshots (1920×1080 or 3840×2160 PNG)

Hazırlanacak ekran görüntüleri / Screenshots to prepare:

1. **Hero shot**: Boş D-Terminal, mavi gradient tema, welcome banner görünür
2. **AI command generator**: `#` ile doğal dilden komut üretimi, popup ile beraber
3. **Multi-pane workspace**: 4 pane'li layout, farklı shell tipleri (PS + CMD + WSL + AI Chat)
4. **Agent Watch**: Claude Code çalışırken canlı maliyet rozeti + tool call görüntüsü
5. **DFetch overlay**: sistem bilgisi, ANSI swatch'lar, neofetch logo
6. **Theme picker**: Settings'te 14 tema kart-grid önizleme

> Demo videosu zaten mevcut: `docs/media/d-terminal-showcase.mp4` — Store'a "App Trailer" olarak eklenebilir.
