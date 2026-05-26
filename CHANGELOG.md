# Değişiklik Günlüğü

[Keep a Changelog](https://keepachangelog.com/tr-TR/1.1.0/) formatına göre.
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] — 2026-05-26

**GPL-3.0-or-later relisans + post-audit sertleştirme + UX iyileştirmeleri.** 6-agent paralel audit'in HIGH/MEDIUM bulguları ve kullanıcı UX raporundaki 3 sorun (git diff sayacı, kapatma onayı, agent view modu) bir release'de bağlandı. Yeni feature: AgentView pane global mode + close confirm dialog + tab git aggregate.

### Lisans Değişikliği / License Change

- **D-Terminal lisansı `MIT` → `GPL-3.0-or-later`** (SPDX). Yürürlük: **v0.10.0**'dan itibaren. v0.9.9 ve daha eski tüm yayınlanmış sürümler MIT olarak kalır — geriye yürümez. D Brand açık kaynak uygulamaları için ortak lisans standardına geçiş (ücretli ürünler hariç).
- **Neden GPL-3.0-or-later?** Türev işler aynı özgürlüklerle dağıtılır (copyleft); kapalı-kaynak fork dağıtımı engellenir. "or-later" (FSF tavsiyesi) ileride GPLv4 çıkarsa otomatik uyum sağlar.
- **Bağımlılıklar etkilenmedi** — Tauri/Wry, Rust crate'leri (MIT/Apache permissive), Vue/Vite (MIT) tamamen GPL uyumlu; permissive license'lar GPL projeye eklenebilir.

### Eklenen

