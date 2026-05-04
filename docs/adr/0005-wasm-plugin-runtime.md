# ADR-0005: Plugin Runtime — WebAssembly (revize ADR-0004)

**Status**: Proposed
**Date**: 2026-05-04
**Author**: Orhan Engin OKAY (Gemini code review feedback'i sonrası)
**Supersedes (kısmen)**: ADR-0004 — capability/permission API korunur, runtime substrate değişir.

## Context

ADR-0004'te plugin'ler için Web Worker + postMessage tabanlı sandbox seçilmişti. Pre-alpha geri bildiriminde Gemini 2.5 plugin runtime'ı **WebAssembly** ile kurmamızı önerdi. Bu öneri ciddi avantajlar getiriyor; v1.1 öncesinde mimari sıvı haldeyken yeniden değerlendiriyoruz.

### Web Worker'ın eksikleri (ADR-0004 kararı sonrası ortaya çıkanlar)

- **Yalnız JavaScript/TypeScript** plugin yazılabilir — Rust, Go, Zig gibi dillerde yazılan eklentiler dışlanır
- **Bellek izolasyonu zayıf** — Worker içindeki kötü niyetli/buggy kod hâlâ unbounded memory tüketebilir, GC pause'ları ana thread'i etkiler
- **`postMessage` çağrıları structured-clone bedeli ödetir** — büyük veri payload'lerinde önemli kopyalama maliyeti
- **Permission enforcement yalnız host tarafında uygulanabilir** — Worker içinde bu kontrol bypass edilirse (örn. transferable obje bug'ı), sandbox kırılır
- **DevTools desteği zayıf** — Worker debug deneyimi browser/Tauri tarafında parçalı

### WebAssembly'nin avantajları

- **Çok dilli** — Rust, Go, Zig, AssemblyScript, C/C++ → tek runtime
- **Bellek sıkı sınırlı** — `MemoryType { initial, maximum }` ile linear memory'nin üst sınırı host tarafında zorunlu kılınır
- **CPU sınırlı** — `wasmtime` epoch interruption ile sonsuz döngüleri kesebilir, fuel ile syscall maliyeti ölçülebilir
- **Capability-by-import** — modül yalnızca import ettiği fonksiyonları çağırabilir; başka API yok (en sıkı sandbox modeli)
- **WASI** standart sistem arabirimi (file/network kapasiteleri YALNIZCA host izin verirse mevcut)
- **Performans** — JIT/AOT (cranelift backend) ile JS'e yakın veya üzeri throughput
- **Stable bytecode** — plugin tek `.wasm` olarak dağıtılır, derleyici/dil/platform bağımsız
- **Süpervize ekosistem** — Bytecode Alliance + Mozilla + Microsoft destekli

### Gemini'nin önerisinin temel önermesi

> "Eklenti sistemini Rust tarafında WebAssembly runtime'ı (örneğin `wasmtime` veya `extism`) kullanarak kurabilirsin. Bu sayede sadece JS/TS ile değil, Rust, Go veya Zig ile yazılmış eklentileri de desteklersin. Ayrıca Wasm'in izin sistemi (memory access, file access limitleri) güvenlik açısından Web Worker'lardan çok daha sıkı ve izole bir 'Sandbox' sağlar."

Bu önerme objektif olarak doğru. Web Worker + capability modeli "yumuşak" bir sandbox'tır; Wasm "sert" sandbox'tır.

## Decision

**v1.1+ plugin runtime'ı WebAssembly olacak.** Capability/permission API (ADR-0004 §3) aynı şekilde korunur — değişen yalnız substrate'tir.

### Runtime: extism

İki olası runtime adayı karşılaştırıldı:

| | `wasmtime` | `extism` |
|---|---|---|
| Türü | Genel amaçlı Wasm runtime | Plugin-system framework (wasmtime üstüne) |
| API | Düşük seviye (Module, Instance, Linker, Store) | Plugin merkezli yüksek seviye |
| Host fn binding | Manuel | `host_fn!` makrosu ile boilerplate-az |
| Plugin entry | `_start` veya custom export | Standart `_start` + named exports + JSON I/O |
| WASI desteği | Tam | Tam (host'a opsiyonel) |
| Çoklu dil SDK | Manuel her dilde | Resmi SDK: Rust, Go, JS, Python, C#, Zig, ... |
| Dağıtım | Sadece runtime | Runtime + plugin discovery + manifest |
| Olgunluk | Üretim seviye | Üretim seviye (Apple, OpenAI, Shopify kullanıyor) |
| Boyut etkisi | ~5 MB binary | ~7 MB binary |

**Karar: `extism` kullanılır.** Sebep: SDK ekosistemi geniş + manifest tabanlı pattern D-Terminal plugin manifest formatına (ADR-0004) doğal eşleniyor + çoklu dil desteği "out of the box".

### Capability API (değişmez — ADR-0004'ten devralınır)

```toml
[plugin]
id = "http-pane"
name = "HTTP Request Pane"
version = "0.1.0"

[permissions]
ipc = ["pane:render", "pane:read-input"]
network = ["https://api.example.com"]
storage = ["plugin:http-pane.*"]
```

Host tarafında permission denetimi, plugin'in import ettiği host fonksiyonlarda zorlanır. Plugin permission istemeden bir fonksiyonu **çağıramaz** (link-time hata) — kontrol Wasm runtime tarafından enforce edilir, JS tarafındaki property check değil.

### Plugin SDK seçimi

İlk parti SDK: Rust + TypeScript (AssemblyScript veya `@extism/extism` JS SDK ile esbuild bundling).

Tipik plugin yapısı (Rust):

```rust
use extism_pdk::*;

#[plugin_fn]
pub fn render_pane(input: Json<RenderInput>) -> FnResult<Json<RenderOutput>> {
    // host fonksiyonları: dterm_get_pane_state, dterm_emit_event, dterm_request_http
    let state = dterm_get_pane_state()?;
    Ok(Json(RenderOutput { ... }))
}
```

Tipik plugin yapısı (TypeScript / AssemblyScript):

```typescript
import { Pane, http } from '@dterminal/plugin-sdk';

export function render_pane(input: RenderInput): RenderOutput {
  return Pane.render({ ... });
}
```

### Performans bütçesi

- Plugin instantiate: <50 ms (cold), <5 ms (warm cache)
- Host call latency: <100 µs (in-process, Rust ↔ Wasm)
- Memory limit (default): 64 MB linear memory, 1 MB stack
- CPU budget: 1 saniye epoch (kesilebilir)

### Plugin discovery

`%APPDATA%\D-Terminal\plugins\<id>\plugin.wasm` + `manifest.toml`. İlk yüklemede manifest okunur, kullanıcıya permission özeti gösterilir, onaydan sonra runtime'da instantiate edilir.

## Consequences

### Olumlu
- Plugin developer kitlesi 5×+ büyür (Rust/Go/Zig topluluğu)
- Sandbox güvenliği sertleşir — link-time capability enforcement
- Performans: hot-path host call'lar Worker postMessage'tan ~100× daha hızlı
- Dağıtım kolaylaşır: tek `.wasm` dosyası, kullanıcı side-load'a güvenebilir

### Olumsuz / takas
- Bundle boyutu ~7 MB artar (extism + wasmtime backend gömülü)
- Plugin debug deneyimi yeni — browser DevTools yerine `wasmtime`'ın debug API'si öğrenilmeli
- AssemblyScript JS dünyasında niş — TypeScript developer'lar için ek öğrenme eğrisi
- ADR-0004'teki iframe/sandbox seçenekleri tamamen elenir (zaten redde edilmişti)

### Mitigasyon
- Bundle boyutu için: extism'i feature gate ardına koy → varsayılan kapalı, kullanıcı plugins kullanmak istediğinde indir/etkinleştir
- TypeScript developer için: official SDK + örnek template repo + "5 dakikada hello-world plugin" kılavuzu

### Geçiş planı
1. **v1.0**: ADR-0004 capability API'sini tamamla (host fn imzaları), Worker referans implementasyonunu MVP olarak tut
2. **v1.0.5**: extism entegrasyonunu deneysel feature flag ile ekle, Worker yan yana çalışsın
3. **v1.1**: Worker yolu deprecate edilir, Wasm tek desteklenen runtime olur
4. **v1.2+**: Worker support tamamen kaldırılır

## Alternatives Considered

- **Native plugin (`.dll`/`.so` dynamic load)**: Reddedildi — sandbox yok, ABI uyumsuzluğu, signing zorluğu
- **Lua VM (`mlua` ile)**: Reddedildi — tek dil, zayıf izolasyon (memory limit yok)
- **Deno-style isolated JS**: Reddedildi — Tauri zaten Chromium V8 kullanıyor, ek isolate Rust binding gerektirir
- **`wasmtime` direkt**: Reddedildi — extism'in plugin-system abstraction'ı bizim case'imize daha yakın

## References

- [extism — Universal Plugin System](https://extism.org/)
- [Wasmtime](https://wasmtime.dev/)
- [ADR-0004 — Plugin Sandbox: Web Worker + Capability API](./0004-plugin-worker-sandbox.md)
- Gemini 2.5 code review feedback'i (2026-05-04 D-Terminal proje değerlendirmesi)
