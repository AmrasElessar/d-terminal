// Snippet (isimlendirilmiş komut) repository.

use crate::error::AppResult;
use crate::storage::db::ConnPool;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snippet {
    pub id: i64,
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub shortcut: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewSnippet {
    pub name: String,
    pub command: String,
    pub description: Option<String>,
    pub shortcut: Option<String>,
}

pub struct SnippetsRepo {
    pool: ConnPool,
}

impl SnippetsRepo {
    pub fn new(pool: ConnPool) -> Self {
        Self { pool }
    }

    pub fn list(&self) -> AppResult<Vec<Snippet>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, command, description, shortcut FROM snippets ORDER BY name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Snippet {
                id: r.get(0)?,
                name: r.get(1)?,
                command: r.get(2)?,
                description: r.get(3)?,
                shortcut: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn upsert(&self, snippet: NewSnippet) -> AppResult<i64> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO snippets (name, command, description, shortcut)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(name) DO UPDATE SET
                command = excluded.command,
                description = excluded.description,
                shortcut = excluded.shortcut",
            rusqlite::params![
                snippet.name,
                snippet.command,
                snippet.description,
                snippet.shortcut,
            ],
        )?;
        let id: i64 = conn.query_row(
            "SELECT id FROM snippets WHERE name = ?1",
            rusqlite::params![snippet.name],
            |r| r.get(0),
        )?;
        Ok(id)
    }

    pub fn delete(&self, id: i64) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute("DELETE FROM snippets WHERE id = ?1", rusqlite::params![id])?;
        Ok(())
    }

    pub fn get(&self, id: i64) -> AppResult<Option<Snippet>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, command, description, shortcut FROM snippets WHERE id = ?1",
        )?;
        let mut rows = stmt.query(rusqlite::params![id])?;
        if let Some(r) = rows.next()? {
            Ok(Some(Snippet {
                id: r.get(0)?,
                name: r.get(1)?,
                command: r.get(2)?,
                description: r.get(3)?,
                shortcut: r.get(4)?,
            }))
        } else {
            Ok(None)
        }
    }
}
