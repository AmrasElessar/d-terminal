# D-Terminal

**🌐 Language:** **🇬🇧 English** · [🇹🇷 Türkçe](./README.md)

> An agent-aware Windows terminal — multiple shells, AI integration, and specialized pane types in a single window.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Status](https://img.shields.io/badge/status-pre--alpha-orange)
![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)

D-Terminal is a fully open-source application that gives Windows users a modern, fast, and AI-native terminal experience.

## 🆕 What's New in v0.1.1

- 🚀 **No more Node.js requirement** — the sidecar is bundled into a single `.exe` via `pkg` (Node 20 runtime embedded). The previous release failed on machines without Node; it now works **everywhere with zero dependencies**.
- 🪟 **No extra console window** — the sidecar is spawned invisibly (`CREATE_NO_WINDOW`).
- 📐 **Pane resize stabilized** — no more text clipping or prompt duplication when dragging dividers (ResizeObserver + PTY resize IPC debounce).
- 🤏 **Pane drag-and-drop rearrange** — grab any pane's title bar, drop on another pane's edge (left/right/top/bottom) → automatic split + tree restructure. Visual drop-zone highlight.
- ✏️ **Inline rename** — double-click a tab or pane title for in-place editing (no modal). Enter to save, Esc to cancel.
- 🏷️ **Group tags (colored badges)** — click the `#` button in a pane title bar and type a group name. Panes sharing a tag are automatically rendered with the **same color** (8-color hash-based palette). Simple but effective work focus — e.g. tag 3 panes "api" and 2 panes "frontend".
- 🎨 **Theme packages now load in production builds** — bundle path resolution fixed (`_up_/themes/` Tauri glob notation).
- 📦 **Smarter installer** — an NSIS pre-install hook silently terminates running D-Terminal processes; the version bump (0.1.1) triggers MSI/NSIS auto-upgrade (the old version is uninstalled automatically while user data is preserved).
- 🛡️ **Tauri webview HTML5 drag/drop enabled** — `dragDropEnabled: false` bypasses the native file-drop handler so in-app drag works correctly.

## Vision

D-Terminal targets Windows users who run their daily workflow from a terminal. It collapses the need for fragmented tools into a single application: PowerShell, CMD, and WSL sessions; AI conversations; system metrics and log streams — all under one shell.

Windows Terminal provides a solid tab/split foundation; D-Terminal builds on top of it with native AI integration, output triggers, block-based command history, a profile system, and a plugin framework — turning the terminal into a development platform.

## Highlights

### 🤖 AI — your own keys, never leaving your machine
- **4 providers**: Anthropic, OpenAI, Gemini, Ollama (offline) + a custom OpenAI-compatible endpoint
- **Rust HTTP proxy**: API keys are read from the Windows DPAPI vault on the Rust side; the frontend never sees a plaintext key (XSS risk eliminated)
- **Command generator**: natural language to shell command (`Ctrl+Shift+G` modal or `#` interception in an empty prompt)
- **Block-to-AI**: send terminal command blocks straight into the AI Chat with one click

### 📦 Block-based command history (OSC 133)
- Every command + output + exit code is captured automatically
- Color-coded status: ✓ success / ✗ error / ◌ running / ⊘ aborted
- Re-run a command, copy output, or send to AI
- Built-in PowerShell shell-integration prompt (CMD too)

### 🎯 Output Triggers (iTerm2 parity)
- Automatic action on regex match: toast, AI hand-off, snippet execution
- Cooldown + scope (per shell type) controls
- Match groups via `{{0}}`, `{{1}}` template placeholders

### 🪟 Pane System
- Horizontal/vertical splits, **per-tab independent tree**
- **Drag-rearrange**: grab a pane's title bar and drop on another pane's edge (v0.1.1)
- **Inline rename + group tags** — double-click for in-place editing, `#` for colored grouping (v0.1.1)
- Pane zoom (tmux `z` parity, `Ctrl+Shift+Z`)
- Broadcast input (tmux sync-panes — keystrokes go to every pane in parallel)
- Context menu: copy, paste, clear, split, close

### 🔌 Shell Profiles (iTerm2/Tabby parity)
- Built-in: PowerShell / CMD / WSL
- User-defined: SSH host, Docker exec, pwsh 7, Python REPL, ...
- Per-profile: shell + args + cwd + env + icon + color badge

### 🎨 Themes & Appearance
- **14 built-in themes**: D-Dark, D-Light, D-Matrix, D-Nord, D-Dracula, D-TokyoNight, D-Catppuccin, D-Gruvbox, D-Retro, D-Solarized-Dark/Light, D-OneDark, D-RosePine, D-GitHub-Dark
- Custom themes via JSON, runtime color swap
- Mica / Acrylic / None — runtime vibrancy switch (Win11 22H2+)
- Card-grid preview in Settings + ANSI swatches

### 📊 DFetch (neofetch parity)
- Built-in system info: CPU, GPU (WMI), disk, display + DPI, battery, theme, locale, timezone, swap, boot time
- **Local IP** (IPv4/IPv6) — never touches public IP (offline-first)
- **GDPR/KVKK masking**: hostname + IP hidden by default, click 👁 to toggle, session-scoped
- 4-color Windows OS logo (neofetch convention)
- 16 ANSI color blocks in the bottom strip

### 🔍 xterm Engine
- WebGL renderer with automatic Canvas/DOM fallback
- Scrollback search (`Ctrl+F`, regex/case/word, decoration highlight)
- Sixel + iTerm2 inline image protocols
- Unicode 11 (correct width for emoji + CJK)
- Smart links: file paths, git SHAs, IPs/hosts are clickable
- Buffer serialize → clipboard

### ⌨️ Keyboard-first
- 24 default shortcuts, **comprehensive editor** (Settings → Shortcuts)
- Key-capture overlay, conflict detection, override persistence
- Command palette (`Ctrl+Shift+P`)
- Quake hotkey (`F1` — show/hide window)

### 🔒 Security
- Credential storage via Windows DPAPI (no master password)
- AI keys live on the Rust side and never leak to the frontend
- Plugin sandbox skeleton: Web Worker + capability-based permissions (v1.1+)
- CSP enforced (script-src 'self'), wasm-unsafe-eval limited

### 💾 Persistence
- Session restore (layout + command history)
- SQLite WAL mode, keeps user files untouched
- Full-text search across snippets & history
- PSReadLine history import

### 🚀 Architecture
- Tauri v2 — Rust core + WebView2, ~5 MB binary, ~100 MB RAM (5× lighter than Electron)
- Length-prefixed binary IPC to a node-pty sidecar (ADR-0001), pkg-bundled standalone (no Node.js needed)
- Heartbeat-based zombie protection (Tauri crash → the sidecar exits automatically)

## Tech Stack

- **Tauri v2** — Rust core + WebView2
- **Vue 3** + TypeScript + Vite
- **xterm.js** — WebGL/canvas renderer, OSC 133, image addon, search, unicode 11
- **node-pty** — sidecar PTY bridge (standalone exe via `@yao-pkg/pkg`)
- **rusqlite** — local storage (WAL mode)
- **Windows DPAPI** — secret storage

## Architecture Documents

For architectural decisions and detailed design, see [docs/architecture-v1.1.md](./docs/architecture-v1.1.md) and the [ADRs](./docs/adr/).

## Roadmap

| Version | Target | Content |
|---|---|---|
| **v1.0** | 3–4 months | Most features in place; release polish + tests + docs |
| **v1.0.5** | +2 months | vue-i18n 11 migration (drop CSP `unsafe-eval`), Log Stream pane, snippet sync |
| **v1.1** | +3 months | Plugin API marketplace, advanced SSH (config.ssh reader), free-form grid, Lua/JS programmatic config |
| **v2.0** | — | Multi-agent orchestration, terminal AI assist (Warp Drive-style team sharing), Kitty graphics protocol |

## Installation

### Download (v0.1.1)

Get the latest release from [GitHub Releases](https://github.com/AmrasElessar/d-terminal/releases):

| File | Size | Arch | Description |
|---|---|---|---|
| `D-Terminal_0.1.1_x64_en-US.msi` | ~41 MB | x86_64 | **English installer** (recommended) |
| `D-Terminal_0.1.1_x64_tr-TR.msi` | ~41 MB | x86_64 | Turkish installer |
| `D-Terminal_0.1.1_x64-setup.exe` | ~27 MB | x86_64 | NSIS — single file with TR/EN language picker |
| `D-Terminal_0.1.1_arm64_en-US.msi` | ~40 MB | aarch64 | **ARM64 English** (Surface Pro X, Snapdragon laptops) |
| `D-Terminal_0.1.1_arm64_tr-TR.msi` | ~40 MB | aarch64 | ARM64 Turkish |
| `D-Terminal_0.1.1_arm64-setup.exe` | ~26 MB | aarch64 | ARM64 NSIS |

> The size increase (previously ~22 MB → 40 MB MSI) comes from embedding the Node.js runtime — there is **no longer any Node.js requirement** on the user's side.

### Security

All files are scanned on **VirusTotal** (results in [RELEASE_NOTES.md](./RELEASE_NOTES.md)):
- **MSI installers**: 0/59 ✅ fully clean
- **NSIS setup.exe**: 2/69 — both clear false positives (CrowdStrike grayware-60%, SecureAge ML)
- Microsoft Defender, Kaspersky, BitDefender, ESET, Sophos and other major engines all clean

Code signing is missing (SignPath FOSS application in progress) — Windows SmartScreen will warn "Unknown publisher"; click "Run anyway" to continue. The warning will go away after signing.

### System Requirements

- Windows 10 1809 (for ConPTY) or Windows 11
- ~80 MB RAM, ~15 MB disk
- WebView2 runtime (built-in on Win11; auto-installed on Win10 first run)

## Contributing

Contributions are welcome. You can write a theme, a language pack, an AI provider adapter, or a plugin.

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.

## D Brand Family

D-Terminal is the Windows arm of the D Brand family. Members are inspired by the name "Denizhan":

- **D-Player** — personal music player for Android with a DSP engine *(in development)*
- **DCar Launcher** — Android Head Unit in-car OS layer *(in development)*
- **D-Watchtower** — surveillance and monitoring platform *(in development)*
- **D-Terminal** — Windows agent-aware terminal *(this project, pre-alpha)*

## License

MIT © Orhan Engin OKAY — see [LICENSE](./LICENSE)
