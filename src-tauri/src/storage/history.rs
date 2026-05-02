// Komut geçmişi repository.

use crate::error::AppResult;
use crate::storage::db::ConnPool;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub command: String,
    pub pane_id: Option<String>,
    pub pane_type: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<i64>,
    pub executed_at: DateTime<Utc>,
    pub is_favorite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewHistoryEntry {
    pub command: String,
    pub pane_id: Option<String>,
    pub pane_type: Option<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HistoryQuery {
    pub text: Option<String>,
    pub pane_id: Option<String>,
    pub limit: Option<i64>,
    pub favorites_only: bool,
}

pub struct HistoryRepo {
    pool: ConnPool,
}

impl HistoryRepo {
    pub fn new(pool: ConnPool) -> Self {
        Self { pool }
    }

    pub fn add(&self, entry: NewHistoryEntry) -> AppResult<i64> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO command_history (command, pane_id, pane_type, exit_code, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                entry.command,
                entry.pane_id,
                entry.pane_type,
                entry.exit_code,
                entry.duration_ms,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn search(&self, q: HistoryQuery) -> AppResult<Vec<HistoryEntry>> {
        let conn = self.pool.get()?;
        let mut sql = String::from(
            "SELECT id, command, pane_id, pane_type, exit_code, duration_ms, executed_at, is_favorite
             FROM command_history WHERE 1=1",
        );
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(text) = &q.text {
            sql.push_str(" AND command LIKE ?");
            params.push(Box::new(format!("%{}%", text)));
        }
        if let Some(pane) = &q.pane_id {
            sql.push_str(" AND pane_id = ?");
            params.push(Box::new(pane.clone()));
        }
        if q.favorites_only {
            sql.push_str(" AND is_favorite = 1");
        }
        sql.push_str(" ORDER BY executed_at DESC LIMIT ?");
        params.push(Box::new(q.limit.unwrap_or(100)));

        let mut stmt = conn.prepare(&sql)?;
        let param_refs: Vec<&dyn rusqlite::ToSql> = params.iter().map(|b| &**b as &dyn rusqlite::ToSql).collect();
        let rows = stmt.query_map(param_refs.as_slice(), |r| {
            Ok(HistoryEntry {
                id: r.get(0)?,
                command: r.get(1)?,
                pane_id: r.get(2)?,
                pane_type: r.get(3)?,
                exit_code: r.get(4)?,
                duration_ms: r.get(5)?,
                executed_at: r.get(6)?,
                is_favorite: r.get::<_, i64>(7)? != 0,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn toggle_favorite(&self, id: i64) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "UPDATE command_history SET is_favorite = NOT is_favorite WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    pub fn delete(&self, id: i64) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM command_history WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }
}
