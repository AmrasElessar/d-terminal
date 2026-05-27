// Legacy install → Store install migration komutları.
//
// Frontend `MigrationDialog.vue` ilk açılışta `migrate_detect_legacy()`
// çağırır. Detect Some döndürürse modal açılır → kullanıcı `migrate_run` veya
// `migrate_dismiss` çağırır.
//
// ⚠️ HOT-SWAP NOTU (v1.0 öncesi BLOCKING): `migrate_run` Storage'ı
// kapatmaz/yeniden açmaz. v0.10.x'te MSIX target path'i henüz GitHub
// build'inden farklı olmadığı için `migrate_detect_legacy` zaten None döner;
// command effectively no-op. MSIX feature flag eklendiğinde target_dir
// farklı çözüleceği için aşağıdaki kontroller eklenmelidir:
//   1. AppState'e `data_dir: PathBuf` ve `storage: RwLock<Arc<Storage>>` ekle
//   2. migrate_run'da Storage'ı drop et (write lock al, Arc'ı yenisi ile değiştir)
//   3. Migration sonrası yeni Storage::open(target_dir) ile reload
// Şu an için MIGRATION_MUTEX double-call'u engeller.

use crate::error::{AppError, AppResult};
use crate::storage::migrate_legacy::{self, MigrationReport, MigrationState, MigrationStatus};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// Concurrent migrate_run / migrate_dismiss çağrılarını serialize eder.
/// Frontend butonlar disabled olsa da defansif guard (XSS / RPC abuse'a karşı).
static MIGRATION_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
fn migration_lock() -> &'static Mutex<()> {
    MIGRATION_MUTEX.get_or_init(|| Mutex::new(()))
}

/// UI'a iletilen detect sonucu. Hiç dialog gerekmiyorsa None döner.
#[derive(Debug, Clone, Serialize)]
pub struct DetectedLegacy {
    /// Algılanan legacy install dizininin **kısaltılmış** display formu —
    /// UI'da gösterilir, full Windows username path'i ifşa etmez (CWE-200).
    /// Backend gerçek path'i kullanmaya devam eder; bu sadece görüntü için.
    pub path: String,
    /// `dterminal.db` boyutu (byte) — UI "X MB" göstergesi için.
    pub db_size_bytes: u64,
    /// `themes/` mevcut mu?
    pub has_themes: bool,
    /// `config.toml` mevcut mu?
    pub has_config: bool,
}

/// Mevcut binary'nin AppData kökü. lib.rs setup'ında kullanılan path ile
/// uyumlu olmalı (`dirs::data_dir() + "D-Terminal"`).
fn default_target_dir() -> AppResult<PathBuf> {
    dirs::data_dir()
        .map(|p| p.join("D-Terminal"))
        .ok_or_else(|| AppError::Internal("data_dir unresolved".into()))
}

/// Legacy install'ın *unredirected* AppData kökü. v0.10.x'te target ile
/// AYNI — MSIX feature flag eklendiğinde burada `%APPDATA%`'yı VFS bypass
/// ile çözmek gerekir (GetEnvironmentVariableW("APPDATA") + raw path).
fn default_legacy_dir() -> AppResult<PathBuf> {
    // Şimdilik target ile aynı — detect_legacy_install bunu görüp None döner.
    // Bu davranış intentional: MSIX'siz build'lerde migration UI hiç açılmaz.
    dirs::data_dir()
        .map(|p| p.join("D-Terminal"))
        .ok_or_else(|| AppError::Internal("data_dir unresolved".into()))
}

