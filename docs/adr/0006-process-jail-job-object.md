# ADR-0006: ProcessJail (Windows Job Object) Mimarisi

**Status**: Accepted
**Date**: 2026-05-10
**Author**: Orhan Engin OKAY

## Context

D-Terminal v0.9.5'e kadar spawn edilen child process'ler (sidecar
`dterminal-pty-bridge.exe` + `commands::git_stat`'ın `git` çağrıları)
iki ayrı problem üretiyordu:

1. **Console window flash'ları** — Windows'ta her child process default
   olarak yeni bir `conhost.exe` console penceresi açar. Kısa süreli
   "DOS pencere flash'ları" kullanıcı tarafından raporlandı (tipik agent
   senaryolarında saniyede birden fazla spawn → görsel rahatsızlık).

2. **Zombie process riski** — D-Terminal abrupt kapanırsa (taskkill
   /f, kernel panic, OS shutdown) sidecar 15s heartbeat timeout'a kadar
   yaşıyordu. node-pty grandchild'ları (kullanıcının PowerShell session'ı)
   da orphan kalabiliyordu. Drop impl + `RunEvent::ExitRequested` handler
   normal kapanışı kapsıyordu ama exception path'leri kapsamıyordu.

3. **Spawn-time policy fragmentation** — her spawn site'ı manuel
   `CREATE_NO_WINDOW` flag'i set ediyordu (sidecar/manager.rs); yeni
   eklenen spawn'lar bunu unutabiliyordu. Tek bir policy noktası gerekti.

## Decision

**Anonymous Windows Job Object kullan; spawn'ları `configure_command()`
helper'ı + `assign(child)` ile Job'a kayıt et.** Job
`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` ile yaratılır — handle close edilince
tüm üye process'ler kernel tarafından otomatik terminate edilir.

### Mimari

```
ProcessJail (Arc<Self>)
├── suppress: AtomicBool (runtime toggle)
└── job: Mutex<Option<JobHandle>>  // Drop'ta CloseHandle

configure_command(&mut Command):
  if suppress: cmd.creation_flags(CREATE_NO_WINDOW = 0x0800_0000)

assign(&Child):
  AssignProcessToJobObject(job, child.as_raw_handle())
  → kill-on-close inheritance
```

### Spawn site entegrasyonu

| Site | Configure | Assign |
|---|---|---|
| `sidecar/manager.rs ensure_started` | ✓ | ✓ |
| `commands/git_stat.rs run_git_diff` | ✓ | — (kısa ömürlü) |
| `commands/git_stat.rs collect_untracked` | ✓ | — (kısa ömürlü) |

Kısa ömürlü (sub-saniye) git child'ları assign edilmez — overhead'in
faydası yok; kapanış zaten otomatik. Uzun ömürlü (sidecar) assign edilir.

### Runtime toggle

`process_set_suppress_consoles(val: bool)` Tauri command'ı `AtomicBool`
flip eder. UI Settings → "Gizlilik & Performans" → checkbox. Değişiklik
sonraki spawn'lara uygulanır (mevcut child'lar etkilenmez — doğru
davranış: jail stateful tracker değil, spawn-time policy).

## Consequences

### Olumlu

- DOS pencere flash'ları kullanıcı görüş alanından kalktı.
- D-Terminal crash'inde sidecar + grandchild'lar (PowerShell, npm, vb.)
  kernel tarafından **garantili** temizlenir. Heartbeat timeout artık
  fallback (graceful degradation) — primary değil.
- Yeni spawn site'larında policy unutmamak için tek noktadan helper.
  PR template'de reminder var.
- Cross-platform: macOS/Linux'ta `#[cfg(not(windows))]` no-op (zaten
  console window kavramı yok).

### Olumsuz / Kabul edilen tradeoff'lar

- **Job creation fail riski** — Win32 quota exhaustion (extreme rare,
  per-user limit ~1024 anonymous job). Bu durumda graceful degradation:
  `configure_command` yine `CREATE_NO_WINDOW` ekler, `assign()` no-op
  döner. Heartbeat 15s timeout fallback olarak kalır.
