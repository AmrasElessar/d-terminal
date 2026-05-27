// Legacy install → MS Store install migration.
//
// MS Store sürümü (MSIX) farklı bir AppData path'inde çalışacak.
// Mevcut v0.9.x / v0.10.x kullanıcılarının verilerini (history, secrets,
// snippets, themes, config) kayıpsız taşımak için kullanılır.
//
// Strateji B (docs/store/identity-migration.md):
//   1. Legacy install algıla — %APPDATA%\D-Terminal\dterminal.db var mı
//   2. Onaylanırsa: SQLite DB'yi VACUUM INTO ile sandbox path'ine kopyala
//   3. themes/ ve config.toml dosyalarını kopyala
//   4. .migration-state.json marker yaz — bir daha sorma
//
// DPAPI secret'lar: aynı Windows kullanıcı bağlamında master key paylaşılır,
// kopyalanan ciphertext'ler yeni path'te de decrypt edilir. Re-encrypt yok.
//
// Bu modül **integration-aware değil** — Storage'ın açık olup olmadığını
// bilmez. Çağıran (commands/migrate.rs) Storage hot-swap koordinasyonundan
// sorumludur (bkz. ADR — Storage hot-swap, v1.0 öncesi).

use crate::error::{AppError, AppResult};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Migration marker dosyasının adı. target_dir kökünde tutulur, presence/parse
/// migration durumunu temsil eder. Komple bağımsız — DB'ye dokunmaz.
pub const MARKER_FILE: &str = ".migration-state.json";

/// Legacy install detect/copy fonksiyonlarının hedef seçtiği dosya/dizin
/// kümesi. Liste değişirse marker formatına dokunmak gerekmez.
const LEGACY_DB_FILE: &str = "dterminal.db";
const LEGACY_THEMES_DIR: &str = "themes";
const LEGACY_CONFIG_FILE: &str = "config.toml";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MigrationStatus {
    Completed,
    Dismissed,
}

/// `.migration-state.json` içeriği — bir kez yazılır, idempotent okunur.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationState {
    pub status: MigrationStatus,
    /// Migration kaynağının absolute path'i (Dismissed durumunda None olabilir).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// ISO 8601 (RFC 3339) timestamp — UTC.
    pub at: DateTime<Utc>,
}

/// migrate_from_legacy başarılı tamamlandığında üretilen özet — UI'a iletilir.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct MigrationReport {
    pub db_copied: bool,
    pub themes_copied: u32,
    pub config_copied: bool,
    /// Hedefe yazılan toplam byte. UI "X MB aktarıldı" göstergesi için.
    pub total_bytes: u64,
}

/// Algılama tetikleyici — UI hangi durumda dialog göstermeli? Şu kuralları
/// karşılayanlar dışında her durum None döner:
///
/// 1. `target_dir` ile `legacy_dir` farklı path olmalı (aynı path = migration
///    anlamsız; mevcut GitHub build'leri için sıradan no-op).
/// 2. `legacy_dir/dterminal.db` mevcut olmalı — taşınacak veri var.
/// 3. `target_dir/dterminal.db` mevcut OLMAMALI — kullanıcı zaten Store
///    sürümünde veri biriktirmişse override etme.
/// 4. `target_dir/.migration-state.json` marker'ı mevcut OLMAMALI — kullanıcı
///    daha önce migration ya yapmış ya da reddetmiş.
///
/// Path safety: her iki path için `..` segment'i reddedilir (CWE-73 path
/// traversal). canonicalize başarısızsa (target henüz yok) lexical
/// karşılaştırma yapılır ama traversal kontrolü her halükârda zorunlu.
pub fn detect_legacy_install(target_dir: &Path, legacy_dir: &Path) -> Option<PathBuf> {
    if path_has_parent_traversal(target_dir) || path_has_parent_traversal(legacy_dir) {
        tracing::warn!(target: "migration", "rejected: path contains '..' segment");
        return None;
    }
    let target = canonicalize_or_self(target_dir);
    let legacy = canonicalize_or_self(legacy_dir);
    if target == legacy {
        return None;
    }
    if !legacy.join(LEGACY_DB_FILE).is_file() {
        return None;
    }
    if target.join(LEGACY_DB_FILE).is_file() {
        return None;
    }
    if marker_path(&target).is_file() {
        return None;
    }
    Some(legacy)
}

