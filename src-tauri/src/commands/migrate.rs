// Legacy install → Store install migration komutları.
//
// Frontend `MigrationDialog.vue` ilk açılışta `migrate_detect_legacy()`
// çağırır. Detect Some döndürürse modal açılır → kullanıcı `migrate_run` veya
// `migrate_dismiss` çağırır.
//
// ⚠️ HOT-SWAP NOTU (v1.0 öncesi tamamlanacak): `migrate_run` Storage'ı
// kapatmaz/yeniden açmaz. v0.10.x'te MSIX target path'i henüz GitHub
// build'inden farklı olmadığı için `migrate_detect_legacy` zaten None döner;
// command effectively no-op. MSIX feature flag eklendiğinde target_dir
// farklı çözüleceği için Storage hot-swap koordinasyonu (AppState içinde
// `RwLock<Arc<Storage>>` + cmd'de drop+reopen) burada eklenmelidir.

use crate::error::{AppError, AppResult};
use crate::storage::migrate_legacy::{self, MigrationReport, MigrationState, MigrationStatus};
use serde::Serialize;
use std::path::PathBuf;

/// UI'a iletilen detect sonucu. Hiç dialog gerekmiyorsa None döner.
#[derive(Debug, Clone, Serialize)]
pub struct DetectedLegacy {
    /// Algılanan legacy install dizini (absolute path).
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
        path: found.to_string_lossy().into_owned(),
        db_size_bytes,
        has_themes,
        has_config,
    }))
}

#[tauri::command]
pub fn migrate_run() -> AppResult<MigrationReport> {
    let target = default_target_dir()?;
    let legacy = default_legacy_dir()?;
    // Storage hot-swap entegrasyonu eklenene kadar prod'da bu path = target
    // → detect None → frontend run çağırmamalı. Defansif kontrol:
    if migrate_legacy::detect_legacy_install(&target, &legacy).is_none() {
        return Err(AppError::InvalidArg(
            "migration koşulları sağlanmıyor (detect None)".into(),
        ));
    }
    migrate_legacy::migrate_from_legacy(&legacy, &target)
}

#[tauri::command]
pub fn migrate_dismiss() -> AppResult<()> {
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
            from: s.from,
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
    #[test]
    fn run_rejects_when_detect_returns_none() {
        let err = migrate_run().unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
    }
}
