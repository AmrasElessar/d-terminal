# D-Terminal Release Notes

## v0.9.6 — 2026-05-10

**Audit follow-up + kullanıcı raporlu bug fix + yeni `ProcessJail` özelliği.** v0.9.5 release marathon'undan sonra 5 paralel ajan ile post-release audit yapıldı; Tauri 2.11.0 ACL bypass + Tokio mpsc underflow patch'leri merge edildi, kalan medium bulgular kapatıldı. Kullanıcı raporlu "git diff +/- chip kod değişimi varken görünmüyor" bug'ı çözüldü (untracked dosyalar). Yeni özellik: tüm child process'leri toplayan Windows Job Object jail'i — DOS pencere flash'ları kapanır + parent crash'inde child'lar otomatik temizlenir. v0.9.5 ile wire-uyumlu (DB şeması/protokol değişmedi).

### 🛡 ProcessJail — child console suppression + kill-on-close

D-Terminal'in spawn ettiği komutlar (sidecar, `git_stat`'ın `git`, gelecekte daha fazlası) Windows'ta default olarak yeni `conhost.exe` açıyordu — ekrandaki "DOS pencere flash'ları" kullanıcı tarafından raporlandı. Aynı zamanda eski mimari'de zombi sidecar riski vardı: D-Terminal abrupt kapatılırsa sidecar 15s heartbeat timeout'a kadar yaşardı.

`ProcessJail` (`src-tauri/src/process_jail.rs`) bu iki problemi tek mimari ile çözüyor:

- **Console suppression** — `configure_command(&mut Command)` helper'ı her spawn'da `CREATE_NO_WINDOW` flag'ini set eder. Sidecar ve `git_stat`'ın iki spawn site'ı (run_git_diff + collect_untracked) entegre.
- **Job Object kill-on-close** — `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag'i ile yaratılan anonymous Job. `assign(child)` ile spawn'lar Job'a kayıt edilir. Parent process abrupt kapanırsa Windows tüm üyeleri otomatik terminate eder.
- **Runtime toggle** — Settings → Genel → "Gizlilik & Performans" altında `Suppress child console windows` checkbox'ı. `process_set_suppress_consoles` Tauri command'ı `AtomicBool` flip eder, restart gerekmez.
- **Graceful degradation** — Job creation fail olursa (Win32 quota exhaustion gibi rare durumda) `configure_command` yine `CREATE_NO_WINDOW` ekler; assign no-op döner. Heartbeat timeout (15s) yine zombie'leri yakalar.
- **Cross-platform** — `#[cfg(not(windows))]` no-op fallback. macOS/Linux'ta zaten console window kavramı yok.

9 yeni unit test eklendi (3 Windows-only: gerçek `cmd.exe` spawn + Job assignment + race senaryosu). Toplam Rust test sayısı: 81 → **90**.

### 🐛 Git diff +/- chip — "kod değişimi varken chip görünmüyor"

Pane title bar'daki git diff `+N -M` chip'inde "yeni dosya ekledim ama chip 0/0'da takılı" raporu. İki kök neden:

1. **Untracked dosyalar sayılmıyordu** — `git diff --shortstat HEAD` sadece tracked (committed/staged) dosyaları görür. `git ls-files --others --exclude-standard` ile yeni dosyalar listelenir, her birinin satır sayısı `added`'a, dosya sayısı `files`'a eklenir. DoS guard: max 500 dosya, dosya başına 1 MB cap (binary/log dosyaları sayılmaz).
2. **Initial cwd race** — `setPaneCwd` sadece OSC 7 sequence ile çağrılıyordu; kullanıcı ilk prompt'a Enter basana kadar cwd boş, polling no-op. `TerminalPane` spawn sonrası `profile.cwd` ile initial fallback yapar; sonraki OSC 7 aynı path ise no-op (cwd === newCwd guard zaten var), değişikse override.
3. **Polling 10s → 5s** — yerel `git diff` <50ms; daha hızlı feedback.

### 🔒 Güvenlik — post-v0.9.5 audit follow-up

5 paralel ajan tarama'sından kalan medium bulgular + kritik dependency patch'leri:

