// Session (layout snapshot) repository.

use crate::error::AppResult;
use crate::storage::db::ConnPool;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionRecord {
    pub id: i64,
    pub name: String,
    pub layout_json: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub struct SessionRepo {
    pool: ConnPool,
}

impl SessionRepo {
    pub fn new(pool: ConnPool) -> Self {
        Self { pool }
    }

    pub fn save(&self, name: &str, layout_json: &str) -> AppResult<i64> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO sessions (name, layout_json) VALUES (?1, ?2)
             ON CONFLICT(name) DO UPDATE SET layout_json = excluded.layout_json,
                                              updated_at = CURRENT_TIMESTAMP",
            rusqlite::params![name, layout_json],
        )?;
        let id: i64 = conn.query_row(
            "SELECT id FROM sessions WHERE name = ?1",
            rusqlite::params![name],
            |r| r.get(0),
        )?;
        Ok(id)
    }

    pub fn load(&self, name: &str) -> AppResult<Option<SessionRecord>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, layout_json, created_at, updated_at FROM sessions WHERE name = ?1",
        )?;
        let mut rows = stmt.query(rusqlite::params![name])?;
        if let Some(row) = rows.next()? {
            Ok(Some(SessionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                layout_json: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn list(&self) -> AppResult<Vec<SessionRecord>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, layout_json, created_at, updated_at FROM sessions ORDER BY updated_at DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(SessionRecord {
                id: r.get(0)?,
                name: r.get(1)?,
                layout_json: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn delete(&self, name: &str) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM sessions WHERE name = ?1", rusqlite::params![name])?;
        Ok(())
    }
}
