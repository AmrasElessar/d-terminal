// SQLite connection pool + WAL setup.

use crate::error::{AppError, AppResult};
use crate::storage::{
    history::HistoryRepo, secrets::SecretsRepo, session::SessionRepo, settings::SettingsRepo,
    snippets::SnippetsRepo,
};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

pub type ConnPool = Pool<SqliteConnectionManager>;

pub struct Storage {
    pool: ConnPool,
    pub history: HistoryRepo,
    pub session: SessionRepo,
    pub settings: SettingsRepo,
    pub secrets: SecretsRepo,
    pub snippets: SnippetsRepo,
}

impl Storage {
    pub fn open(db_path: PathBuf) -> AppResult<Arc<Self>> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        // Audit Storage P2-3: mmap 256MB → 64MB. SQLite WAL + büyük mmap
        // Windows'ta nadiren corruption (file size shrink durumunda) +
        // ARM64 düşük RAM cihazlarda working set inflation. 64MB workload'ımıza
        // yeter, RSS daha küçük.
        let manager = SqliteConnectionManager::file(&db_path).with_init(|c| {
            // busy_timeout: pool size 8 ile multiple writer queue'sunda
            // SQLITE_BUSY hatası yerine 5s bekle (audit Storage P2-9).
            c.busy_timeout(Duration::from_secs(5))?;
            c.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA cache_size = -16000;
                 PRAGMA mmap_size = 67108864;
                 PRAGMA temp_store = MEMORY;
                 PRAGMA foreign_keys = ON;",
            )?;
            Ok(())
        });
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(|e| AppError::Internal(format!("pool build: {e}")))?;

        // Migration: pool dışında, tek bağlantıyla çalışır.
        // Önce backup snapshot — pending migration varsa current DB'yi
        // `dterminal.YYYYMMDD-HHMMSS.bak` olarak kopyala (VACUUM INTO).
        // Migration başarısız olursa kullanıcı manuel restore edebilir.
        if db_path.exists() {
            if let Err(e) = backup_before_migration(&db_path) {
                // Backup başarısızlığı migration'ı engellemez — uyar ve geç.
                tracing::warn!(error = %e, "DB backup before migration failed (proceeding)");
            }
        }
        {
            let mut conn = Connection::open(&db_path)?;
            super::migrations::run(&mut conn)?;
        }

        let pool_arc = pool;
        let storage = Self {
            history: HistoryRepo::new(pool_arc.clone()),
            session: SessionRepo::new(pool_arc.clone()),
            settings: SettingsRepo::new(pool_arc.clone()),
            secrets: SecretsRepo::new(pool_arc.clone()),
            snippets: SnippetsRepo::new(pool_arc.clone()),
            pool: pool_arc,
        };
        Ok(Arc::new(storage))
    }

    pub fn pool(&self) -> &ConnPool {
        &self.pool
    }
}

/// Migration öncesi snapshot al — `VACUUM INTO` ile mevcut DB'yi yedekler.
/// Sonraki açılışta yalnızca son 5 yedek tutulur (eskiyi sil).
fn backup_before_migration(db_path: &Path) -> AppResult<()> {
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let stem = db_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("dterminal");
    let backup = db_path.with_file_name(format!("{stem}.{stamp}.bak"));

    let conn = Connection::open(db_path)?;
    // VACUUM INTO atomik kopya — WAL'a dokunmaz, mevcut conn'a etki etmez.
    conn.execute(
        "VACUUM INTO ?1",
        rusqlite::params![backup.to_string_lossy().as_ref()],
    )?;
    drop(conn);

    rotate_backups(db_path, 5)?;
    tracing::info!(target: "storage", path = %backup.display(), "DB backup created");
    Ok(())
}

/// Aynı dizinde `<stem>.*.bak` desenli en yeni N backup'ı tut, geri kalanı sil.
fn rotate_backups(db_path: &Path, keep: usize) -> AppResult<()> {
    let dir = match db_path.parent() {
        Some(d) => d,
        None => return Ok(()),
    };
    let stem = db_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    if stem.is_empty() {
        return Ok(());
    }
    let prefix = format!("{stem}.");
    let mut backups: Vec<PathBuf> = std::fs::read_dir(dir)?
        .filter_map(|r| r.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().and_then(|s| s.to_str()) == Some("bak")
                && p.file_name()
                    .and_then(|s| s.to_str())
                    .map(|n| n.starts_with(&prefix))
                    .unwrap_or(false)
        })
        .collect();
    // Mtime'a göre sırala (yeni → eski).
    backups.sort_by_key(|p| std::cmp::Reverse(p.metadata().and_then(|m| m.modified()).ok()));
    for old in backups.into_iter().skip(keep) {
        let _ = std::fs::remove_file(&old);
    }
    Ok(())
}