- **Tab git diff aggregate chip** — TabBar'da tab adının yanında tüm pane'lerin `+X -Y / ✓` toplamı, reactive (her `gitStatRef`'ten beslenir). `peekGitStat()` yan etkisiz read helper'ı eklendi.
- **Pane/tab kapatma onay dialog'u** — `Settings.confirmOnClose: never | runningOnly | always` (default `runningOnly`). `useCloseConfirm` composable; `Shift` basılıyken bypass. PaneSlot/TabBar/AppShell + keybinding'ler entegre. Tauri native dialog (Win32 TaskDialog).
- **AgentView pane GLOBAL mode** — `NewPaneDialog`'a manuel `agentView` seçeneği. Source/id boşsa tüm pane'lerdeki tüm agent'ları liste; tıklayınca single mode'a geçer. `agentSourcePaneId + agentId` leaf state'inde persist.
- **`Settings.agentHeuristicEnabled` toggle** — kapalıyken yalnız formal OSC 9999 protokolü dispatch eder (yanlış pozitif beklemeyen kullanıcılar için).
- **22 yeni i18n key** — `git.cleanHint`, `git.tabDiffHint`, `tab.paneCountHint`, `tab.closeConfirm*`, `pane.closeRunningConfirm` + `closeHint`, `settings.general.safetySection`, `confirmOnClose*`, `agentSection`, `agentHeuristic*`, `agentView.*` 7 key (önceden eksikti, sessiz fallback'e düşüyordu). TR + EN parity korundu.

### Değiştirilen

- **`PaneTitleBar.showGitStat` = `is_repo`** — repo içinde sıfır değişiklikte de chip görünür (✓ clean rozeti). Önceden tamamen kayboluyordu, kullanıcı "diff sayacı yok" sanıyordu.
- **`panes.cleanupPaneState({force})`** — source terminal kapansa da onu izleyen agentView leaf hâlâ açıksa agentWatch state'i korunur (kullanıcı agent geçmişine erişebilsin). `closeTab` ve `loadWorkspace` `force:true` ile geçer.
- **`useAgentDetector.detectParallelAgentRows`** — Claude Code paralel batch satırına `end` event eklendi (start + tokens + **end** üçlüsü). Önceden sadece start+tokens vardı → status sonsuz running + süre sonsuz artıyordu (yorum doğru, kod yanlıştı).
- **`lib.rs`** — `Storage::open().expect()` → `.map_err(?)` propagate (tracing::error + Tauri setup hatası, çıplak panic yok). `std::mem::forget(_guard)` → `Box::leak` (semantik aynı, niyet net).
- **`commands/logstream.rs`** — `validate_log_path`: `..` path component reject + symlink/junction reject (Windows `is_symlink()` reparse-point'leri yakalar). İki `read_to_string` → `.take(16 MiB).read_to_string` (OOM guard).
- **`commands/config_io.rs`** — `config_import` 14-prefix allowlist (`ui.`, `ai.`, `shortcut.`, ...) ile schema kirliliği koruması; bilinmeyen key `tracing::warn!` ile skip.
- **`tauri.conf.json` CSP** — `connect-src`'den 5 gereksiz localhost portu (1234/1337/5273/8080/11434) kaldırıldı; AI çağrıları Rust üzerinden yapıldığı için artık geçersiz (ADR-0007 closed).
- **`providers/common.ts`** — AbortError `.name = 'AbortError'` standardı (DOMException semantiği). Legacy `.message` check'i geriye uyumluluk için kaldı.
- **`agentWatch.ts`** — OSC 9999 string field DoS guard: `name` 200, `prompt` 500, `thinking text` 4 KiB, `error` 1 KiB, `progress.msg` 16 KiB per-event cap.

### Düzeltilen

- **`SettingsModal.vue:77-80` 5 boş `catch {}` → `log.warn`** — kapatılan capability hataları artık sessizce yutulmuyor; kullanıcı UI'da yanlış security state (admin/jail false) görmüyor. Memory'deki `feedback_tauri2_window_capabilities` kuralının doğrudan ihlali kapandı.
- **`AppShell.vue` + `useUpdater.ts` + `aiUsage.ts`** — 10× ham `console.warn` → structured `log.warn` (bridge backend log'una düşer).
- **`locales/index.ts`** — `any` zorunluluğu açıklandı (vue-i18n `LocaleMessage<VueMessageType>` recursive union tip sistemi; `unknown` çakışıyor). `eslint-disable` yorumları kaldırıldı (rule proje config'inde register değil).
- **RELEASE_NOTES.md footer** — `MIT © Orhan Engin OKAY` → `GPL-3.0-or-later` + tarihsel not.
- **18 vue style warning** — `pnpm exec eslint src --fix` ile pre-existing `multiline-html-element-content-newline` + `first-attribute-linebreak` ihlalleri temizlendi (WelcomePane, AgentWatchPanel, DarkSelect, HistoryModal).

### Güvenlik

- DPAPI per-user binding + entropy katmanı + `Zeroizing` doğrulandı; secret leak yok (test fixture'ları hariç).
- CSP `connect-src` minimize edildi (XSS post-compromise saldırı yüzeyi daraldı).
- Logstream path traversal: `..` + symlink/junction reject; junction üzerinden whitelist-dışı path okutma engeli.
- TOML import schema kirletilemez (14-prefix allowlist + warn skip).
- `cargo audit` 0 CVE. 90 Rust + 71 Vitest PASS.

### Bilinen Sınırlar

- 31 stub locale'de yeni v0.10.0 anahtarları yok — fallback EN (`fallbackLocale: 'en'`).
- AgentView global mode'da pane id sadece ilk 8 karakter gösterilir (kompakt liste); hover tooltip ileride.
- M (Triggers preset için agent pattern'leri) — yeni trigger action tipi gerektirir, v0.10.1+ patch.

---

## [0.9.9] — 2026-05-12

Settings UX iyileştirmeleri + heartbeat dayanıklılığı. v0.9.8 ile wire-uyumlu (protokol değişmedi). v0.9.6→v0.9.9 aynı haftanın dördüncü release'i — feature batch tek pakette.

### Eklenen
- **Auto-start on Boot** — `tauri-plugin-autostart` (Rust v2.5.1 + JS ^2.0.0) ile Windows `HKCU\…\Run` registry entry yönetimi; macOS LaunchAgent fallback. Settings → "Launch on Boot" toggle, backend `isEnabled()` tek doğru kaynak (kullanıcı manuel registry düzenlemiş olabilir). Toggle backend fail olursa state rollback + toast.
- **Update Check Frequency** ayarı — `startup | 1h | 6h | 12h | 24h` radio grup. Default `startup`: v0.9.x serisi sık release çıkardığı için her açılışta GitHub'a bakar (kullanıcı bildirimi kaçırmasın). `useUpdater.autoCheckOnStartup` debounce'u settings'e bağlandı. `updateMode='off'` ise frequency disabled görünür.
- **`UpdateCheckFrequency`** + **`autoStartOnBoot`** alanları `SettingsState`'e eklendi; locale anahtarları `tr/en` (`updateCheckFrequency`, `updateCheckFrequencyHint`, `updateFreq.*`, `autoStartSection`, `autoStartOnBoot`, `autoStartOnBootHint`, `autoStartFailed`).

### Değiştirilen
- **Heartbeat non-destructive timeout** — peer (Tauri/sidecar) sessizlik tespit edildiğinde **`shutdown()` ÇAĞRILMIYOR**. Sadece `SidecarDown` event emit edilir (UI badge); peer recover ederse `SidecarUp`. Uzun süren job (build, dump, veri taşıma) çalışırken false-positive timeout kullanıcının işini yakmaz. Gerçekten ölü ise reader EOF / stdout EPIPE doğal temizlik yapar + ProcessJail kill-on-close orphan riskini kapatır.
- **Heartbeat sleep/suspend tespiti** — laptop uyku/lid close sırasında `setInterval` ve `thread::sleep` donar; uyanışta `lastTauriContact` aşırı eskimiş görünür. `lastTick` ile gerçek tick gap ölçülür, **15s+ tick gap → sleep var sayılır, watchdog sıfırlanır**. Hem sidecar (`pty-bridge.js`) hem Tauri (`manager.rs`) tarafında uygulandı.
- **`PEER_TIMEOUT_MS` 15s → 30s** — GC/disk-IO geçici duraklamalarında false-positive riskini düşürür.

### Düzeltilen
- **`@tauri-apps/plugin-autostart` JS paketi `package.json`'a eksik** — `SettingsModal.vue` import ediyordu ama dep listesinde yoktu (commit `c896b36` öncesi runtime error riski). v0.9.9'a girmeden önce paket eklendi + pnpm-lock güncellendi.

## [0.9.8] — 2026-05-12

Post-v0.9.7 audit (5 paralel agent) bulgularının toplu fix paketi. HIGH/MEDIUM aksiyon kalemleri tek release'de bağlandı.

### Eklenen
- **ADR-0007: CSP Allowlist Scope** — `tauri.conf.json` CSP'sindeki localhost portlarının (dev HMR + AI runtime) **kasıtlı tasarım** olduğunu belgeleyen ADR. Future audit'ler için referans + sonraki adımlar (AI portları için Rust-only proxy migration) listelenir.
- **`process_jail_assign_failed` Tauri command + Settings UI uyarısı** — Job Object'e child eklenememesi durumunda kullanıcıya ⚠ "kill-on-close garantisi kayboldu" badge'i gösterilir (sticky, oturum sonuna kadar). Heartbeat 15s timeout fallback aktif kalır. `en/tr` `jailAssignFailedHint` locale anahtarları eklendi.
- **i18n parity: tree-structure testi** — leaf key parite testine ek olarak `structuralShape()` ile nested obje yapı derinliği de karşılaştırılır. EN'de nested object, TR'de string olan path'ler artık CI'da yakalanır (önceki test yalnızca leaf set eşitliğine bakıyordu).
- **`src/stores/settings.test.ts`** — `suppressConsoles` rollback regression testi: backend `processSetSuppressConsoles` invoke fail olursa state geri döner + sync flag temizlenir.
- **TerminalPane RAF coalescing** — backend 16ms event coalescing'ine ek olarak frontend `term.write` çağrıları `requestAnimationFrame` ile tek frame'e birleştirilir; büyük log dump'larda (yarn install, cat huge.log) WebGL/DOM repaint baskısı belirgin azalır.

### Düzeltilen
- **AI provider API error body log sızıntısı (`openai.rs`)** — `tracing::debug!` hata gövdesinin ilk 80 char'ını log'a düşürüyordu; release filter env-driven olduğu için debug seviyesi bypass olabiliyordu. Body artık hiç log'a düşmüyor (status + provider id yeterli, frontend için Err string zaten dönüyor).
- **`release.yml` artifact upload silent fail** — `fail_on_unmatched_files: false` ile glob match yokken sessizce geçilebiliyordu. Pre-upload "Verify bundle outputs" step'i (PowerShell ile installer + signature count kontrolü) + `fail_on_unmatched_files: true` ile bundle eksik kalırsa CI hard fail.
- **`git_diff_shortstat` paralelleştirme** — `git diff --shortstat HEAD` ve `git ls-files --others` artık iki ayrı `spawn_blocking` task'ında **paralel** koşar (`tokio::join!` ile join). `run_git_diff_tracked` fonksiyonu rename + untracked çağrısı caller'a taşındı; path validation tek yerde (race-bypass riski yok).
- **`sidecar/manager.rs` reader/restart lock pattern dokümantasyonu** — `ensure_started`'da `drop(inner)` sonrası lock-on-lock olmadığını garantileyen yorum eklendi (audit agent'ları false-positive deadlock raporu vermesin diye, kod davranışı değişmedi).

### Güvenlik
- AI debug log body sızıntısı kapatıldı — release build'lerde prompt/model echo riskini sıfırlar.
- Bundle artifact eksik upload'ı CI hard fail ile yakalanır — eksik installer ile yayın engellenir.
- Process koruma assign failure'u kullanıcıya görünür hale geldi (sessiz `tracing::warn` yerine Settings UI badge'i).

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
