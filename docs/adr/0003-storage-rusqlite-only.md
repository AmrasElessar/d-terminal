# ADR-0003: Storage Layer — Sadece Rust + rusqlite

**Status**: Accepted
**Date**: 2026-05-02
**Author**: Orhan Engin OKAY
**Supersedes**: D-Terminal-Mimari-v1.0.docx Tablo 1 (Storage Layer = better-sqlite3)

## Context

v1.0 mimari belgesi Storage Layer'ı `better-sqlite3` (Node.js native modülü) olarak listeledi. Ancak `better-sqlite3` Node process'inde çalışır ve mimaride iki yer Node kullanıyor:
1. node-pty sidecar (PTY köprüsü)
2. Frontend (Vue/TS, browser context — Node API'si yok)

Bu ikilem net bir karar gerektiriyor: SQLite hangi process'te yaşıyor? Üç seçenek vardı:
- (A) Sidecar'da: PTY sidecar SQLite'ı da yönetir
- (B) Frontend'te: WebView içinde SQLite (örn. `sql.js` WASM)
- (C) Rust ana process'te: Tauri command'leri üzerinden erişim

Belge bu kararı netleştirmediği için her bölümde tutarsız varsayımlar var.

## Decision

**SQLite sadece Rust ana process'te `rusqlite` crate ile yönetilir. WAL mode aktif. Frontend ve sidecar SQLite'a doğrudan dokunmaz, Tauri command'leri üzerinden erişir.**

### Sorumluluk dağılımı

| Process | Sorumluluk | SQLite erişimi |
|---|---|---|
| **Rust (Tauri main)** | Session, history, secrets, config, snippets, themes registry | ✅ rusqlite, doğrudan |
| **Sidecar (Node)** | Sadece PTY I/O multiplexing | ❌ Hiç dokunmaz |
| **Frontend (Vue/TS)** | UI, AI provider çağrıları | ❌ Tauri command üzerinden |

### Tauri command interface

```rust
// src-tauri/src/commands/history.rs
#[tauri::command]
pub async fn history_add(state: State<'_, AppState>, entry: HistoryEntry) -> Result<i64> { ... }

#[tauri::command]
pub async fn history_search(state: State<'_, AppState>, query: SearchQuery) -> Result<Vec<HistoryEntry>> { ... }

// src-tauri/src/commands/session.rs
#[tauri::command]
pub async fn session_save(state: State<'_, AppState>, snapshot: SessionSnapshot) -> Result<()> { ... }
```

Her command async — ana thread bloklanmaz. SQLite işlemleri tokio thread pool'da yapılır (`tokio::task::spawn_blocking`).

### Veritabanı dosyaları

Tek dosya: `%APPDATA%\D-Terminal\dterminal.db`

Tek dosya seçimi:
- ACID garantisi tek transaction'la
- Backup/restore basit (tek dosya kopyala)
- WAL mode'da concurrent read + 1 writer yeter

### Performans yapılandırması

```rust
conn.execute_batch("
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;       -- WAL'da güvenli ve hızlı
    PRAGMA cache_size = -16000;         -- 16 MB cache
    PRAGMA mmap_size = 268435456;       -- 256 MB mmap
    PRAGMA temp_store = MEMORY;
    PRAGMA foreign_keys = ON;
")?;
```

### Migration

`refinery` crate ile versiyonlu schema migration. `migrations/` klasöründe SQL dosyaları (`V001__initial.sql`, `V002__add_snippets.sql`, vb.).

## Consequences

### Olumlu
- Tek storage process → race condition imkânsız
- Sidecar crash etse bile data kaybı yok (sidecar SQLite'a hiç yazmıyor)
- Rust ekosistemi daha hızlı build (`better-sqlite3` Node native compile uzun)
- Tauri permission model SQLite erişimini de koruyor — frontend'ten random SQL injection olamaz (Tauri command'ler tip-güvenli interface)
- WAL mode + connection pool → concurrent read'lerde scaling

### Olumsuz / Kabul edilen tradeoff'lar
- Frontend'ten her storage işlemi IPC roundtrip — ~0.1ms ek gecikme. Ölçülebilir ama UX'te hissedilmez (history search 100 sonuç < 5 ms hedef).
- Migration'lar Rust runtime'ında çalışıyor — frontend'ten çalıştırma esnekliği yok (zaten istemiyoruz).
- Şema değişikliklerinde hem Rust struct hem TS tip güncellemesi gerekir. Otomatize: `ts-rs` crate ile Rust'tan TS tip üretimi.

### Risk azaltma
- `ts-rs` ile Rust struct'lar otomatik TS tipine çevrilir — schema drift riski yok
- Connection pool: max 4 read + 1 write (`r2d2_sqlite` veya `deadpool-sqlite`)
- Migration testleri: her migration up + down test edilir, CI'da

## Alternatifler

### better-sqlite3 sidecar'da
Reddedildi: Sidecar tek sorumluluk almalı (PTY). Storage'ı oraya koymak Single Responsibility ihlali. Sidecar crash olduğunda history kaybı = kabul edilemez.

### sql.js (WASM) frontend'te
Reddedildi: 1 MB+ WASM bundle, persistence için ayrıca File System Access API gerekir, Tauri WebView2'de kısıtlı. Performans %30 daha düşük.

### Surreal/sled gibi embedded NoSQL
Reddedildi: SQL ekosistemi (sorgu, debug, backup, GUI tool'lar) çok daha olgun. History/session için relational şema doğal.

### Redis embedded / Memcached
Reddedildi: Persistence için yine SQLite gerekir, iki sistem yönetmek manasız.

## Referanslar

- [rusqlite crate](https://crates.io/crates/rusqlite)
- [SQLite WAL mode](https://www.sqlite.org/wal.html)
- [refinery — Rust migration tool](https://crates.io/crates/refinery)
- [ts-rs — Rust→TS type generation](https://crates.io/crates/ts-rs)
