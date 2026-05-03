# ADR-0002: API Key ve Secret Saklama — Windows DPAPI

**Status**: Accepted
**Date**: 2026-05-02
**Author**: Orhan Engin OKAY

## Context

D-Terminal, AI provider API key'leri (Anthropic, OpenAI, Gemini, vb.), SSH credential'ları ve gelecekte plugin secret'larını yerel olarak saklayacak. Bu credential'ların güvenli şekilde at-rest şifrelenmesi gerekir.

Kısıtlar:
- Kullanıcıdan ek master parola istemek UX'i bozar (tek başına çalışan terminal için ağır)
- Kullanıcının kendi makinesinde, kendi user account'unda çalışan başka uygulamalar gibi temel bir trust modeli yeterli
- Cross-platform port (macOS/Linux) için interface temiz tutulmalı

Mevcut v1.0 mimari belgesi "AES-256 ile şifreli SQLite" der ama master key'in nereden geldiğini söylemez. Bu boşluk doldurulmalı.

## Decision

**Windows DPAPI (Data Protection API), per-user binding. Master key SQLite'a yazılmaz. Şifreleme/çözme her credential erişiminde Rust tarafında yapılır.**

### Akış

```
Yazma:
  plaintext_key
    → CryptProtectData(CRYPTPROTECT_LOCAL_MACHINE=0)
    → encrypted_blob (AES-256, OS-managed key)
    → SQLite secrets tablosu

Okuma:
  SQLite secrets tablosu
    → encrypted_blob
    → CryptUnprotectData()
    → plaintext_key (sadece bellekte, sadece çağrı süresince)
```

### SQLite şeması

```sql
CREATE TABLE secrets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,    -- 'ai_provider' | 'ssh' | 'plugin'
  name          TEXT NOT NULL,    -- 'anthropic_api_key', 'github.com:user', ...
  ciphertext    BLOB NOT NULL,    -- DPAPI ile şifrelenmiş blob
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME,
  UNIQUE(scope, name)
);
```

### Bellek davranışı

- Plaintext key sadece `chat()` çağrısı süresince bellekte tutulur
- `zeroize` crate ile değişken scope'tan çıkarken bellek sıfırlanır
- Cache yok — her API çağrısında DPAPI roundtrip (~0.1ms, ihmal edilebilir)

### Cross-platform abstraction

```rust
// src-tauri/src/secrets/mod.rs
pub trait SecretStore: Send + Sync {
    fn store(&self, scope: &str, name: &str, value: &[u8]) -> Result<()>;
    fn retrieve(&self, scope: &str, name: &str) -> Result<Vec<u8>>;
    fn delete(&self, scope: &str, name: &str) -> Result<()>;
    fn list(&self, scope: &str) -> Result<Vec<String>>;
}

// Windows
pub struct DpapiStore { /* SQLite + windows-rs */ }

// macOS (gelecek)
pub struct KeychainStore { /* keyring crate */ }

// Linux (gelecek)
pub struct SecretServiceStore { /* keyring crate */ }
```

Build target'a göre `cfg(target_os = "windows")` ile compile-time seçim.

## Consequences

### Olumlu
- Kullanıcıdan master parola sormaya gerek yok — UX kayıpsız
- OS-level entropy ve key management — Microsoft sertifikalı kripto modülü
- Per-user binding: aynı makinede başka Windows kullanıcısı `CryptUnprotectData` çağırsa bile çözemez
- `keyring` crate ile macOS/Linux'a port = ~50 satır kod

### Olumsuz / Kabul edilen tradeoff'lar
- **Aynı Windows kullanıcısı olarak çalışan başka uygulama erişebilir** — DPAPI process isolation sağlamaz, sadece user isolation. Bu, sektör standardıdır (1Password, browser password manager'lar dahil aynı modeli kullanır), README'de açıkça belgelenir.
- Backup/sync zor — şifreli blob başka makinede çözülemez. Kullanıcı export ederse plaintext export gerekir (warning ile).
- DPAPI Windows-only — port için ek kod gerekir (ama interface zaten soyut)

### Risk azaltma
- README'de "Aynı kullanıcı hesabındaki kötü amaçlı yazılım API key'lerinizi okuyabilir" uyarısı (gerçekçi, korkutucu değil)
- Plaintext export işlemi UI'da kırmızı uyarı + onay modal
- `last_used_at` izleme — kullanılmayan key'leri kullanıcıya bildir, temizlemeye teşvik et
- Plugin'lerin secrets API'sine erişimi capability-based (ADR-0004), random plugin key okuyamaz

## Alternatifler

### Master parola + Argon2id KDF + AES-256-GCM
Reddedildi: Her terminal açılışında parola sormak günde 20 kez oluyor, kullanıcıyı kaçırır. "Beni hatırla" yapsan zaten DPAPI'ye geri dönüyorsun.

### Düz plaintext (config dosyasında)
Reddedildi: Disk forensics, yanlışlıkla repo commit, backup leak — kabul edilemez risk.

### TPM-backed encryption
Reddedildi: TPM tüm makinelerde yok (özellikle eski Win10), karmaşık API, debug zor. ROI düşük.

### Browser-style: SQLCipher + DPAPI ile DB-level şifreleme
Reddedildi: Tüm DB'yi şifrelemek session/history sorgu performansını düşürür. Sadece secrets tablosunu hedef almak yeterli; Chrome/Edge de tam olarak böyle yapar.

## Referanslar

- [Windows DPAPI (Microsoft Docs)](https://learn.microsoft.com/en-us/windows/win32/seccrypto/data-protection)
- [windows-rs crate](https://crates.io/crates/windows)
- [zeroize crate](https://crates.io/crates/zeroize)
- [keyring-rs (cross-platform)](https://crates.io/crates/keyring)
