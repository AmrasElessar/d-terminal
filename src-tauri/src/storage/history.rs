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

    /// Bulk insert — N entry tek transaction'da, N+1 fsync yerine 1.
    /// 5000 satırlı PSReadLine import 30sn → <1sn (Rust-perf O3).
    pub fn add_bulk(&self, entries: &[NewHistoryEntry]) -> AppResult<usize> {
        if entries.is_empty() {
            return Ok(0);
        }
        let mut conn = self.pool.get()?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO command_history (command, pane_id, pane_type, exit_code, duration_ms) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            for e in entries {
                stmt.execute(rusqlite::params![
                    e.command,
                    e.pane_id,
                    e.pane_type,
                    e.exit_code,
                    e.duration_ms,
                ])?;
            }
        }
        tx.commit()?;
        Ok(entries.len())
    }

    pub fn search(&self, q: HistoryQuery) -> AppResult<Vec<HistoryEntry>> {
        let conn = self.pool.get()?;
        let mut sql = String::from(
            "SELECT id, command, pane_id, pane_type, exit_code, \
             duration_ms, executed_at, is_favorite \
             FROM command_history WHERE 1=1",
        );
        let mut params: Vec<Box<dyn rusqlite::ToSql>> = Vec::new();
        if let Some(text) = &q.text {
            // SQLite LIKE escape: kullanıcı `%` veya `_` yazınca wildcard
            // pattern matching'i devre dışı bırak. ESCAPE '\\' ile özel
            // karakterler literal arar.
            let escaped = text
                .replace('\\', "\\\\")
                .replace('%', "\\%")
                .replace('_', "\\_");
            sql.push_str(" AND command LIKE ? ESCAPE '\\'");
            params.push(Box::new(format!("%{}%", escaped)));
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
        let param_refs: Vec<&dyn rusqlite::ToSql> = params
            .iter()
            .map(|b| &**b as &dyn rusqlite::ToSql)
            .collect();
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
        conn.execute(
            "DELETE FROM command_history WHERE id = ?1",
            rusqlite::params![id],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2_sqlite::SqliteConnectionManager;

    /// In-memory ConnPool kurar — her conn için migration uygulayan with_init
    /// callback'i ile (max_size=1 olduğundan tek conn'da yaşar, in-memory DB
    /// kayıpsız korunur).
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

    fn new_entry(cmd: &str, pane: Option<&str>) -> NewHistoryEntry {
        NewHistoryEntry {
            command: cmd.into(),
            pane_id: pane.map(String::from),
            pane_type: None,
            exit_code: Some(0),
            duration_ms: Some(10),
        }
    }

    /// add + search round-trip: text filtresi insert edilen komutu bulur.
    #[test]
    fn add_then_search_text_filter_returns_match() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("cargo build", Some("p1"))).unwrap();
        repo.add(new_entry("git status", Some("p2"))).unwrap();
        let q = HistoryQuery {
            text: Some("cargo".into()),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].command, "cargo build");
    }

    /// pane_id filtresi sadece o pane'in kayıtlarını döner.
    #[test]
    fn search_pane_id_filter_isolates_panes() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("a", Some("pane-a"))).unwrap();
        repo.add(new_entry("b", Some("pane-b"))).unwrap();
        repo.add(new_entry("c", Some("pane-a"))).unwrap();
        let q = HistoryQuery {
            pane_id: Some("pane-a".into()),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 2);
    }

    /// favorites_only true → yalnızca toggle_favorite ile işaretlenenler döner.
    #[test]
    fn search_favorites_only_filter() {
        let repo = HistoryRepo::new(fresh_pool());
        let id1 = repo.add(new_entry("fav cmd", None)).unwrap();
        repo.add(new_entry("normal cmd", None)).unwrap();
        repo.toggle_favorite(id1).unwrap();
        let q = HistoryQuery {
            favorites_only: true,
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].command, "fav cmd");
    }

    /// LIKE escape: kullanıcı `50%` yazdığında % wildcard değil literal olarak
    /// aranmalı — `50abc` eşleşmemeli, sadece `50%` içeren satırlar dönmeli.
    #[test]
    fn search_escapes_percent_literally() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("disk usage 50%", None)).unwrap();
        repo.add(new_entry("ratio 50abc", None)).unwrap();
        let q = HistoryQuery {
            text: Some("50%".into()),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].command.contains("50%"));
    }

    /// LIKE escape: `_` (single-char wildcard) literal aranmalı.
    #[test]
    fn search_escapes_underscore_literally() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("under_score var", None)).unwrap();
        repo.add(new_entry("underXscore alt", None)).unwrap();
        let q = HistoryQuery {
            text: Some("under_score".into()),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 1);
        assert!(hits[0].command.contains("under_score"));
    }

    /// LIKE escape: `\` karakteri ESCAPE pattern'ı bozmasın — backslash içeren
    /// arama injection olmadan literal eşleşmeli.
    #[test]
    fn search_escapes_backslash_safely() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("path back\\slash here", None)).unwrap();
        repo.add(new_entry("path forward/slash", None)).unwrap();
        let q = HistoryQuery {
            text: Some("back\\slash".into()),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 1);
    }

    /// Negatif limit: SQLite LIMIT -N → tüm satırlar (no-cap) davranışı; sane
    /// kalmalı, panic atmamalı.
    #[test]
    fn search_negative_limit_does_not_panic() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("x", None)).unwrap();
        repo.add(new_entry("y", None)).unwrap();
        let q = HistoryQuery {
            limit: Some(-1),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        // SQLite negatif limit → "no upper bound"; iki satır da dönmeli.
        assert_eq!(hits.len(), 2);
    }

    /// limit=0 → boş Vec.
    #[test]
    fn search_zero_limit_returns_empty() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("a", None)).unwrap();
        repo.add(new_entry("b", None)).unwrap();
        let q = HistoryQuery {
            limit: Some(0),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert!(hits.is_empty());
    }

    /// SQLite LIKE default case-insensitive (ASCII) — Türkçe karakter
    /// üst-alt bağlantısı SQLite default collation'da yok, ama ASCII olmayan
    /// karakter aynı byte sequence ise eşleşmeli.
    #[test]
    fn search_turkish_chars_byte_match() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("İstanbul yolu", None)).unwrap();
        let q = HistoryQuery {
            text: Some("İstanbul".into()),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 1);
    }

    /// Boş string text filtresi → tüm satırlar dönmeli (% empty %% → her şey).
    #[test]
    fn search_empty_text_returns_all_rows() {
        let repo = HistoryRepo::new(fresh_pool());
        repo.add(new_entry("a", None)).unwrap();
        repo.add(new_entry("b", None)).unwrap();
        let q = HistoryQuery {
            text: Some(String::new()),
            ..Default::default()
        };
        let hits = repo.search(q).unwrap();
        assert_eq!(hits.len(), 2);
    }

    /// Şema migration sonrası tablo gerçekten mevcut: add()
    /// "no such table" hatası atmamalı.
    #[test]
    fn schema_table_exists_after_migration() {
        let repo = HistoryRepo::new(fresh_pool());
        let id = repo.add(new_entry("ls -la", None)).unwrap();
        assert!(id > 0);
    }
}