- **Tek Job per process** — D-Terminal kendi root'unu Job'a koyamaz
  (zaten başka bir job içindeyse iç içe geçemez). Yalnızca child'ları
  yönetir; D-Terminal'in kendisini parent process kapatırsa bu Job
  effect etmez.
- **Runtime toggle mevcut child'ları etkilemez** — kullanıcı toggle
  flip ederse zaten çalışan sidecar Job'da kalır; sadece bir sonraki
  ensure_started yeni spawn'da farklı davranır. Bu **kabul edilen**
  davranış (alternatif: tüm child'ları yeniden başlat = invasive).

### Risk azaltma

- `configure_command` idempotent — duplicate çağrı zarar vermez.
- `assign()` Result döner — hata durumunda warn log + spawn yine de
  yaşar (yalnızca kill-on-close garantisi kaybolur, heartbeat fallback
  devreye girer).
- 9 unit test (`process_jail.rs::tests`) — yaratım, idempotency,
  Arc clone state share, Windows Job creation, gerçek `cmd.exe` spawn +
  assign, child exit race senaryosu.

## Alternatifler

### A. Per-spawn `CREATE_NO_WINDOW` only (no Job)

Her `Command::new` sonrasında manuel `cmd.creation_flags(0x0800_0000)`.

- ✗ Yeni site eklendiğinde kolayca unutulur.
- ✗ Kill-on-close yok (zombie riski devam eder).
- ✓ En düşük complexity.

**Reddedildi:** kill-on-close olmadan v0.9.x agent senaryolarında orphan
sidecar problemi devam ederdi.

### B. Win32 AppContainer / SetProcessMitigationPolicy

Tam security sandbox (network ACL, registry write disable, dynamic code
disable).

- ✗ Build sürecini ciddi şekilde değiştirir (manifest, package identity).
- ✗ Tauri 2 + WebView2 + node-pty zincirinde uyumluluk belirsiz.
- ✗ Bu sürümün hedeflediği problem (window flash + kill-on-close)
  AppContainer'a göre çok dar.

**Reddedildi:** scope creep + Tauri/node-pty entegrasyon riski. v1.0+
gelecek karar.

### C. Process group (`CREATE_NEW_PROCESS_GROUP`) + manual kill loop

Spawn'lar yeni process group'a alınır; D-Terminal exit'te
`GenerateConsoleCtrlEvent` ile group'a CTRL_BREAK gönderir.

- ✗ CTRL_BREAK GUI app'te (D-Terminal Tauri WebView) yok.
- ✗ Abrupt kill (taskkill /f) durumunda gönderilmez — primary problemi
  çözmez.
- ✗ Manual cleanup kodu kompleks + race-prone.

**Reddedildi:** Job Object kernel-level garanti veriyor; manual loop'tan
daha sağlam.

### D. Tauri sidecar plugin'i

Tauri'nin kendi `tauri-plugin-shell` ile sidecar yönetimi.

- ✗ Plugin'in console window suppression API'si yok (default davranış
  console flash).
- ✗ Job Object membership kontrolü yok.
- ✗ Manuel manager (`sidecar/manager.rs`) zaten daha esnek (multipane,
  HELLO handshake, length-prefixed binary frame).

**Reddedildi:** mevcut manager Job Object'le entegre edildi; plugin
geçişi için somut fayda yok.

## Referanslar

- ADR-0001 PTY Sidecar IPC Protocol — superseded heartbeat-only zombie
  detection (v0.9.5'e kadar primary, v0.9.6+ fallback).
- Microsoft Docs: [Job Objects](https://learn.microsoft.com/windows/win32/procthread/job-objects)
- Microsoft Docs: [JOBOBJECT_EXTENDED_LIMIT_INFORMATION](https://learn.microsoft.com/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)
- Microsoft Docs: [CREATE_NO_WINDOW process creation flag](https://learn.microsoft.com/windows/win32/procthread/process-creation-flags)
- Source: `src-tauri/src/process_jail.rs`
- CHANGELOG: `[0.9.6]` — ProcessJail introduction
