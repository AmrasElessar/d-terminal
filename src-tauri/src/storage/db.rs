// SQLite connection pool + WAL setup.

use crate::error::{AppError, AppResult};
use crate::storage::{history::HistoryRepo, secrets::SecretsRepo, session::SessionRepo, settings::SettingsRepo};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;

pub type ConnPool = Pool<SqliteConnectionManager>;

pub struct Storage {
    pool: ConnPool,
    pub history: HistoryRepo,
    pub session: SessionRepo,
    pub settings: SettingsRepo,
    pub secrets: SecretsRepo,
}

impl Storage {
    pub fn open(db_path: PathBuf) -> AppResult<Arc<Self>> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let manager = SqliteConnectionManager::file(&db_path).with_init(|c| {
            c.execute_batch(
                "PRAGMA journal_mode = WAL;
                 PRAGMA synchronous = NORMAL;
                 PRAGMA cache_size = -16000;
                 PRAGMA mmap_size = 268435456;
                 PRAGMA temp_store = MEMORY;
                 PRAGMA foreign_keys = ON;",
            )?;
            Ok(())
        });
        let pool = Pool::builder()
            .max_size(8)
            .build(manager)
            .map_err(|e| AppError::Internal(format!("pool build: {e}")))?;

        // Migration: pool dışında, tek bağlantıyla çalışır
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
            pool: pool_arc,
        };
        Ok(Arc::new(storage))
    }

    pub fn pool(&self) -> &ConnPool {
        &self.pool
    }
}
