# ADR-0001: PTY Sidecar IPC Protokolü

**Status**: Accepted (heartbeat zombie-detection v0.9.6'da [ADR-0006](./0006-process-jail-job-object.md) tarafından supersede edildi — fallback olarak kalır)
**Date**: 2026-05-02
**Author**: Orhan Engin OKAY

> **v0.9.6 güncellemesi:** Sidecar artık Windows Job Object'e
> (`ProcessJail`) `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` flag'i ile assign
> ediliyor. Parent crash'inde sidecar + grandchild PTY shell'ler kernel
> tarafından **garantili** temizlenir. Aşağıdaki "5s heartbeat / 15s
> timeout" mekanizması artık primary değil, **graceful degradation
> fallback'i** olarak çalışır (Job creation fail veya non-Windows
> platform). Detay: [ADR-0006](./0006-process-jail-job-object.md).

## Context

`node-pty` Tauri'nin Rust runtime'ında doğrudan çalışmaz; ayrı bir Node.js sidecar process olarak başlatılması gerekir. Bu sidecar ile Tauri ana process'i arasında düşük gecikmeli, yüksek throughput'lu, çok sayıda pane'i destekleyen bir IPC protokolü tanımlanmalıdır.

Çözülmesi gereken problemler:
- Birden fazla PTY pane'i tek sidecar üzerinden multipleks edilmeli
- Binary güvenli olmalı (terminal output 8-bit raw byte içerir, JSON encode pahalı ve bozucu)
- Backpressure desteklenmeli — yavaş tüketici PTY üreticisini boğabilmeli
- Sidecar crash'ı tespit edilebilmeli ve yeniden başlatılabilmeli

## Decision

**Length-prefixed binary frame protokolü, tek sidecar process, pane multiplexing, ring buffer ile backpressure.**

### Frame formatı

```
┌─────────────┬──────────┬───────────────┬─────────────┐
│ length (4)  │ type (1) │ pane_id (8)   │ payload (N) │
└─────────────┴──────────┴───────────────┴─────────────┘

length:  payload uzunluğu, big-endian uint32 (max 16MB)
type:    mesaj tipi, uint8
pane_id: pane tanımlayıcısı, big-endian uint64
payload: type'a göre değişken (raw bytes veya CBOR)
```

### Mesaj tipleri

| Code | Yön | İsim | Payload |
|---|---|---|---|
| 0x01 | Tauri→Sidecar | SPAWN | CBOR `{shell, args, cwd, env, cols, rows}` |
| 0x02 | Tauri→Sidecar | STDIN | raw bytes |
| 0x03 | Sidecar→Tauri | STDOUT | raw bytes |
| 0x04 | Tauri→Sidecar | RESIZE | CBOR `{cols, rows}` |
| 0x05 | Tauri→Sidecar | KILL | empty |
| 0x06 | Sidecar→Tauri | EXIT | CBOR `{exit_code, signal}` |
| 0x07 | İki yönlü | PING | empty (heartbeat, 5s interval) |
| 0x08 | İki yönlü | PONG | empty |
| 0x09 | Sidecar→Tauri | ERROR | CBOR `{code, message}` |
| 0x0A | Tauri→Sidecar | FLOW_RESUME | empty (backpressure release) |

### Transport

- Sidecar stdin/stdout'ta binary mode (Node: `process.stdin.setRawMode` benzeri, ancak pipe için `setEncoding(null)`)
- Sidecar stderr ayrı kanalda — sadece sidecar'ın kendi log/diagnostic mesajları, frame protokolü dışı
- Tauri tarafında `tauri-plugin-shell` ile sidecar spawn, `Stdio::piped()` ile binary I/O

### Multiplexing

- **Tek sidecar, max 50 pane** (CPU/dosya tanıtıcı limiti)
- 51. pane talebi geldiğinde ikinci sidecar process spawn edilir (sidecar pool)
- Sidecar seçimi round-robin değil — least-loaded (aktif pane sayısına göre)

### Backpressure

- Her pane için Tauri tarafında 1 MB ring buffer (Vec<u8> circular)
- Buffer %80 dolduğunda sidecar'a `KILL` değil, OS-level SIGSTOP gönder (Windows: `SuspendThread` PTY okuma thread'ine)
- Frontend buffer'ı tükettiğinde `FLOW_RESUME` mesajı → sidecar SIGCONT (Windows: `ResumeThread`)
- Buffer overflow durumunda en eski 256 KB drop edilir + uyarı log'lanır (terminal scrollback zaten xterm.js tarafında)

### Heartbeat ve crash detection

- Tauri her 5 saniyede `PING` gönderir, 15 saniyede `PONG` gelmezse sidecar dead sayılır
- Sidecar yeniden spawn edilir, açık pane'ler `ERROR` state'ine geçer (kullanıcı yeniden açar — process state restore edilemez)
- Crash sayısı 1 dakikada 3'ü geçerse exponential backoff (5s, 30s, 2dk)

## Consequences

### Olumlu
- Binary format → terminal ANSI escape sequence'leri korunur, encoding pahası yok
- Tek sidecar 50 pane → bellek/CPU verimli (Node process başlatma maliyeti ~30 MB)
- Ring buffer + SIGSTOP → bellek patlaması olmaz, slow consumer'da PTY duraklar
- Heartbeat → zombie process tespiti garantili

### Olumsuz / Kabul edilen tradeoff'lar
- Custom protokol → debug için Wireshark gibi hazır araç yok, kendi inspector'ümüzü yazmamız gerekir (dev tool)
- CBOR seçimi protobuf'tan basit ama tooling daha az
- 50 pane limiti keyfi — gerçek dünyada 10+ pane bile nadir, ama hardcoded değil config'ten okunmalı

### Risk azaltma
- Protokol versiyonu sidecar SPAWN handshake'inde değiş tokuş edilir — uyumsuzluk varsa sidecar reddeder
- Frame parser fuzz testi yazılır (`cargo-fuzz` ile)
- Frame size limiti (16 MB) DoS koruması — overflow → connection reset

## Alternatifler

### JSON üzerinden satır bazlı IPC
Reddedildi: Binary terminal output base64 encode pahası, ANSI sequence escape karmaşası. Throughput ~10x daha düşük.

### gRPC / Cap'n Proto
Reddedildi: Schema/build aracı bağımlılığı, tek bir local sidecar için aşırı mühendislik. Frame parser 100 satır.

### Unix domain socket / Named pipe
Reddedildi: Tauri sidecar API zaten stdio pipe'ı yönetiyor — ek soket kurulumu kompleksite ekler, gain yok.

### Pane başına ayrı sidecar
Reddedildi: 10 pane = 10x300 MB RAM. Multiplexing kazanımı net.

## Referanslar

- [node-pty README](https://github.com/microsoft/node-pty)
- [Tauri sidecar guide](https://tauri.app/v1/guides/building/sidecar/)
- [CBOR RFC 8949](https://www.rfc-editor.org/rfc/rfc8949)
