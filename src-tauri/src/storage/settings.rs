// Ayar key-value storage. Değer JSON string olarak saklanır.

use crate::error::AppResult;
use crate::storage::db::ConnPool;
use std::collections::HashMap;

pub struct SettingsRepo {
    pool: ConnPool,
}

impl SettingsRepo {
    pub fn new(pool: ConnPool) -> Self {
        Self { pool }
    }

    pub fn get(&self, key: &str) -> AppResult<Option<String>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
        let mut rows = stmt.query(rusqlite::params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get::<_, String>(0)?))
        } else {
            Ok(None)
        }
    }

    pub fn set(&self, key: &str, value: &str) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            rusqlite::params![key, value],
        )?;
        Ok(())
    }

    pub fn delete(&self, key: &str) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "DELETE FROM settings WHERE key = ?1",
            rusqlite::params![key],
        )?;
        Ok(())
    }

    pub fn all(&self) -> AppResult<HashMap<String, String>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare("SELECT key, value FROM settings")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out = HashMap::new();
        for r in rows {
            let (k, v) = r?;
            out.insert(k, v);
        }
        Ok(out)
    }
}