/// Legacy install'dan target'a migration yürüt. Çağırılmadan önce çağıranın
/// Storage'ı kapatmış olduğu varsayılır (DB lock alamadığında VACUUM INTO
/// fail eder). Atomicity yok — partial state mümkün; başarısızlık halinde
/// kullanıcı yeniden deneyebilir çünkü marker yazılmaz.
///
/// Hata mesajları UI'a generic mesaj döner; tam fs path tracing log'a yazılır
/// (CWE-200 / CWE-532 — UI'da Windows username görünmesin).
pub fn migrate_from_legacy(legacy_dir: &Path, target_dir: &Path) -> AppResult<MigrationReport> {
    // CWE-73: path traversal koruması — `..` segment'lerini reddet.
    if path_has_parent_traversal(legacy_dir) || path_has_parent_traversal(target_dir) {
        return Err(AppError::InvalidArg(
            "path '..' segment içeriyor (path traversal reddedildi)".into(),
        ));
    }
    // target dizinini canonicalize öncesi yarat — `..` olmadığını yukarıda
    // garantiledikten sonra create_dir_all güvenli, sonra her iki tarafta
    // canonical path eşitliği güvenilir hale gelir.
    std::fs::create_dir_all(target_dir)?;
    let legacy = std::fs::canonicalize(legacy_dir).map_err(|e| {
        tracing::warn!(target: "migration", error = %e, path = ?legacy_dir, "legacy canonicalize failed");
        AppError::InvalidArg("kaynak dizini çözümlenemedi".into())
    })?;
    let target = std::fs::canonicalize(target_dir).map_err(|e| {
        tracing::warn!(target: "migration", error = %e, path = ?target_dir, "target canonicalize failed");
        AppError::InvalidArg("hedef dizin çözümlenemedi".into())
    })?;
    if legacy == target {
        return Err(AppError::InvalidArg(
            "legacy_dir == target_dir; migration yapacak yer yok".into(),
        ));
    }
    let legacy_db = legacy.join(LEGACY_DB_FILE);
    if !legacy_db.is_file() {
        tracing::warn!(target: "migration", path = ?legacy_db, "source DB missing");
        return Err(AppError::InvalidArg("kaynak DB bulunamadı".into()));
    }
    if target.join(LEGACY_DB_FILE).is_file() {
        tracing::warn!(target: "migration", path = ?target, "target already has data");
        return Err(AppError::InvalidArg("target zaten veri içeriyor".into()));
    }
    if marker_path(&target).is_file() {
        return Err(AppError::InvalidArg(
            "migration zaten yapılmış/reddedilmiş (marker var)".into(),
        ));
    }

    let mut report = MigrationReport::default();

    // 1) DB kopya — VACUUM INTO temiz snapshot üretir (WAL/SHM dependency yok).
    let target_db = target.join(LEGACY_DB_FILE);
    copy_sqlite_via_vacuum(&legacy_db, &target_db)?;
    report.db_copied = true;
    report.total_bytes += file_size(&target_db).unwrap_or(0);

    // 2) themes/ — kullanıcının custom temaları (built-in tema sandbox'da gelir).
    let legacy_themes = legacy.join(LEGACY_THEMES_DIR);
    if legacy_themes.is_dir() {
        let target_themes = target.join(LEGACY_THEMES_DIR);
        let (count, bytes) = copy_dir_recursive(&legacy_themes, &target_themes)?;
        report.themes_copied = count;
        report.total_bytes += bytes;
    }

    // 3) config.toml — Config as Code (commands/config_io.rs ile uyumlu).
    let legacy_cfg = legacy.join(LEGACY_CONFIG_FILE);
    if legacy_cfg.is_file() {
        let target_cfg = target.join(LEGACY_CONFIG_FILE);
        std::fs::copy(&legacy_cfg, &target_cfg)?;
        report.config_copied = true;
        report.total_bytes += file_size(&target_cfg).unwrap_or(0);
    }

    // 4) Marker yaz — bir daha sorma. Hata olursa migration tamam ama
    //    tekrar sormaya karşı koruma yok; o yüzden hatayı bubble et.
    write_state(
        &target,
        &MigrationState {
            status: MigrationStatus::Completed,
            from: Some(legacy.to_string_lossy().into_owned()),
            at: Utc::now(),
        },
    )?;

    Ok(report)
}