/// Tam fs path'i kısaltılmış göstergeye çevir — Windows username gizlensin.
/// `C:\Users\engin\AppData\Roaming\D-Terminal` → `…\AppData\Roaming\D-Terminal`
/// Son 3 segment yeterli context (Roaming|Local + D-Terminal) sağlar.
fn shorten_path_for_display(p: &Path) -> String {
    let components: Vec<_> = p
        .components()
        .filter_map(|c| match c {
            std::path::Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect();
    if components.len() <= 3 {
        return p.to_string_lossy().into_owned();
    }
    let tail = &components[components.len() - 3..];
    format!("…\\{}", tail.join("\\"))
}

#[tauri::command]
pub fn migrate_detect_legacy() -> AppResult<Option<DetectedLegacy>> {
    let target = default_target_dir()?;
    let legacy = default_legacy_dir()?;
    let Some(found) = migrate_legacy::detect_legacy_install(&target, &legacy) else {
        return Ok(None);
    };
    let db_path = found.join("dterminal.db");
    let db_size_bytes = std::fs::metadata(&db_path).map(|m| m.len()).unwrap_or(0);
    let has_themes = found.join("themes").is_dir();
    let has_config = found.join("config.toml").is_file();
    Ok(Some(DetectedLegacy {
        path: shorten_path_for_display(&found),
        db_size_bytes,
        has_themes,
        has_config,
    }))
}

#[tauri::command]
pub fn migrate_run() -> AppResult<MigrationReport> {
    // Concurrent call guard — H7/H8'in tek noktadan korunması.
    // try_lock() ile beklemek yerine BUSY hatası dön; frontend zaten butonu
    // disabled yapıyor ama defansif.
    let _guard = migration_lock()
        .try_lock()
        .ok_or_else(|| AppError::InvalidArg("migration zaten çalışıyor".into()))?;
    let target = default_target_dir()?;
    let legacy = default_legacy_dir()?;
    // NOT: `detect_legacy_install` ile double-check YAPMIYORUZ; migration_from_legacy
    // kendi tüm guard'larını yapıyor (paths equal, marker var, target DB var,
    // legacy DB yok, '..' traversal). Burada gereksiz çift kontrol yanıltıcıydı
    // (audit TOCTOU H8): bir kontrol True ise diğeri de aynı sonucu vereceğini
    // varsaymak; gerçekten state değişebilir. Tek noktadan kontrol = daha sağlam.
    migrate_legacy::migrate_from_legacy(&legacy, &target)
}

#[tauri::command]
pub fn migrate_dismiss() -> AppResult<()> {
    let _guard = migration_lock()
        .try_lock()
        .ok_or_else(|| AppError::InvalidArg("migration zaten çalışıyor".into()))?;
    let target = default_target_dir()?;
    migrate_legacy::dismiss_legacy_migration(&target)
}

#[tauri::command]
pub fn migrate_state() -> AppResult<Option<MigrationStateDto>> {
    let target = default_target_dir()?;
    Ok(migrate_legacy::read_migration_state(&target).map(MigrationStateDto::from))
}

/// Frontend'e iletilen DTO — `MigrationState` storage modülünde, command DTO
/// camelCase serialize (UI alanı `at` yerine `at` zaten OK; `from`/`status`
/// da sade). Direkt re-export yerine wrapper: ileride alan eklemek esneklik
/// sağlar (örn. UI-friendly mesaj).
///
/// NOT: `from` alanı kısaltılmış path döner (CWE-200) — UI'da Windows
/// username'i exposure'ı engellemek için.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationStateDto {
    pub status: MigrationStatus,
    pub from: Option<String>,
    /// ISO 8601 string — Tauri JSON'da chrono::DateTime zaten RFC 3339 yazar.
    pub at: String,
}

impl From<MigrationState> for MigrationStateDto {
    fn from(s: MigrationState) -> Self {
        Self {
            status: s.status,
            from: s.from.map(|p| shorten_path_for_display(Path::new(&p))),
            at: s.at.to_rfc3339(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// default_target_dir ve default_legacy_dir aynı path döner (v0.10.x);
    /// MSIX feature flag eklenene kadar bu ASIL beklenen davranıştır.
    #[test]
    fn defaults_are_equal_until_msix_feature() {
        let t = default_target_dir().unwrap();
        let l = default_legacy_dir().unwrap();
        assert_eq!(t, l);
    }

    /// detect command — defaults eşit olduğu için None döner.
    /// (Tauri runtime'a girmeden saf fonksiyon test'i.)
    #[test]
    fn detect_returns_none_with_default_paths() {
        let result = migrate_detect_legacy().unwrap();
        assert!(
            result.is_none(),
            "v0.10.x'te legacy == target → detect None olmalı"
        );
    }

    /// migrate_run defaults ile çağrıldığında InvalidArg dönmeli — defansif
    /// koruma sayesinde Storage hot-swap olmadan kazara migration yapılmaz.
    /// (Şimdi migrate_from_legacy "paths equal" InvalidArg döner, double-check
    /// olmadan da aynı sonuç.)
    #[test]
    fn run_rejects_when_paths_equal() {
        let err = migrate_run().unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
    }

    #[test]
    fn shorten_path_keeps_short_paths_as_is() {
        let p = Path::new("C:\\foo\\bar");
        let s = shorten_path_for_display(p);
        assert!(s.contains("foo"));
        assert!(s.contains("bar"));
        assert!(!s.starts_with("…"));
    }

    #[test]
    fn shorten_path_collapses_long_paths_to_last_three_segments() {
        let p = Path::new("C:\\Users\\someone\\AppData\\Roaming\\D-Terminal");
        let s = shorten_path_for_display(p);
        assert!(s.starts_with("…\\"));
        assert!(s.contains("AppData"));
        assert!(s.contains("Roaming"));
        assert!(s.contains("D-Terminal"));
        assert!(!s.contains("someone"), "username exposure: {s}");
    }
}
