# Değişiklik Günlüğü

[Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) formatına göre.
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Eklenen — Backend (Rust / Tauri)
- ADR-0001 PTY sidecar manager: spawn/multiplex/heartbeat/event emit
- ADR-0002 Windows DPAPI ile secret storage (`windows-rs`, `zeroize` ile bellek temizliği)
- ADR-0003 `rusqlite` + `r2d2` connection pool, WAL mode, `refinery` migration runner
- Storage repository'leri: history, session, settings, secrets, snippets
- Tauri komutları: pty (spawn/write/resize/kill), history, session, settings, secrets, ai_proxy, dfetch, themes, snippets, psreadline_import
- PSReadLine geçmişi içe aktarma + dedupe
- Global `AppError` tipi (i18n-friendly serde serialization)

### Eklenen — Frontend (Vue 3 / TypeScript)
- Pane sistemi: recursive split tree, drag-resize divider, focus rotation
- TerminalPane: xterm.js + sidecar event bridge
- AIChatPane: streaming chat (Anthropic SSE + Ollama NDJSON), AbortController iptali
- WelcomePane: DFetch sistem bilgi ekranı
- HistoryModal (Ctrl+Shift+F): fuzzy search + filter + favori + rerun + delete
- SessionModal (Ctrl+Shift+S/O): save/load + JSON v1 serialize
- SnippetModal: CRUD + dinamik kısayol bind
- CommandPalette (Ctrl+Shift+P): tüm action'lar tek panelden
- SettingsModal: dil, tema, font, AI key (DPAPI'ye gider, frontend'de plaintext yok)
- Toast notification sistemi
- Tema sistemi: JSON yükleme, CSS variable apply, xterm.js tema mapping (D-Dark, D-Light, D-Matrix)
- Klavye kısayol registry: 15 varsayılan kısayol, çakışma tespiti

### Eklenen — i18n
- TR + EN tam çeviri (~150 key)
- Tüm UI string'leri `t()` ile — hardcoded string yasak
- Parite testi: `tr.json` ve `en.json` aynı key tree, boş değer yok

### Eklenen — Test
- Sidecar protocol roundtrip: 13 test (Rust ↔ Node frame uyumu)
- i18n parity: 2 test
- CI: GitHub Actions (frontend + rust + sidecar 3 paralel job)

### Eklenen — Dokümantasyon
- Mimari belge v1.1 (markdown)
- 4 ADR (PTY IPC, DPAPI, Storage, Plugin sandbox)
- `docs/sidecar-bundling.md`: pkg/nexe ile binary üretimi
- README, CONTRIBUTING, LICENSE (MIT), Issue/PR template'leri

### Düzeltilen
- CI lockfile: `pnpm-lock.yaml` ve `sidecar/package-lock.json` repo'da
- Sidecar test script PowerShell glob expansion sorunu — explicit dosya listesi
- Rust formatting (cargo fmt --check) uyumsuzlukları
