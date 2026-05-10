# Değişiklik Günlüğü

[Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) formatına göre.
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.7] — 2026-05-10

Post-v0.9.6 follow-up audit (4 paralel agent) bulgularının toplu düzeltmesi + ProcessJail dokümantasyonu + DX iyileştirmeleri. Detay: bkz. [RELEASE_NOTES.md](./RELEASE_NOTES.md#v097--2026-05-10).

### Eklenen
- **ADR-0006: ProcessJail (Windows Job Object) Mimarisi** — yeni mimari kararının resmi dokümantasyonu (alternatives + trade-offs + risk azaltma).
- **`process_jail_active` Tauri command + Settings UI badge** — kullanıcıya kill-on-close korumasının aktif olup olmadığı görsel geri bildirim ile bildirilir.
- **`.github/workflows/cache-cleanup.yml`** — haftalık (Pazar 02:00 UTC) LRU cache sweep; 7 günden eski Actions cache'leri otomatik siler. Repo cache 10 GB soft limit aşıldığında manuel temizlik gerekmiyor.
- **`src/locales/parity.test.ts`** — i18n parity vitest: TR ↔ EN key tree intersection. Yeni anahtarlar eklenirken iki dilde de tanımlı olduğu CI'da gate edilir.
- **adaptive git stat polling** — pane git repo değilse 30s, repo+değişiklik varsa 5s. 50 pane senaryosunda subprocess rate ~%80 azalır.
- **`docs/privacy.md` Process Isolation section (v0.9.6+)** — KVKK/GDPR perspektifinden Job Object child cleanup açıklaması.
- **`CONTRIBUTING.md` Teknik Gereksinimler bölümü** — pnpm@9.15.0 exact pin, corepack/manuel kurulum talimatı.
- **`.github/PULL_REQUEST_TEMPLATE.md` ProcessJail reminder** — yeni `Command::new` eklendiğinde `state.jail.configure_command()` çağrısının unutulmaması için checklist item.

### Düzeltilen
- **PaneTitleBar `showGitStat` computed leaf.id reactive** — pane remount sonrası (split kapatma) eski state'e bağlı kalıyor, fresh ref'e dinleyemiyordu. Computed leaf.id'ye bağlı oldu.
- **Settings double-watch race** — `suppressConsoles` toggle backend `processSetSuppressConsoles` invoke fail olursa state rollback edilir; "DB false ama jail true" tutarsızlığı engellendi.
- **`release.yml` glob pattern `**/*.msi`** — softprops/action-gh-release@v3 glob davranışı değişti; Tauri 2 bundle output dizin yapısı gelecekte değişirse asset upload fail olmaması için recursive `**` pattern kullanıldı.
- **`validate_endpoint_dns` 5s timeout** — DNS blackhole / hijack edilmiş resolver'da chat çağrısı sonsuz hang etmez; `tokio::time::timeout` ile sınırlandırıldı.
- **`clearGitStatStateLazy` dedupe** — hızlı close-open senaryolarında aynı leafId için pending Promise paylaşılır; çift import + çift clear engellenir.
- **`docs/adr/0001-pty-sidecar-ipc-protocol.md`** — ADR-0006 ile supersede edildiği belirtildi (heartbeat artık fallback).
- **`README.md`** — v0.9.x serisinde "ProcessJail console suppression" + "git diff untracked desteği" özellikleri vurgulandı.
- **`docs/dev-setup.md`** — pnpm version `9+` → `9.15.0` exact pin.
- **CHANGELOG `[Unreleased]`** açıklayıcı yorum (v0.9.x history nedeni).
- **`sidecar/pty-bridge.js`** — Job Object grandchild inheritance design intent header comment.

### Güvenlik
- DNS rebind hardening + timeout (5s) → `validate_endpoint_dns` infinite hang riski kapatıldı.
- Settings race condition fix → backend/frontend jail state divergence engellendi.

## [0.9.6] — 2026-05-10

5 paralel agent ile post-v0.9.5 audit + kullanıcı raporlu bug fix'leri + yeni `ProcessJail` özelliği. Detay: bkz. [RELEASE_NOTES.md](./RELEASE_NOTES.md#v096--2026-05-10).

### Eklenen
- **`ProcessJail`** — D-Terminal'in spawn ettiği tüm child process'leri Windows Job Object altında topluyor: (1) console window flash'ları kapanır (CREATE_NO_WINDOW tek noktadan), (2) parent crash'inde tüm child'lar `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` ile otomatik temizlenir, (3) Settings → "Gizlilik & Performans" altında runtime toggle.
- `commands/process.rs` — `process_set_suppress_consoles`, `process_suppress_consoles`, `process_jail_active`.
- `git diff` chip untracked dosya desteği — `git ls-files --others --exclude-standard` ile yeni dosyaların satır sayısı `added`'a, dosya sayısı `files`'a eklenir (DoS guard: max 500 dosya, dosya başına 1 MB).
- `validate_endpoint_dns` — public hostname'in tüm resolved IP'lerini private/loopback/link-local kontrolünden geçirir (DNS rebinding hardening, M4).
- `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1, Türkçe) + `SECURITY.md` (tehdit modeli + GitHub Security Advisory akışı + cryptographic trust notları).
- Vitest coverage config (v8 provider + threshold).
- `package.json` `packageManager: pnpm@9.15.0` pin.
- Dependabot grouping (dependencies / major + sidecar major bloke + actions weekly).
- 9 yeni Rust test (ProcessJail) + git_stat untracked path kontrol testleri (toplam 81 → 90).

### Düzeltilen
- **Pane title bar git diff +/- chip "kod değişimi var ama görünmüyor"** — iki kök neden: (a) `git diff --shortstat HEAD` untracked dosyaları kaçırıyordu, (b) `setPaneCwd` sadece OSC 7 ile çağrılıyordu — ilk prompt'tan önce cwd boştu, polling no-op'tu. Spawn sonrası `profile.cwd` initial fallback eklendi.
- `dfetch_save_snapshot` path traversal — `create_dir_all`'dan önce lexical `..` segment reddi + allowed-root prefix check (M2). Saldırgan persist primitive engellendi.
- `admin_open_dev_settings` `cmd /c start` shell aracısı kaldırıldı — `ShellExecuteW` direct çağrı + URI literal sabit (M1).
- AI abort race — `oneshot::Sender::is_closed()` check + race log; chat tamamlanırken abort gelirse no-op.
- `lib.rs coalesce_pty_events` 2× `unreachable!()` panik riski → `tracing::error!` + pass-through fallback (UI crash yerine küçük merge kaybı).
- AI provider 4xx/5xx hata gövdeleri `tracing::warn` → `tracing::debug` (4 dosya: openai/anthropic/gemini/ollama) — release log'da prompt/model echo sızıntısı.
- `redact.ts` base64 regex `40+` → `60+` char eşik (git SHA / hash false-positive azaltıldı).
- Sidecar event queue 4096 → 16384 (coalescing window'da burst tolerans).
- AppShell startup `catch(() => {})` silent yutma → `log.warn`/`error` (panes.startListening kritik olduğu için error seviyesi).
- `panes.cleanupPaneState` → `clearGitStatState` defansif lazy-import çağrı.
- Polling interval 10s → 5s (daha hızlı feedback).

### Güvenlik
- Dependency patch'leri merge edildi: tauri 2.11.0 → 2.11.1 (ACL bypass), tokio 1.52.1 → 1.52.3 (mpsc underflow + RwLock soundness), tauri-build 2.6.0 → 2.6.1, + 8 npm/actions patch.
- Dependabot grouping ile patch+minor tek "dependencies" grup PR'ı, major ayrı; sidecar major bloke; actions monthly → weekly.
- Yeni `validate_endpoint_dns` async DNS rebind hardening — public hostname IMDS rebinding kapatıldı.
- ProcessJail kill-on-close ile zombi sidecar riski tarihte kaldı (eskiden 15s heartbeat timeout'a kadar yaşardı).

### CI
- `pnpm/action-setup@v6` `version: 9.15.0` explicit pin (`packageManager` ile eşit, "Multiple versions" lint kapanır).
- `cargo fmt --check` + `cargo clippy -D warnings` her commit'te.

## [0.9.5] — 2026-05-09

D-Matrix temasına özel intro deneyimi + WelcomePane race condition fix + AppShell polish. Detay: bkz. [RELEASE_NOTES.md](./RELEASE_NOTES.md#v095--2026-05-09).

### Eklenen
- `MatrixRain.vue` — D-Matrix temasında WelcomePane arka planında klasik "code rain" canvas overlay (intensity prop, `prefers-reduced-motion` saygılı, per-instance rAF + ResizeObserver).
- WelcomePane Matrix intro: 1500 ms full rain → 0.18 atmosfer fade; satır reveal'inde ~250 ms katakana glyph scramble.
- AppShell brand shimmer — 3-stop palindrome gradient (A→B→A) + `200% 100%` background-size + `-200%` offset ile seamless 8 s loop, `prefers-reduced-motion` ile durur.

### Düzeltilen
- WelcomePane `play()` reentrancy guard (`playToken`) — `info` watcher + `onMounted` çift `play()` tetiklerken ikincisinin `clearTimers()`'i birincinin Matrix intro `setTimeout`'unu öldürünce birinci sonsuz `await`'te asılırdı. Şimdi token kontrolü ile eski play temiz abort olur.
- WelcomePane `isMatrixTheme` watcher — default→Matrix tema geçişinde rain canvas mount olurken `rainIntensity` stale `0` kalmıyor; `play()` yeniden çağrılır, fresh intro akışı başlar.
- WelcomePane `welcome__hint` `position: relative; z-index: 1` — rain canvas (z=0, position absolute) static elementlerin üzerine çıkıyordu, hint metni yağmur altında kalmasın.
- AppShell header çift-tık maximize — `startDragging()` çağrıldıktan sonra `dblclick` event'i WebView'a iletilmediği için ayrı `dblclick` handler tetiklenmiyordu. Şimdi `mousedown.detail === 2` ile çift-tık tespit edilir, drag yerine `winToggleMax()` çalışır (Windows native title bar davranışı).

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

<!-- v0.9.6 yayınlandı 2026-05-10. Bu bölüm v0.9.x'in erken (v0.1-v0.9.0)
     unreleased history'sini koruyor. Yeni feature'lar burada değil,
     yukarıdaki versionlu section'larda. v0.9.7'den sonra bu bölüm temizlenebilir. -->

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
