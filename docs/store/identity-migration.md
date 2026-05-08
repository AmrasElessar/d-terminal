# D-Terminal — Identity Migration Plan (v0.9.x → MS Store)

> v0.9.x kullanıcılarının MS Store sürümüne **kayıpsız** geçmesi için strateji.

---

## 🎯 Sorun

| Şu an (v0.9.x) | MS Store'da |
|---|---|
| `identifier`: `dev.dbrand.dterminal` | `12345AmrasElessar.DTerminal` (Partner Center'dan) |
| AppData yolu: `%APPDATA%\D-Terminal\` (Roaming) | `%LOCALAPPDATA%\Packages\<id>\LocalState\` (sandbox) |
| Auto-updater: GitHub'dan latest.json | Microsoft Store sunduğu native updater |
| Code signing: SignPath FOSS (pending) | Store kendi cert'iyle imzalar |
| Dağıtım: GitHub Releases | MS Store + GitHub paralel |

Identity değiştiği için Windows iki sürümü **farklı uygulama** olarak görür → otomatik upgrade yok, paralel install olur.

---

## 🛣️ Üç olası strateji

### A) **Paralel install** (en basit, çoğu Store geçişinde standart)

- Mevcut v0.9.x kalır, kullanıcı manuel kaldırır
- Store sürümü yeni uygulama olarak kurulur (yeni AppData)
- Kullanıcı eski snippet/komut geçmişi kaybeder

**Artıları:**
- Hiçbir kod yazma yok
- Risk düşük

**Eksileri:**
- Mevcut kullanıcı verisi taşınmaz → kötü UX
- Kullanıcı iki yere kurarsa karışıklık

---

### B) **Migration wizard** (önerilen — D-Terminal'in saygın olmasını sağlar)

Store sürümü ilk açıldığında:
1. `%APPDATA%\D-Terminal\` var mı kontrol et
2. Varsa: "v0.9.x verisi tespit edildi. Aktarmak ister misin?" diyalog göster
3. Onaylanırsa: SQLite DB'yi sandbox path'ine kopyala, snippet/settings/secrets'ı içe aktar
4. Eski sürümü uninstall etme önerisi sun

**Artıları:**
- Kullanıcı verisi korunur
- Profesyonel görünüm

**Eksileri:**
- `commands/migrate.rs` yazılması gerekiyor (~150 satır Rust)
- DPAPI secret'lar yeni Windows kullanıcı bağlamında **otomatik decrypt edilebilir** (aynı user account → aynı master key) — bu iyi haber
- AI key'leri yeni vault'a yeniden şifrelemen gerek

---

### C) **Universal binary** (uzun vadeli, MSIX'ten bağımsız tek codebase)

- Store sürümü ile GitHub sürümü **aynı binary**, sadece `identifier` farklı
- Build pipeline'da feature flag ile path resolution değiştirilir
  - Store build: `dirs::data_local_dir().join("Packages\\<id>\\LocalState")`
  - GitHub build: `dirs::data_dir().join("D-Terminal")`
- Migration code'u her zaman aktif (her iki sürümde)

**Artıları:**
- Tek codebase
- Hangi kanalı seçerse seçsin kullanıcı sorunsuz geçer

**Eksileri:**
- Build matrix kompleks (3 hedef: Store, GitHub-x64, GitHub-ARM64)
- Test yükü artar

---

## ✅ Önerilen plan: **B (Migration wizard)** + paralel install

### Adım 1: Migration utility yaz

`src-tauri/src/storage/migrate_legacy.rs`:
```rust
pub fn detect_legacy_install() -> Option<PathBuf> {
    let legacy = dirs::data_dir()?.join("D-Terminal");
    if legacy.join("dterminal.db").exists() {
        Some(legacy)
    } else {
        None
    }
}

pub fn migrate_from_legacy(legacy_dir: &Path, store_dir: &Path) -> AppResult<MigrationReport> {
    // 1. dterminal.db kopyala (refinery V001+ migration'ları sandbox'da çalıştırır)
    // 2. settings.json kopyala
    // 3. themes/ kopyala (kullanıcının custom tema'ları)
    // 4. logs/ kopyala (debugging için, son 7 gün)
    // 5. DPAPI secrets'ları yeni vault'a aktar (DPAPI master key kullanıcı bağlamında — aynı PC'de decrypt edilebilir)
    // 6. MigrationReport döndür
}
```

### Adım 2: İlk-açılış UI'ı

`src/components/MigrationDialog.vue` — Store sürümü ilk başladığında:
- Legacy install tespit edilirse modal aç
- "Verilerini aktarmak ister misin? [Evet, aktar] [Hayır, sıfırdan başla]"
- İlerleme göstergesi
- Bittiğinde "Eski D-Terminal v0.9.x'i kaldırmak ister misin?" → MSI uninstall trigger

### Adım 3: GitHub sürümünde uyarı banner'ı

Store sürümü çıktığında, GitHub'daki v0.9.x sürümlerine release notes'una not eklenir:
> ⚠️ MS Store'da yayınlandık! Otomatik güncellemeler ve daha temiz kurulum için Store'dan indirmeyi düşünebilirsin: <store-link>. Verilerini Store sürümü ilk açılışta aktarır.

---

## 📅 Zaman çizelgesi tahmini

| İş | Süre |
|---|---|
| Migration utility (Rust) | 4-6 saat |
| MigrationDialog (Vue) | 2-3 saat |
| Test (sandbox path'leri farklı) | 3-4 saat |
| GitHub release notları | 30 dk |

**Toplam: ~10-14 saat çalışma**

Store submission'a paralel ilerletilebilir — kod hazırken Store onay sürecini de başlatırsın.