/// Kullanıcı "Hayır, sıfırdan başlıyorum" derse — marker yaz, bir daha sorma.
pub fn dismiss_legacy_migration(target_dir: &Path) -> AppResult<()> {
    if path_has_parent_traversal(target_dir) {
        return Err(AppError::InvalidArg(
            "path '..' segment içeriyor (path traversal reddedildi)".into(),
        ));
    }
    std::fs::create_dir_all(target_dir)?;
    let target = std::fs::canonicalize(target_dir).unwrap_or_else(|_| target_dir.to_path_buf());
    write_state(
        &target,
        &MigrationState {
            status: MigrationStatus::Dismissed,
            from: None,
            at: Utc::now(),
        },
    )
}

/// Mevcut marker durumunu oku — yoksa None.
pub fn read_migration_state(target_dir: &Path) -> Option<MigrationState> {
    let p = marker_path(target_dir);
    let bytes = std::fs::read(&p).ok()?;
    serde_json::from_slice::<MigrationState>(&bytes).ok()
}

// ──────────────────────── internal helpers ────────────────────────

fn marker_path(target_dir: &Path) -> PathBuf {
    target_dir.join(MARKER_FILE)
}

fn write_state(target_dir: &Path, state: &MigrationState) -> AppResult<()> {
    let p = marker_path(target_dir);
    let json = serde_json::to_vec_pretty(state)
        .map_err(|e| AppError::Internal(format!("marker serialize: {e}")))?;
    // Atomic write: tmp file + rename — Windows'ta MoveFileExW(MOVEFILE_REPLACE_EXISTING)
    // ile aynı volume içinde atomik. `tmp` her zaman aynı dizinde olduğu için
    // volume-cross senaryosu YOK (`p.with_extension` parent değiştirmez).
    // Junction/reparse senaryosunda fail durumunda tmp kalmasın diye cleanup.
    let tmp = p.with_extension("json.tmp");
    if let Err(e) = std::fs::write(&tmp, &json) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    if let Err(e) = std::fs::rename(&tmp, &p) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(())
}

/// `..` (ParentDir) segment'lerini reddet — CWE-73 path traversal koruması.
/// Normal kullanıcı `dirs::data_dir()` çıktısı kullanır; `..` segment ancak
/// bir attacker ya da bug ile gelebilir.
fn path_has_parent_traversal(p: &Path) -> bool {
    p.components().any(|c| c == std::path::Component::ParentDir)
}

/// SQLite DB'yi VACUUM INTO ile temiz kopyala. WAL/SHM olsa bile target tek
/// dosya olur. Source kilitliyse SQLITE_BUSY → AppError::Sqlite.
///
/// Çağıran sözleşmesi: kaynak DB başka bir writer connection tarafından AÇIK
/// OLMAMALI. Read-only open SQLite seviyesinde lock almasa da, WAL içinde
/// uncommitted frame'ler varsa VACUUM INTO bozuk olabilir. `migrate_run`
/// command katmanında AppState.storage Arc'ı için bu kontrol H7 ile yapılır.
fn copy_sqlite_via_vacuum(src: &Path, dst: &Path) -> AppResult<()> {
    if dst.exists() {
        tracing::warn!(target: "migration", path = ?dst, "target DB already exists");
        return Err(AppError::InvalidArg("target DB zaten var".into()));
    }
    // Read-only open: VACUUM INTO source'a yazmaz, sadece okur.
    let conn = rusqlite::Connection::open_with_flags(
        src,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.execute(
        "VACUUM INTO ?1",
        rusqlite::params![dst.to_string_lossy().as_ref()],
    )?;
    Ok(())
}

/// Recursive directory copy. Hidden dosyalar dahil; symlink follow yapmaz.
/// Returns (file_count, total_bytes).
fn copy_dir_recursive(src: &Path, dst: &Path) -> AppResult<(u32, u64)> {
    std::fs::create_dir_all(dst)?;
    let mut count: u32 = 0;
    let mut bytes: u64 = 0;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if ty.is_dir() {
            let (c, b) = copy_dir_recursive(&src_path, &dst_path)?;
            count += c;
            bytes += b;
        } else if ty.is_file() {
            let written = std::fs::copy(&src_path, &dst_path)?;
            count += 1;
            bytes += written;
        }
        // Symlink'leri yoksay — themes/config'de olmamalı, olsa da takip
        // etmek istemiyoruz (potansiyel path traversal vektörü).
    }
    Ok((count, bytes))
}