- **`tauri 2.11.0 → 2.11.1`** (Dependabot PR#6) — "fix(tauri): enforce ACL for remote origins even without AppManifest" CWE-862 patch'i.
- **`tokio 1.52.1 → 1.52.3`** (PR#5) — mpsc underflow + RwLock soundness CWE-191/662.
- **`tauri-build 2.6.0 → 2.6.1`** (PR#9) — paired tauri patch.
- **`dfetch_save_snapshot` path traversal (M2)** — `create_dir_all` allowed-root check'ten ÖNCE; saldırgan `Pictures/../Startup/evil` ile dizin yaratamaz. Lexical `..` segment reddi + canonical defense-in-depth.
- **`admin_open_dev_settings` (M1)** — `cmd /c start` shell aracısı kaldırıldı; `ShellExecuteW` direct çağrı + URI literal sabit. Future-proof: argüman parametreli yapılırsa enjeksiyon vektörü kapatıldı.
- **`validate_endpoint_dns` (M4)** — yeni async DNS resolve check; OpenAI provider chat path'inde her chat öncesi `tokio::net::lookup_host` ile resolved IP'leri private/loopback/link-local kontrolünden geçirir. DNS rebinding (saldırgan-controlled domain → 127.0.0.1 / 169.254.169.254 IMDS) kapatıldı.
- **AI abort race** — `oneshot::Sender::is_closed()` check + race log; chat tamamlanırken abort gelirse sessiz no-op.
- **AI HTTP body log azaltma** — 4 provider (openai/anthropic/gemini/ollama) hata gövdeleri `tracing::warn` → `tracing::debug` (release log'da prompt/model echo sızıntısı kapatıldı, CWE-532).
- **`redact.ts` regex eşiği 40 → 60 char** — git SHA / hash false-positive'leri azaltıldı, gerçek secret eşikleri (JWT 100+, OAuth 60+) korundu.

### 🛠 Reliability + DX

- **`unreachable!()` → `tracing::error!`** (lib.rs `coalesce_pty_events` 2 yer) — PTY merge bug'ı UI crash yerine küçük merge kaybı + trace log.
- **Sidecar event queue 4096 → 16384** — coalescing window'da burst tolerans, lifecycle event drop riski pratik sıfır.
- **AppShell startup catch'ler silent yutmuyor** — `panes.startListening` kritik olduğu için error seviyesi log.
- **`panes.cleanupPaneState` → `clearGitStatState` defansif lazy-import** — interval multiply riski.
- **`packageManager: pnpm@9.15.0` pin** — CI/dev pnpm tutarsızlığı (`pnpm/action-setup@v6` ile uyumlu explicit version).
- **Vitest coverage config** — v8 provider + threshold (10/10/50/10 baseline; 1.0 yolunda yükseltilecek).
- **Dependabot grouping** — `dependencies` (patch+minor) ve `major` ayrı grup; sidecar major bloke; actions weekly.

### 📚 Dokümantasyon

- **`CODE_OF_CONDUCT.md`** — Contributor Covenant 2.1 (Türkçe).
- **`SECURITY.md`** — tehdit modeli + GitHub Security Advisory bildirim akışı + cryptographic trust notları (DPAPI legacy v1.0'da kaldırılır, updater minisign rollover key v1.0'da).

### 🔧 CI

- `pnpm/action-setup@v6` `version: 9.15.0` explicit pin (eşit `packageManager` ile çakışmasın).
- `cargo fmt --check` + `cargo clippy -- -D warnings` her commit'te zorunlu gate.
- Rust testleri: 81 → **90** (9 yeni ProcessJail testi).

### Bilinen Sınırlar

- **PR#11 vue 3.5.34 patch** — lockfile conflict ile açık kaldı; bu release'in lockfile'ında patch zaten yakalanmış (caret range), dependabot rebase tetiklenince merge olur.
- **DPAPI NULL-entropy fallback** v1.0'a kadar açık (legacy v0.9.3 öncesi blob compat).
- **CSP `style-src 'unsafe-inline'`** — Vue 3 SFC scoped CSS gerektirir; v1.0'da SRI hash veya nonce.

---

## v0.9.5 — 2026-05-09

**Theme polish + race fix.** D-Matrix temasına özel "code rain" intro deneyimi + WelcomePane'in çift `play()` race condition'ı + AppShell title bar düzeltmeleri. v0.9.4 ile tam uyumlu (DB şeması/protokol değişmedi); UI-only sürüm.

### ✨ D-Matrix tema deneyimi

- **`MatrixRain.vue`** — WelcomePane arka planında klasik "code rain" canvas overlay. Per-instance `requestAnimationFrame` + `ResizeObserver`; `prefers-reduced-motion: reduce` ise canvas hiç başlatılmaz (sade siyah). DPR-aware crisp render. `intensity` prop 0..1 (intro 1.0, atmosfer 0.18).
- **Welcome intro akışı** — D-Matrix temasında 1500 ms boyunca SADECE yağmur, sonra yağmur `0.18` atmosfere solar + logo typewriter başlar. Satır reveal'inde her satır için ~250 ms katakana scramble (yarım-genişlik ｱｲｳｴｵ… + sayı), bitince gerçek değer ortaya çıkar. Diğer temalarda davranış değişmez.
- **`welcome--matrix` arka planı** — `rgba(0, 8, 0, 0.92)` solid backdrop ki Mica/transparent vibrancy'de bile yağmur etkisi okunaklı kalsın.

### 🐛 Race condition + tema değişimi

- **`play()` reentrancy guard (`playToken`)** — `onMounted`'de `await refresh()` info'yu set ediyordu, bu da `watch(info, …)` watcher'ını tetikliyor → ikinci `play()` paralel başlıyordu. İkinci `play()`'in `clearTimers()` çağrısı birinci `play()`'in Matrix intro `setTimeout`'unu öldürüyor, birinci `await new Promise(setTimeout(r, 1500))` sonsuza dek askıda kalıyordu. Şimdi token bumplanır; eski play her await'ten sonra `myToken !== playToken` görünce temiz abort olur.
- **`isMatrixTheme` watcher** — default tema → Matrix geçişinde `MatrixRain` `v-if` ile mount olur ama prop'taki `rainIntensity` stale `0` kalıyor (önceki play'in else branch'i set etmişti). Canvas trail fade biriktiriyor ama glyph yok → ekran sadece kararıyordu. Watcher artık tema değişince `play()`'i yeniden çalıştırır, fresh intro akışı.
- **`welcome__hint` z-index** — rain canvas `position: absolute; z-index: 0` static elementlerin üzerine çıkıyordu (CSS stacking context kuralı); hint metni yağmur altında kalıyordu. `position: relative; z-index: 1` ile çözüldü.

### 🎨 AppShell polish

- **Header çift-tık maximize** — Windows native title bar davranışı. `startDragging()` çağrıldıktan sonra `dblclick` event'i WebView'a iletilmiyor (Tauri 2 + Mica kombinasyonu), ayrı `dblclick` handler tetiklenmiyordu. Şimdi `mousedown.detail === 2` ile çift-tık tespit edilir; drag yerine `winToggleMax()` çalışır.
- **Brand shimmer** — `> D-TERMINAL` üzerinde sürekli akan gradient. 3-stop palindrome (`accent → accent2 → accent`) + `background-size: 200% 100%` + `background-position: 0% → -200%` ile seamless tekrar (loop start/end glitch yok). 8 s `linear infinite`. `prefers-reduced-motion` ile otomatik durur (App.vue global rule).

### 🔧 Diğer

- `Cargo.toml` `tauri = { version = "2", features = [] }` — explicit empty feature list (no-op, açıklık için).

## v0.9.4 — 2026-05-09

**Comprehensive hardening release.** 11 paralel ajan ile tüm proje audit'lendi (~210 bulgu); release-blocker güvenlik açıkları + memory leak'leri + WCAG ihlalleri + AI provider eksiklikleri kapatıldı. v0.9.3'te ~7.8/10 olan kalite skoru artık ~9.4/10. 12 atomik commit, 1500+ satır net iyileştirme. Önceki sürümle wire-protokol uyumlu (HELLO handshake geri uyumlu), DB şeması V001'den V002'ye otomatik yükseltir (backup + downgrade guard'lı).

### 🛡 Güvenlik

- **DevTools artık yalnızca debug build'de açık** — release `Cargo.toml` `tauri/devtools` feature kaldırıldı; AppShell `toggleDevTools` `import.meta.env.DEV` gate'inde. XSS post-compromise renderer manipülasyon yüzeyi kapatıldı.
- **Smart link RCE vektörü kapatıldı** — TerminalPane `onPath` UNC path (`\\attacker\share\…`) + executable uzantı (`.exe/.bat/.ps1/.lnk` vs.) reddediyor, fallback clipboard'a kopyalar.
- **`pty_spawn` shell whitelist** (cmd/powershell/pwsh/wsl/bash/git-bash) + cwd UNC reddi + env key blacklist (`PATH/PATHEXT/PSExecutionPolicyPreference/COMSPEC/...`).
- **`dfetch_save_snapshot` path white-list** (Pictures/Desktop/Downloads/Documents/AppData) + `.png` zorunlu + 25MB limit. Startup klasörüne malware yazma vektörü kapatıldı.
- **`log_stream_open` extension whitelist** (.log/.txt/.out/.err/.json/.ndjson/.csv) + UNC reddi. SSH key/credentials exfil vektörü kapatıldı.
- **`git_diff_shortstat` env hardening** — `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=NUL`, `safe.directory=*`, `core.fsmonitor=`, `core.sshCommand=` (CVE-2022-24765 ailesi).
- **`themes_save_user`** 256KB + JSON şema validate.
- **DPAPI entropy katmanı** — `pOptionalEntropy` parametresi ile mimikatz/lsadump diğer-process decrypt vektörü kapatıldı. v0.9.3 öncesi blob'lar otomatik 2-aşamalı fallback ile re-encrypt (kullanıcı yeniden key girmek zorunda değil).
- **AI key Zeroize hijyeni** — `Zeroizing<String>` olarak dolaşıyor (4 ajan onaylı kritik bulgu kapatıldı). DPAPI sistem buffer'ı `LocalFree` öncesi volatile-zero ile siliniyor.
- **Prompt injection guard** — terminal output `<terminal_output>...</terminal_output>` tag'iyle user-role'a sarılıyor.
- **`ai_chat_stream` gerçek abort** — `tokio::select!` + `oneshot` ile chat future drop edilir, reqwest HTTP bağlantısı kapatılır → token harcaması durur (önceden "abort yanılsama").
- **Capability cleanup**: `dialog:allow-save` eklendi (eksikti).

### ⚡ Performans / Bellek

- **Sidecar `events_tx` `sync_channel(4096)`** — unbounded mpsc → backpressure'lı kuyruk (OOM riski kapandı).
- **Reader/stderr/heartbeat thread `JoinHandle`** saklanıyor — sidecar restart'ta thread leak kapatıldı.
- **`Frame::encode` doğrudan stdin'e yazıyor** — heartbeat + her keystroke + her resize için 0 alloc/frame.
- **`SidecarManager::Drop` impl + Tauri `RunEvent::ExitRequested`** — zombi sidecar engelleme.
- **`paneBufferCache`/`agentWatch`/`chats` cleanup** — `closeTab/closePane/loadWorkspace`'te ölü pane state'i siliniyor (~1.5 MB/pane leak).
- **`stores/chats.ts`** yeni store — AI chat mesajları per-pane Pinia store'da; pane unmount'ta brainstorm konuşması kaybolmuyor.
- **`agentWatch.paneView/paneSummary` memoize** — 60 FPS × pane sayısı gereksiz allocation durdu.
- **`dfetch_get` `async` + `tokio::spawn_blocking`** — Tauri main thread'i bloklanmıyor.
- **`detect_battery` 5s TTL cache** — WMI thread spawn churn'u durdu.
- **AI providers idle timeout (60s/chunk)** — yarım kalmış HTTP/2 stream Tauri runtime'i tutamaz.
- **AI providers retry/backoff** — 429/503 için `Retry-After` aware exponential backoff.
- **AI exact token sink** — Anthropic `message_delta`, OpenAI `stream_options.include_usage`, Ollama `done` frame; Türkçe morfoloji estimate %30 underestimate kapatıldı.
- **Font payload 4.1 MB → ~600 KB initial** — 17 font lazy load.
- **AppShell mount sequential await → `Promise.all`** — 5 store paralel (300-500ms kazanç).
- **9 AI provider eager → dynamic import** + **33 locale raw lazy**.
- **Settings auto-persist watch** O(N²) → per-field watch.
- **xterm scrollback 10000 → 5000 settings-driven**.
- **`secrets.get_blob` non-atomic** SELECT+UPDATE → tek transaction.
- **Sidecar `BufReader` 8KB → 64KB**.

### ♿ Erişilebilirlik (WCAG)

- **`:focus-visible` global outline** (WCAG 2.4.7).
- **`prefers-reduced-motion` global** (WCAG 2.3.3).
- **D-Dark `--color-dim`** `#5a6478` (3.97:1) → `#7a8290` (5.0:1) — WCAG AA pass.
- HistoryModal icon-only butonlara `aria-label`, AIChatPane `aria-live="polite"`.
- 6 modal `window.confirm()` → Tauri native `dialog.ask()`.
- SplitContainer drag `pointercancel` + `blur` listener leak fix.
- SettingsModal `captureShortcutKey` listener leak fix.

### 🌐 i18n

- **`fallbackLocale: 'tr'` → `'en'`** (industry-standard).
- **WelcomePane 21 hardcoded label** → `t('dfetch.*')` namespace; en/tr 17 yeni anahtar.
- **5 plural rule** (vue-i18n pipe syntax) — `1 results` gramer hatası kapandı.
- AboutModal Copyright dinamik yıl. Türkçe error literal'leri i18n key'lere taşındı.

### 💾 Storage

- **V002 migration** — 5 yeni index + `history_fts` FTS5 + 3 trigger.
- **`_app_version` downgrade guard** — eski binary yeni şemayı açamaz.
- **Migration öncesi otomatik backup** (`VACUUM INTO`, son 5 yedek tutulur).
- **`mmap_size` 256MB → 64MB**, **`busy_timeout: 5s`**.
- **`HistoryRepo::add_bulk`** — psreadline 5000 satır 30sn → <1sn.

### 🔌 AI Providers

- Gerçek streaming abort, idle timeout, retry/backoff, exact token usage.
- Pricing tablosu: o3, o3-mini, o4-mini, Gemini 2.5 Flash eklendi.
- `temperature/max_tokens: null` body'den çıkarıldı.

### 🧩 Sidecar

- **HELLO handshake** — sidecar boot'ta `HelloPayload` (protocol_version + sidecar_version + capabilities); uyumsuzlukta SidecarDown.
- `MsgType::Hello = 0x00`.
- **`kill_pane` semantik fix** — pane EXIT frame ile silinir.

### 🧪 Test (33 → 160)

- **Rust 81 test** (+48): pty validation, DPAPI, migrations, history, secrets, snippets, coalesce stress, error.
- **Frontend vitest 64 test** (+64): redact, keybindings, dialog, useGitStat, chats, aiPricing. CI `passWithNoTests: false`.
- **Sidecar 15 test** (eski).

### 🛠 Build / CI

- **Rust ARM64 matrix** + yeni **`audit` job** (cargo-audit RustSec).
- **`.github/dependabot.yml`** — npm/cargo/actions otomatik PR.
- `vue/no-v-html: error`. `.gitattributes`. `src-tauri/about.toml` (cargo-about). `bundle.publisher` + 7 ikon. `.githooks/pre-commit` + `scripts/setup-hooks.ps1`.

### 📥 İndirme

İndirme bilgileri release pipeline tarafından doldurulacak — bkz. GitHub Releases sayfası.

---

## v0.9.3 — 2026-05-08

**Critical patch release.** v0.9.2'de v0.1.1'den upgrade eden kullanicilarda startup panic atiyordu (refinery V001 checksum mismatch). Bu sürüm bunu fix eder + ikon Win11 squircle mask uyumu için padding eklenir.

### 🐛 Düzeltmeler

- **Migration tolerance** (`storage/migrations.rs`): `runner().set_abort_divergent(false)` eklendi. Refinery 0.8.16 embed_migrations checksum'i derleme ortamı nuance'ı yüzünden tutarsız çıkabiliyordu — strict mode panic atıp app'i çökertiyordu. Tolerant mode warning logla, app çalışmaya devam eder. Migration disiplini değişmedi: V001 dokunulmaz, yeni şemalar V002+ olarak.
- **İkon safe-area padding** (~%15): Source ikon full bleed'di → Win11 squircle mask kenarlardan kesiyordu, dış rounded frame kayboluyordu. 1024×1024 transparent canvas üzerinde %85 boyutta merkezlendi (her kenardan 76px = ~%7.5 safe area, toplam ~%15 margin).
- **CI fmt**: `cargo fmt` builder chain whitespace fix.

### 📥 İndirme

| Dosya | Boyut | SHA-256 |
|---|---|---|
| `D-Terminal_0.9.3_x64_tr-TR.msi` | 39.38 MB | `51a89d518300a3f917343bdd0843aacc367d8503ee8b107fb8e02d50fb0679d2` |
| `D-Terminal_0.9.3_x64_en-US.msi` | 39.38 MB | `872826a66270d5acf02014fc2cdc6fb2d54b468cf2763b7e4ca7556d4132838a` |
| `D-Terminal_0.9.3_x64-setup.exe` | 26.17 MB | `b991d1355d425e9734f3e86216bd1c382bde3b05dc54c199ac39a3836f157094` |
| `D-Terminal_0.9.3_arm64_tr-TR.msi` | 37.19 MB | `fccac462bb30ef423cd36f1430923d3682fbd6c7c0781405ba4e904ef77cc166` |
| `D-Terminal_0.9.3_arm64_en-US.msi` | 37.19 MB | `27ab12050c85272c5642160af6eece7df6598a51bc17ddeb4deaf87c6431a1a5` |
| `D-Terminal_0.9.3_arm64-setup.exe` | 24.00 MB | `b7510906be78d42ca7856a235a81b35683e9b5d900ab10c8e1aee1d6a895a7c0` |

Her installer için yanında `.sig` (minisign updater imzası) dosyası ve `latest.json` updater manifest'i release'de.

### 🛡 Güvenlik / VirusTotal taraması (2026-05-08)

#### aarch64 (ARM64)

| Dosya | Skor | Yorum |
|---|---|---|
| TR MSI | **0/60** ✅ ([VT](https://www.virustotal.com/gui/file/fccac462bb30ef423cd36f1430923d3682fbd6c7c0781405ba4e904ef77cc166)) | Tamamen clean — 0 detection |
| EN MSI | **0/60** ✅ ([VT](https://www.virustotal.com/gui/file/27ab12050c85272c5642160af6eece7df6598a51bc17ddeb4deaf87c6431a1a5)) | Tamamen clean — 0 detection |
| NSIS setup | **1/70** ([VT](https://www.virustotal.com/gui/file/b7510906be78d42ca7856a235a81b35683e9b5d900ab10c8e1aee1d6a895a7c0)) | Sadece Sophos `Generic ML PUA` — unsigned NSIS tipik |

#### x86_64 (x64)

| Dosya | Skor | Yorum |
|---|---|---|
| TR MSI | **3/60** ([VT](https://www.virustotal.com/gui/file/51a89d518300a3f917343bdd0843aacc367d8503ee8b107fb8e02d50fb0679d2)) | Antiy-AVL `Trojan/Win32.Agent` + K7GW `Spyware` + Rising `Spyware.Agent!8.C6` — generic ML false positive |
| EN MSI | **2/60** ([VT](https://www.virustotal.com/gui/file/872826a66270d5acf02014fc2cdc6fb2d54b468cf2763b7e4ca7556d4132838a)) | Antiy-AVL + K7GW (v0.9.2'ye göre Rising/Zillya düştü) |
| NSIS setup | **4/71** ([VT](https://www.virustotal.com/gui/file/b991d1355d425e9734f3e86216bd1c382bde3b05dc54c199ac39a3836f157094)) | K7GW + **Microsoft `Trojan:Win32/Wacatac.B!ml`** + Sophos `Generic ML PUA` + VirIT — Wacatac generic false positive (NSIS+native module pattern) |

**Tüm major engine'ler temiz (MSI'lar için)**: Microsoft Defender, Kaspersky, BitDefender, ESET-NOD32, Sophos, Avast, AVG, McAfee, Symantec, Trend Micro, Fortinet, GData, Malwarebytes, Avira, Panda, Emsisoft, CrowdStrike Falcon.

> ⚠️ **Microsoft Defender NSIS'i flagged**: `Trojan:Win32/Wacatac.B!ml` — bu generic ML imzası imzasız NSIS uygulamalarında klasik false positive. Code signing geldiğinde (SignPath FOSS sürecinde) düşer. **MSI installer'ları (Defender clean) önerilir**; NSIS kullanacaksan kullanıcı VT'de "false positive report" submit edebilir.

ARM64 NSIS yine 1/70, ARM64 MSI'lar 0/60 — pattern v0.9.2 ile aynı (ARM64 binary structure x64 ML modellerin training set'inde az temsil ediliyor).

Code signing eksik — Windows SmartScreen "Bilinmeyen yayıncı" uyarısı verir, "Yine de çalıştır" ile devam edilir. Sertifika sonrası bu kalkar.

### 🆙 Upgrade notu (v0.1.1 → v0.9.3 doğrudan)

v0.9.2 broken'dı; v0.1.1 kullanıcıları **doğrudan v0.9.3'e** geçer. Migration tolerance fix'iyle eski DB sorunsuz upgrade olur. Manuel DB silmeye gerek yok.

> ⚠️ Pubkey değişti (önceki v0.1.1 → v0.9.3): otomatik updater zinciri bu sürüm geçişinde **manuel** indirme ile çalışır. v0.9.3 → v0.9.4+ otomatik olur.

---

## v0.9.2 — 2026-05-08

D-Terminal'in v0.1.1'den bu yana ilk yayını — **v0.9.x serisi** kapsamında mimari ve UX olarak baştan sona şekillenmiş bir release. CI build matrix (x64 + ARM64), imzalı installer + auto-updater, bilingual TR/EN README, yeni D-Terminal ikon seti.

### 🆕 v0.9.x Yenilikleri

- 🪟 **Frameless pencere** — özel başlık çubuğu, popover komut paleti, native min/max/close (Tauri 2 capabilities izinleri ile).
- 🤖 **AI Agent Watch** — pane başına AI tool-kullanım gözlemcisi, OSC 9999 protokolü, canlı maliyet rozeti, "waiting / running / interrupted" durumları, Claude Code paralel batch parser, otomatik split + heuristik tespit.
- 🔄 **Merkezi güncelleme sistemi** — 3 mod (silent / passive / full UI), ARM/x64 dual-arch updater'da entegre. `latest.json` + minisign `.sig` dosyaları release'de.
- 📊 **Canlı DFetch** — gerçek zamanlı sistem istatistikleri (CPU/RAM/disk), broadcast UX, snapshot, tema-uyumlu overlay.
- 🔢 **Pane başına git diff +/- chip** — pane başlığında değişen satır sayısı (OSC 7 cwd + `git shortstat`).
- 🤖 **5 yerel AI runtime** — Ollama, LM Studio, Jan, Text Generation WebUI, Llama.cpp server + esnek özel endpoint sağlayıcısı (OpenAI-uyumlu).
- 🏠 **Home dir başlangıç + welcome banner** — D-T logosu, sürüm rozeti, TR locale paneli.
- 📋 **Çok satırlı yapıştırma** — bracketed paste modu + satır sayısı toast'u.
- ⚡ **Performans** — IPC coalescing, BlockTracker output truncation.
- 💖 **GitHub Sponsors entegrasyonu** — 4 tier perk altyapısı, issue/PR template'lerinde sponsor link.
- 🔐 **Güvenlik & a11y audit** — FAZ A/B fixleri uygulandı (M7/M8 kritik), a11y composable.

### 🎨 Yeni ikon seti

DT lettering, terminal pencere şekli, mavi gradient — `pnpm tauri icon` ile 50+ asset (Tauri PNG/ICO/ICNS, Windows tile, iOS AppIcon, Android mipmap) yeniden üretildi. Kaynak: 1024×1024 kare appstore ikonu.

### 📝 Bilingual README

Türkçe ana metin + her bölümün altında `<details>` collapsible İngilizce versiyon. Mobilde sıkışmayan layout. Hero demo videosu (`docs/media/d-terminal-showcase.mp4`).

### 🔑 Güncelleyici (Updater) altyapısı

- **Yeni Tauri minisign keypair** (önceki şifreli key kayıp; yeni key şifresiz)
  - Public key ID: `6F3DE74919BAAEA3`
  - `tauri.conf.json` `plugins.updater.pubkey` güncellendi
- `bundle.createUpdaterArtifacts: true` flag'i eklendi (Tauri 2'de explicit gerekli — Tauri 1'de varsayılandı)
- CI release.yml'da TAURI_SIGNING_PRIVATE_KEY env üzerinden imzalama
- ⚠️ **Eski v0.1.1 kurulumlarından otomatik geçiş yok** — pubkey değişti, manuel indirme gerekir. Aktif kullanıcı sayısı az olduğu için kabul edildi.

### 📥 İndirme

| Dosya | Boyut | SHA-256 |
|---|---|---|
| `D-Terminal_0.9.2_x64_tr-TR.msi` | 39.32 MB | `f58cabb3e3ee07f4686659e1cbc639ddde9e7fd942501a48edf11f279646475f` |
| `D-Terminal_0.9.2_x64_en-US.msi` | 39.32 MB | `6a4084c57f632c8a93d97a9fa2a5fe37251ecd20d49daff6cb45e5fc649c6109` |
| `D-Terminal_0.9.2_x64-setup.exe` | 26.14 MB | `ee7cac9f1aaecd6b261c962cae9823004fcda316a5d9c0e699f43fc6ce64cf61` |
| `D-Terminal_0.9.2_arm64_tr-TR.msi` | 37.13 MB | `f1723d17d686c9030be6e57788d8029656c99257b8164b1924b5da2f1685957d` |
| `D-Terminal_0.9.2_arm64_en-US.msi` | 37.13 MB | `f9f0ac4ed693dc4aa574f120d7063682795a0f5b8f50f27fef5908ec7ec0bd8a` |
| `D-Terminal_0.9.2_arm64-setup.exe` | 23.97 MB | `ac062d1694ccba4ea4fb187f5996a4754da5bc919c5ff229e6b42ded393de113` |

Her installer için yanında `.sig` (minisign updater imzası) dosyası ve toplu `latest.json` updater manifest'i release'de.

### 🛡 Güvenlik / VirusTotal taraması (2026-05-08)

#### aarch64 (ARM64)

| Dosya | Skor | Yorum |
|---|---|---|
| TR MSI | **0/59** ✅ ([VT](https://www.virustotal.com/gui/file/f1723d17d686c9030be6e57788d8029656c99257b8164b1924b5da2f1685957d)) | Tamamen clean — 0 detection |
| EN MSI | **0/59** ✅ ([VT](https://www.virustotal.com/gui/file/f9f0ac4ed693dc4aa574f120d7063682795a0f5b8f50f27fef5908ec7ec0bd8a)) | Tamamen clean — 0 detection |
| NSIS setup | **1/70** ([VT](https://www.virustotal.com/gui/file/ac062d1694ccba4ea4fb187f5996a4754da5bc919c5ff229e6b42ded393de113)) | Sophos `Generic ML PUA` — unsigned NSIS tipik |

#### x86_64 (x64)

| Dosya | Skor | Yorum |
|---|---|---|
| TR MSI | **3/59** ([VT](https://www.virustotal.com/gui/file/f58cabb3e3ee07f4686659e1cbc639ddde9e7fd942501a48edf11f279646475f)) | Antiy-AVL `Trojan/Win32.Agent` + K7GW `Spyware` + Rising `Spyware.Agent!8.C6` — generic ML false positive |
| EN MSI | **4/59** ([VT](https://www.virustotal.com/gui/file/6a4084c57f632c8a93d97a9fa2a5fe37251ecd20d49daff6cb45e5fc649c6109)) | Aynı 3 + Zillya `Trojan.DiscoStealer.Win32.236` |
| NSIS setup | **3/69** ([VT](https://www.virustotal.com/gui/file/ee7cac9f1aaecd6b261c962cae9823004fcda316a5d9c0e699f43fc6ce64cf61)) | K7GW + Sophos `Generic ML PUA` + VirIT `Trojan.Win64.GenX.JMO` |

**Tüm major engine'ler temiz**: Microsoft Defender, Kaspersky, BitDefender, ESET-NOD32, Sophos (x64 MSI), Avast, AVG, McAfee, Symantec, Trend Micro, Fortinet, GData, Malwarebytes, Avira, Panda, Emsisoft, CrowdStrike Falcon, Acronis Static ML.

ARM64 MSI'lar **sıfır flag** aldı (v0.1.1 ile aynı pattern — ARM64 binary structure'ı x64 ML modellerinin training set'inde daha az temsil ediliyor). x64 tarafında flag sayısı v0.1.1'e göre 1 motor arttı (K7GW yeni, Sophos x64 MSI'de düştü).

Code signing eksik (SignPath FOSS başvurusu sürecinde) — Windows SmartScreen "Bilinmeyen yayıncı" uyarısı verir, "Yine de çalıştır" ile devam edilir. Sertifika sonrası uyarı kalkar, ML false positive'lerin neredeyse hepsi de düşer.

### 🤖 CI/CD altyapısı

- **Otomatik VT + HA tarama** — `release.yml` build sonrası `security-scan` job'u eklendi: SHA-256 hesaplar, VT/HA submit eder, GitHub Step Summary'ye dosya bazlı tablo yazar (rate limit: 20s/dosya).
- **Manuel scan workflow** — `scan-release.yml` ile mevcut bir release'i rebuild etmeden taratabilirsin (workflow_dispatch + tag input).

### 🆙 Sistem gereksinimleri

- Windows 10 1809 (ConPTY için) veya Windows 11
- ~80 MB RAM, ~50 MB disk
- WebView2 runtime (Win11'de yerleşik, Win10'da ilk kurulumda otomatik)
- Node.js gerekli **DEĞİL** (v0.1.1'den beri sidecar bundle ile)

---

## v0.1.1 — 2026-05-04

İkinci pre-alpha sürüm. v0.1.0-alpha'da yayınlanan kritik bug'lar düzeltildi, Gemini 2.5 code review'undan gelen 10 önerinin tamamı uygulandı, ARM64 desteği + UAC elevation eklendi.

### 🚀 Sidecar Node.js bağımsızlığı
- Sidecar `@yao-pkg/pkg` ile tek `dterminal-pty-bridge.exe` (Node 20 runtime gömülü, ~110 MB) → **kullanıcıda Node.js gereksiz**.
- Bootstrap: `process.pkg` ise snapshot'tan native binding'leri (`pty.node`, `conpty.node`, `conpty.dll`, `OpenConsole.exe`) `%TEMP%\dterminal-pty-bridge-natives\` altına extract eder, `Module._resolveFilename` patch'i ile yönlendirir.
- `tauri.conf.json` `bundle.externalBin` yapılandırması ile sidecar `d-terminal.exe` yanına otomatik yerleştirilir.
- Rust spawn'ında `CREATE_NO_WINDOW` flag'i — ekstra console penceresi sorunu çözüldü.

### 🪟 Pane sistemi iyileştirmeleri (Gemini feedback)
- **Drag-rearrange**: pane title bar'ını yakala, başka pane'in 4 kenarından (sol/sağ/üst/alt) birine bırak → otomatik split + ağaç restructure. Görsel drop-zone vurgu.
- **Inline rename**: tab ve pane başlığına çift tık → modal yok, yerinde input. Enter kaydet, Esc iptal.
- **Grup tag'leri (renkli rozetler)**: pane title bar'ındaki `#` butonuna tıkla, grup adı yaz. Aynı etiketteki pane'ler otomatik **aynı renkte** (8 renkli palet, hash tabanlı).
- **Resize stabilizasyonu**: ResizeObserver + PTY resize IPC debounce → divider sürüklerken metin kesilmesi ve prompt duplikasyonu yok.
- **Workspace v2 schema**: tüm tab'lar + profileId + tag birlikte serialize. SessionModal'da "Workspace olarak kaydet" toggle.

### 🛡 Yönetici (UAC) yetkisi
- Settings → Genel → "Yönetici olarak yeniden başlat" butonu — UAC prompt'u → uygulama relaunch.
- Header'da admin durumunda 🛡 **ADMIN** rozeti (kırmızı).
- Sudo guide: Win 11 23H2+ için Settings → For developers deep-link, Win 10 için gsudo install komutu kopyalama.

### ⌨ Yeni klavye özellikleri
- **Tmux-style prefix mode** (Settings → Görünüm): konfig'lenebilir combo (default `Ctrl+B`) → 1sn modal pencere → `V/H/Z/X/N/P/T/W/S/O` action tetikle.
- **Scrollback navigation mode** (`Ctrl+Shift+Space`): j/k/g/G/u/d ile gez, y selection kopyala, / search aç, Esc çık. PTY input bloklanır.
- **xterm screen reader modu** (Settings → Görünüm): NVDA/Narrator için aria-live bölge.

### 📦 Yeni özellikler
- **Frecency autocomplete**: Mozilla URL bar tarzı `frequency × exp(-ageHours/168) × favoriteBonus` skorlama. Sık+yeni komutlar üst sıraya.
- **Config as Code**: TOML dotfile (`%APPDATA%\D-Terminal\config.toml`) import/export. Settings → Genel → küçük ghost butonlar. Hot-reload v1.0.5'te.
- **Tema paketleri prod build'de çalışır**: `_up_/themes/` Tauri glob notation path resolution düzeltildi.

### 🏗 Mimari
- **ADR-0005**: WebAssembly plugin runtime kararı — v1.1+ için extism + wasmtime, ADR-0004'ün Web Worker'ından geçiş planı.
- **Rust unit tests**: 16 test (4 protocol + 4 error + 3 themes + 5 mevcut). CI fmt + clippy + test üçü de geçiyor.

### 📦 Akıllı installer
- NSIS pre-install hook (`taskkill /F /IM`) açık D-Terminal süreçlerini sessizce sonlandırır → "dosya yazılırken hata" diyalogu kalktı.
- Version bump (0.1.0 → 0.1.1) → MSI/NSIS auto-upgrade tetiklenir, eski sürüm otomatik kaldırılır, kullanıcı verisi korunur.

### 📥 İndirme

| Dosya | Boyut | SHA-256 |
|---|---|---|
| `D-Terminal_0.1.1_x64_tr-TR.msi` | 39.90 MB | `c82bc54c4b18e0efa6f4cf4a323d51cbec8965617b3c95ec004c47b42a271a06` |
| `D-Terminal_0.1.1_x64_en-US.msi` | 39.89 MB | `4b75ea036cf61201a6fea40adb151a044fc69bcae35a73a09aca17d2ec64f3ad` |
| `D-Terminal_0.1.1_x64-setup.exe` | 25.96 MB | `62bad45a2202729be9e8e29999258677b4008d84f3cf1c3c2565cce762380c76` |
| `D-Terminal_0.1.1_arm64_tr-TR.msi` | 36.87 MB | `13ec82c543a05e48d897a1735582264a3af97d89694799dc8d9eb8751992afec` |
| `D-Terminal_0.1.1_arm64_en-US.msi` | 36.86 MB | `11a371cb957821567cbd4abed1cdcac60cef06d166778300b95902a0b11b8feb` |
| `D-Terminal_0.1.1_arm64-setup.exe` | 23.80 MB | `ef7edc19b301adf61ca8e0f80e3c5980883b537f8f939a0bf993a177c4c6b927` |

> Boyut artışı önceki ~22 MB → 40 MB Node 20 runtime'ın bundle'a gömülmesinden kaynaklanır. Karşılığında **kullanıcıda Node.js gereksinim KALKMIŞ**.

### 🛡 Güvenlik / VirusTotal taraması (2026-05-04)

#### x86_64 (x64)
| Dosya | Skor | Yorum |
|---|---|---|
| TR MSI | **2/57** ([VT](https://www.virustotal.com/gui/file/c82bc54c4b18e0efa6f4cf4a323d51cbec8965617b3c95ec004c47b42a271a06)) ([HA](https://hybrid-analysis.com/sample/c82bc54c4b18e0efa6f4cf4a323d51cbec8965617b3c95ec004c47b42a271a06)) | Antiy-AVL `Trojan/Win32.Agent` + Rising `Spyware.Agent!8.C6` (RDMK) — generic ML false positive |
| EN MSI | **2/58** ([VT](https://www.virustotal.com/gui/file/4b75ea036cf61201a6fea40adb151a044fc69bcae35a73a09aca17d2ec64f3ad)) ([HA](https://hybrid-analysis.com/sample/4b75ea036cf61201a6fea40adb151a044fc69bcae35a73a09aca17d2ec64f3ad)) | Aynı 2 motor |
| NSIS setup | **2/70** ([VT](https://www.virustotal.com/gui/file/62bad45a2202729be9e8e29999258677b4008d84f3cf1c3c2565cce762380c76)) ([HA](https://hybrid-analysis.com/sample/62bad45a2202729be9e8e29999258677b4008d84f3cf1c3c2565cce762380c76)) | Sophos `Generic ML PUA` + VirIT `Trojan.Win64.GenX.JMO` — unsigned NSIS tipik flag |

#### aarch64 (ARM64)
| Dosya | Skor | Yorum |
|---|---|---|
| TR MSI | **0/57** ✅ ([VT](https://www.virustotal.com/gui/file/13ec82c543a05e48d897a1735582264a3af97d89694799dc8d9eb8751992afec)) ([HA](https://hybrid-analysis.com/sample/13ec82c543a05e48d897a1735582264a3af97d89694799dc8d9eb8751992afec)) | Tamamen clean — 0 detection |
| EN MSI | **0/57** ✅ ([VT](https://www.virustotal.com/gui/file/11a371cb957821567cbd4abed1cdcac60cef06d166778300b95902a0b11b8feb)) ([HA](https://hybrid-analysis.com/sample/11a371cb957821567cbd4abed1cdcac60cef06d166778300b95902a0b11b8feb)) | Tamamen clean — 0 detection |
| NSIS setup | **1/70** ([VT](https://www.virustotal.com/gui/file/ef7edc19b301adf61ca8e0f80e3c5980883b537f8f939a0bf993a177c4c6b927)) ([HA](https://hybrid-analysis.com/sample/ef7edc19b301adf61ca8e0f80e3c5980883b537f8f939a0bf993a177c4c6b927)) | Sadece Sophos `Generic ML PUA` — unsigned NSIS tipik |

**Tüm major engine'ler temiz**: Microsoft Defender, Kaspersky, BitDefender, ESET, Symantec, McAfee, CrowdStrike, Trend Micro, Fortinet, GData, Avast, AVG, Malwarebytes, Avira, Panda, Emsisoft. Hybrid Analysis MetaDefender Multi-Scan: **Clean (0 detection) — 6/6 dosya**.

ARM64 MSI'lar **sıfır flag** aldı çünkü ARM64 binary structure'ı x64 ML modellerinin training set'inde daha az temsil ediliyor — false positive tetikleyen imzalar yok.

Code signing eksik (SignPath FOSS başvurusu sürecinde) — Windows SmartScreen "Bilinmeyen yayıncı" uyarısı verir, "Yine de çalıştır" ile devam edilir. Sertifika sonrası uyarı kalkar, yukarıdaki ML false positive'lerin neredeyse hepsi de düşer.

### 🆙 Sistem gereksinimleri
- Windows 10 1809 (ConPTY için) veya Windows 11
- ~80 MB RAM, ~50 MB disk
- WebView2 runtime (Win11'de yerleşik, Win10'da ilk kurulumda otomatik)
- **Node.js gerekli DEĞİL** (v0.1.0'dan farklı olarak)

---

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
| `D-Terminal_0.1.0_x64_tr-TR.msi` | 22.3 MB | Türkçe installer (önerilen) |
| `D-Terminal_0.1.0_x64_en-US.msi` | 22.3 MB | English installer |
| `D-Terminal_0.1.0_x64-setup.exe` | 14.5 MB | NSIS — TR/EN dil seçici, tek installer |
| `d-terminal.exe` | 12.4 MB | Standalone (portable, sidecar dosyaları ayrı gerek) |

> **Sistem gereksinimi**: Kullanıcının PATH'inde **Node.js** olmalı (sidecar PTY köprüsü için). v1.0.5'te `pkg`/`nexe` ile native exe'ye derlenip Node bağımlılığı kalkacak.

**SHA-256 doğrulama** (PowerShell):
```powershell
Get-FileHash D-Terminal_0.1.0_x64_tr-TR.msi -Algorithm SHA256
```

| Dosya | SHA-256 |
|---|---|
| `*_x64_en-US.msi` | `d9fcb64dc23239c74979ce88c5a4e80ec834f6a19973827b4f9384152d498e09` |
| `*_x64_tr-TR.msi` | `977e6ab9e7f9c5abbc24edc5213c7dffa3c4d7119a498f35267b787c3161e5d4` |
| `*_x64-setup.exe` | `6d4fc8db94ead742c91ff760265a4dcd86ae5ef29f0cb6a424c1e73999effea2` |
| `d-terminal.exe` | `dde9c8c37ef56d59041cf86ab3f49e3a03ef23e3fa4c6e2b441a9b587946ce61` |

> ⚠️ Eski VirusTotal taraması (aşağıda) ilk build içindi. Sidecar bundle ile yeniden taramak gerekir — node_modules native binary'leri ek tetikleyici olabilir.

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
