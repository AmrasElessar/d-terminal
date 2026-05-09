# Değişiklik Günlüğü

[Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) formatına göre.
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.4] — 2026-05-09

Comprehensive hardening release. 11 paralel ajan ile audit; ~210 bulgudan release-blocker güvenlik açıkları, memory leak'leri, WCAG ihlalleri, AI provider eksiklikleri kapatıldı. Kalite skoru ~7.8 → ~9.4. Detay: bkz. [RELEASE_NOTES.md](./RELEASE_NOTES.md#v094--2026-05-09).

### Eklenen
- DPAPI entropy katmanı (`pOptionalEntropy`) + v0.9.3 öncesi blob'lar için otomatik fallback re-encrypt.
- AI streaming gerçek abort: `oneshot` cancel + `tokio::select!` + `ai_abort_stream` Tauri komutu.
- AI exact token sink: Anthropic `message_delta`, OpenAI `stream_options.include_usage`, Ollama `done` frame; Türkçe morfoloji estimate'i %30 underestimate kapandı.
- AI providers retry/backoff (429/503, `Retry-After` aware) + idle timeout (60s/chunk).
- Storage V002 migration: 5 yeni index + `history_fts` FTS5 + 3 trigger.
- `_app_version` downgrade guard + migration öncesi `VACUUM INTO` backup (son 5 yedek).
- `HistoryRepo::add_bulk` — psreadline 5000 satır 30sn → <1sn.
- `stores/chats.ts` yeni store — AI chat per-pane Pinia, pane unmount'ta veri kaybolmuyor.
- HELLO handshake protokolü (`MsgType::Hello = 0x00`) + protocol versiyonlama.
- `:focus-visible` global outline (WCAG 2.4.7).
- `prefers-reduced-motion` global media query (WCAG 2.3.3).
- 5 vue-i18n plural rule (`results`, `cores`, `panes`, `notice`, `exportDone`).
- `dfetch.*` namespace 17 yeni anahtar (Battery, Resolution, IPv4/6, Net I/O, Locale, Timezone vs.).
- WelcomePane 21 hardcoded label artık i18n.
- CI: ARM64 matrix + yeni `audit` job (cargo-audit RustSec).
- `.github/dependabot.yml` — npm/cargo/actions otomatik PR.
- `.gitattributes` (LF/CRLF normalization).
- `src-tauri/about.toml` (cargo-about license raporu config'i).
- `.githooks/pre-commit` + `scripts/setup-hooks.ps1` (opt-in cargo fmt + lint).
- 127 yeni otomatik test (Rust +48, vitest +64, redact + keybindings + dialog + useGitStat + chats + aiPricing + DPAPI + migrations + history + secrets + snippets + coalesce stress + error variants).
- AI usage `UsageInfo` Channel + frontend `ExactUsage` callback.
- Theme JSON şema validation — bozuk tema parse skip + warn.

### Düzeltilen
- DevTools artık release build'de kapalı (`Cargo.toml` `tauri/devtools` feature kaldırıldı).
- `pty_spawn` shell whitelist + cwd UNC reddi + env key blacklist (XSS→RCE zincirini kapatır).
- `dfetch_save_snapshot` path white-list + `.png` zorunlu + 25MB limit.
- `log_stream_open` extension whitelist + UNC reddi (SSH key/credentials exfil).
- `git_diff_shortstat` env hardening (`GIT_CONFIG_NOSYSTEM`, `safe.directory=*`, `core.fsmonitor=`, `core.sshCommand=` — CVE-2022-24765 ailesi).
- `themes_save_user` 256KB + JSON validate.
- AI key Zeroizing leak (`String::from_utf8_lossy(&bytes).into_owned()` Zeroizing kaybediyordu — 4 ajan onaylı). Artık `Zeroizing<String>` olarak dolaşır.
- Smart link RCE — TerminalPane `onPath` UNC + executable extension reddediyor.
- Sidecar `events_tx` unbounded mpsc → `sync_channel(4096)` backpressure.
- Sidecar reader/stderr/heartbeat thread leak — `JoinHandle` saklanır, restart'ta join edilir.
- Sidecar `Drop` impl + Tauri `RunEvent::ExitRequested` handler — zombi process engelleme.
- `Frame::encode` doğrudan stdin'e yazıyor (heartbeat/keystroke/resize 0 alloc/frame).
- `paneBufferCache` cleanup `closeTab/loadWorkspace`'te (~1.5 MB/pane leak).
- `agentWatch.clearPane` çağrılır oldu.
- `dfetch_get` `async` + `tokio::spawn_blocking` (Tauri main thread'i bloklamaz).
- `detect_battery` 5s TTL cache (WMI thread spawn churn'u durdu).
- Settings auto-persist watch O(N²) → per-field watch.
- `secrets.get_blob` non-atomic SELECT+UPDATE → tek transaction.
- `kill_pane` semantik — pane EXIT frame ile silinir (frontend EXIT bildirimini garanti).
- DPAPI sistem buffer'ı `LocalFree` öncesi volatile-zero.
- 6 modal `window.confirm()` → Tauri `dialog.ask()` native.
- HistoryModal aria-label, AIChatPane `aria-live="polite"`, AppShell admin/SettingsModal font-preview aria-label i18n.
- SplitContainer drag `pointercancel` + `blur` listener.
- SettingsModal `captureShortcutKey` listener leak.
- D-Dark `--color-dim` 3.97:1 → 5.0:1 (WCAG AA).
- `fallbackLocale: 'tr'` → `'en'` (industry-standard).
- AboutModal Copyright dinamik yıl.
- Türkçe error literal'leri i18n key'lere taşındı (`providers/custom.ts`, `stores/triggers.ts`).
- `temperature/max_tokens: null` body'den çıkarıldı (vLLM/llama.cpp 400 önleme).
- AI hata log body 500ch → 80ch (account ID/quota detay sızıntısı azaltma).
- `mmap_size` 256MB → 64MB; `busy_timeout: 5s` set.
- xterm scrollback 10000 → 5000 settings-driven.
- KeybindingRegistry constructor `DEFAULT_SHORTCUTS` defensive clone (state izolasyonu).
- Splash sahte timer ~870ms → ~210ms + cancelled flag dismount race.
- `vue/no-v-html: warn → error` (XSS sertleştirme).
- vitest `passWithNoTests: false` (CI yeşil tik yanılsaması kapandı).
- `bundle.publisher: "Orhan Engin OKAY"` + 7 ikon (high-DPI, MSIX wrap).
- 9 AI provider eager → dynamic import + 33 locale raw lazy + font lazy load (~3.5 MB initial bundle).
- AppShell mount sequential await → `Promise.all` (300-500ms kazanç).
- agentWatch `paneView`/`paneSummary` memoize.
- Pricing tablosu: o3, o3-mini, o4-mini, Gemini 2.5 Flash eklendi.
- `dialog:allow-save` capability (WelcomePane snapshot için eksikti).

### Güvenlik
- Çoklu ajan auditi sonucu kapatılan release-blocker güvenlik açıkları (XSS→RCE, path traversal, prompt injection, secret leak, key exfiltration). Bkz. RELEASE_NOTES.md ayrıntıları.

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
