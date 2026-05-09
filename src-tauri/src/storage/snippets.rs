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

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2_sqlite::SqliteConnectionManager;

    /// In-memory ConnPool: max_size=1 + migration with_init.
    fn fresh_pool() -> ConnPool {
        let manager = SqliteConnectionManager::memory().with_init(|c| {
            crate::storage::migrations::run(c).map_err(|e| {
                rusqlite::Error::SqliteFailure(
                    rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_ERROR),
                    Some(format!("migration: {e}")),
                )
            })
        });
        r2d2::Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("pool")
    }

    fn new_snip(name: &str, cmd: &str) -> NewSnippet {
        NewSnippet {
            name: name.into(),
            command: cmd.into(),
            description: None,
            shortcut: None,
        }
    }

    /// upsert + list round-trip: insert edilen snippet list'te görünür.
    #[test]
    fn upsert_then_list_roundtrip() {
        let repo = SnippetsRepo::new(fresh_pool());
        repo.upsert(new_snip("build", "cargo build")).unwrap();
        let rows = repo.list().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].command, "cargo build");
    }

    /// Aynı name ile upsert → mevcut row update edilir, yeni row eklenmez.
    #[test]
    fn upsert_same_name_updates_existing_row() {
        let repo = SnippetsRepo::new(fresh_pool());
        let id1 = repo.upsert(new_snip("dep", "cargo build")).unwrap();
        let id2 = repo
            .upsert(new_snip("dep", "cargo build --release"))
            .unwrap();
        assert_eq!(id1, id2);
        let rows = repo.list().unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].command, "cargo build --release");
    }

    /// delete + list → silinen snippet listede görünmez.
    #[test]
    fn delete_then_list_excludes_removed() {
        let repo = SnippetsRepo::new(fresh_pool());
        let id = repo.upsert(new_snip("temp", "echo")).unwrap();
        repo.delete(id).unwrap();
        let rows = repo.list().unwrap();
        assert!(rows.is_empty());
    }

    /// get(id) mevcut id → Some(Snippet).
    #[test]
    fn get_existing_id_returns_some() {
        let repo = SnippetsRepo::new(fresh_pool());
        let id = repo.upsert(new_snip("g", "git status")).unwrap();
        let s = repo.get(id).unwrap();
        assert!(s.is_some());
        assert_eq!(s.unwrap().name, "g");
    }

    /// get(id) non-existing → Ok(None).
    #[test]
    fn get_missing_id_returns_none() {
        let repo = SnippetsRepo::new(fresh_pool());
        let s = repo.get(9_999).unwrap();
        assert!(s.is_none());
    }

    /// list() boş tablo → Vec::new() (panic atmamalı, hata vermemeli).
    #[test]
    fn list_empty_returns_empty_vec() {
        let repo = SnippetsRepo::new(fresh_pool());
        let rows = repo.list().unwrap();
        assert!(rows.is_empty());
    }
}