fn file_size(p: &Path) -> Option<u64> {
    std::fs::metadata(p).ok().map(|m| m.len())
}

/// Path normalize — canonicalize başarısız olursa orijinal path'i kullan
/// (henüz oluşmamış target_dir için canonicalize fail eder; equality için
/// lexical karşılaştırma yeterli).
fn canonicalize_or_self(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper — benzersiz tmp dizin (paralel test isolation).
    fn unique_tmp(label: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("dterm-mig-{}-{}", label, uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).expect("tmp create");
        p
    }

    /// Migration için minimum dolu legacy install hazırla:
    /// - dterminal.db (schema + sample row)
    /// - themes/D-Custom.json
    /// - config.toml
    fn populate_legacy(legacy: &Path) {
        std::fs::create_dir_all(legacy).unwrap();
        // DB — refinery migration'larını çalıştır + örnek history row ekle.
        let db_path = legacy.join(LEGACY_DB_FILE);
        let mut conn = rusqlite::Connection::open(&db_path).unwrap();
        crate::storage::migrations::run(&mut conn).unwrap();
        conn.execute(
            "INSERT INTO command_history (command) VALUES ('echo hello legacy')",
            [],
        )
        .unwrap();
        // WAL mode'da bırakırsak VACUUM INTO için sorun değil; ama temiz
        // kapatmak güzel.
        drop(conn);

        // themes/
        let themes = legacy.join(LEGACY_THEMES_DIR);
        std::fs::create_dir_all(&themes).unwrap();
        std::fs::write(
            themes.join("D-Custom.json"),
            br##"{"name":"D-Custom","background":"#001020"}"##,
        )
        .unwrap();

        // config.toml
        std::fs::write(legacy.join(LEGACY_CONFIG_FILE), b"# legacy config\n").unwrap();
    }

    #[test]
    fn detect_returns_none_when_paths_equal() {
        let dir = unique_tmp("same");
        populate_legacy(&dir);
        assert!(detect_legacy_install(&dir, &dir).is_none());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn detect_returns_none_when_legacy_db_missing() {
        let legacy = unique_tmp("nolegacy");
        let target = unique_tmp("notarget");
        // legacy boş — DB yok
        assert!(detect_legacy_install(&target, &legacy).is_none());
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn detect_rejects_paths_with_parent_traversal() {
        let legacy = unique_tmp("legacy-trav");
        populate_legacy(&legacy);
        let target_with_traversal = std::env::temp_dir().join("foo").join("..").join("bar");
        assert!(detect_legacy_install(&target_with_traversal, &legacy).is_none());
        let legacy_with_traversal = legacy.join("..").join("evil");
        let target = unique_tmp("target");
        assert!(detect_legacy_install(&target, &legacy_with_traversal).is_none());
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn migrate_rejects_paths_with_parent_traversal() {
        let legacy = unique_tmp("legacy");
        populate_legacy(&legacy);
        let target = std::env::temp_dir().join("foo").join("..").join("bar");
        let err = migrate_from_legacy(&legacy, &target).unwrap_err();
        match err {
            AppError::InvalidArg(msg) => assert!(msg.contains("traversal"), "msg: {msg}"),
            other => panic!("expected InvalidArg, got {other:?}"),
        }
        std::fs::remove_dir_all(&legacy).ok();
    }

    #[test]
    fn detect_returns_none_when_target_already_has_db() {
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);
        // Target zaten dolu — override etme.
        std::fs::write(target.join(LEGACY_DB_FILE), b"existing").unwrap();
        assert!(detect_legacy_install(&target, &legacy).is_none());
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn detect_returns_none_when_marker_present() {
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);
        // Marker yaz — kullanıcı daha önce dismiss etmiş.
        dismiss_legacy_migration(&target).unwrap();
        assert!(detect_legacy_install(&target, &legacy).is_none());
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn detect_returns_some_when_all_conditions_met() {
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);
        // Target sadece var ama boş.
        let found = detect_legacy_install(&target, &legacy);
        assert!(found.is_some());
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn migrate_copies_db_themes_and_config() {
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);

        let report = migrate_from_legacy(&legacy, &target).expect("migrate ok");
        assert!(report.db_copied);
        assert_eq!(report.themes_copied, 1);
        assert!(report.config_copied);
        assert!(report.total_bytes > 0);

        // DB kopyalanmış mı + içerik korunmuş mu?
        let target_db = target.join(LEGACY_DB_FILE);
        assert!(target_db.is_file());
        let conn = rusqlite::Connection::open(&target_db).unwrap();
        let cmd: String = conn
            .query_row("SELECT command FROM command_history LIMIT 1", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(cmd, "echo hello legacy");

        // themes/
        assert!(target.join("themes").join("D-Custom.json").is_file());
        // config.toml
        assert!(target.join("config.toml").is_file());
        // marker
        let state = read_migration_state(&target).expect("marker");
        assert_eq!(state.status, MigrationStatus::Completed);
        assert!(state.from.is_some());

        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn migrate_rejects_same_path() {
        let dir = unique_tmp("same");
        populate_legacy(&dir);
        let err = migrate_from_legacy(&dir, &dir).unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn migrate_rejects_when_target_has_db() {
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);
        std::fs::write(target.join(LEGACY_DB_FILE), b"existing").unwrap();
        let err = migrate_from_legacy(&legacy, &target).unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn migrate_rejects_when_legacy_missing() {
        let legacy = unique_tmp("legacy-empty");
        let target = unique_tmp("target");
        // legacy/dterminal.db yok
        let err = migrate_from_legacy(&legacy, &target).unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn migrate_rejects_when_marker_exists() {
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);
        dismiss_legacy_migration(&target).unwrap();
        let err = migrate_from_legacy(&legacy, &target).unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn migrate_is_not_naively_re_runnable() {
        // İlk migration başarılı, marker yazıldı. İkinci migration "target
        // zaten DB içeriyor" diye reddedilmeli — idempotency'yi marker DEĞİL,
        // target DB varlığı garanti ediyor (üst koruma).
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);
        migrate_from_legacy(&legacy, &target).expect("first migrate");
        let err = migrate_from_legacy(&legacy, &target).unwrap_err();
        assert!(matches!(err, AppError::InvalidArg(_)));
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn dismiss_writes_marker_with_dismissed_status() {
        let target = unique_tmp("dismiss");
        dismiss_legacy_migration(&target).unwrap();
        let state = read_migration_state(&target).expect("state");
        assert_eq!(state.status, MigrationStatus::Dismissed);
        assert!(state.from.is_none());
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn read_state_returns_none_when_no_marker() {
        let target = unique_tmp("nomarker");
        assert!(read_migration_state(&target).is_none());
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn nested_themes_dir_copied_recursively() {
        let legacy = unique_tmp("legacy");
        let target = unique_tmp("target");
        populate_legacy(&legacy);
        // İç içe tema dizini ekle
        let nested = legacy.join(LEGACY_THEMES_DIR).join("user-pack");
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("D-Nested.json"), br##"{"name":"D-Nested"}"##).unwrap();

        let report = migrate_from_legacy(&legacy, &target).unwrap();
        // copy_dir_recursive yalnız `is_file()` dalında sayar — dizinler
        // sayım dışı. 2 = themes/D-Custom.json + themes/user-pack/D-Nested.json.
        assert_eq!(report.themes_copied, 2);
        assert!(target
            .join(LEGACY_THEMES_DIR)
            .join("user-pack")
            .join("D-Nested.json")
            .is_file());
        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }

    #[test]
    fn migrate_without_themes_or_config_still_succeeds() {
        let legacy = unique_tmp("legacy-min");
        let target = unique_tmp("target-min");
        // Sadece DB, themes/config yok.
        std::fs::create_dir_all(&legacy).unwrap();
        let mut conn = rusqlite::Connection::open(legacy.join(LEGACY_DB_FILE)).unwrap();
        crate::storage::migrations::run(&mut conn).unwrap();
        drop(conn);

        let report = migrate_from_legacy(&legacy, &target).unwrap();
        assert!(report.db_copied);
        assert_eq!(report.themes_copied, 0);
        assert!(!report.config_copied);

        std::fs::remove_dir_all(&legacy).ok();
        std::fs::remove_dir_all(&target).ok();
    }
}
