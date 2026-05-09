// Secret blob repository (DPAPI-encrypted ciphertext SQLite'a yazılır).
//
// Plain text dönüşüm yok — sadece blob CRUD. Encrypt/decrypt katmanı
// `crate::secrets::SecretStore` impl'inde.

use crate::error::AppResult;
use crate::storage::db::ConnPool;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecretRow {
    pub id: i64,
    pub scope: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

pub struct SecretsRepo {
    pool: ConnPool,
}

impl SecretsRepo {
    pub fn new(pool: ConnPool) -> Self {
        Self { pool }
    }

    pub fn upsert(&self, scope: &str, name: &str, ciphertext: &[u8]) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "INSERT INTO secrets (scope, name, ciphertext) VALUES (?1, ?2, ?3)
             ON CONFLICT(scope, name) DO UPDATE SET ciphertext = excluded.ciphertext",
            rusqlite::params![scope, name, ciphertext],
        )?;
        Ok(())
    }

    pub fn get_blob(&self, scope: &str, name: &str) -> AppResult<Option<Vec<u8>>> {
        // SELECT + UPDATE (last_used_at) tek transaction'da: WAL modunda
        // başka thread aynı row'u silebilir veya upsert ile değiştirebilir;
        // race window'unu kapatır (audit P1-2).
        let mut conn = self.pool.get()?;
        let tx = conn.transaction()?;
        let blob: Option<Vec<u8>> = tx
            .query_row(
                "SELECT ciphertext FROM secrets WHERE scope = ?1 AND name = ?2",
                rusqlite::params![scope, name],
                |r| r.get::<_, Vec<u8>>(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        if blob.is_some() {
            tx.execute(
                "UPDATE secrets SET last_used_at = CURRENT_TIMESTAMP \
                 WHERE scope = ?1 AND name = ?2",
                rusqlite::params![scope, name],
            )?;
        }
        tx.commit()?;
        Ok(blob)
    }

    pub fn delete(&self, scope: &str, name: &str) -> AppResult<()> {
        let conn = self.pool.get()?;
        conn.execute(
            "DELETE FROM secrets WHERE scope = ?1 AND name = ?2",
            rusqlite::params![scope, name],
        )?;
        Ok(())
    }

    pub fn list(&self, scope: &str) -> AppResult<Vec<SecretRow>> {
        let conn = self.pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, scope, name, created_at, last_used_at FROM secrets
             WHERE scope = ?1 ORDER BY name",
        )?;
        let rows = stmt.query_map(rusqlite::params![scope], |r| {
            Ok(SecretRow {
                id: r.get(0)?,
                scope: r.get(1)?,
                name: r.get(2)?,
                created_at: r.get(3)?,
                last_used_at: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2_sqlite::SqliteConnectionManager;

    /// In-memory pool: max_size=1 + with_init migration → tek conn'da yaşayan
    /// test DB (in-memory'de her conn ayrı DB olduğu için tek conn şart).
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

    /// upsert + get_blob round-trip: yazılan ciphertext aynen geri alınır.
    #[test]
    fn upsert_then_get_blob_roundtrip() {
        let repo = SecretsRepo::new(fresh_pool());
        let blob = vec![1u8, 2, 3, 4, 5];
        repo.upsert("ai", "openai_key", &blob).unwrap();
        let got = repo.get_blob("ai", "openai_key").unwrap();
        assert_eq!(got, Some(blob));
    }

    /// Aynı (scope, name) ile ikinci upsert → ciphertext update edilir
    /// (ON CONFLICT DO UPDATE), unique constraint hatası atmaz.
    #[test]
    fn upsert_same_key_updates_ciphertext() {
        let repo = SecretsRepo::new(fresh_pool());
        repo.upsert("ai", "k1", &[0u8; 4]).unwrap();
        repo.upsert("ai", "k1", &[9u8; 4]).unwrap();
        let got = repo.get_blob("ai", "k1").unwrap().unwrap();
        assert_eq!(got, vec![9u8; 4]);
        // Hâlâ tek satır olmalı.
        let rows = repo.list("ai").unwrap();
        assert_eq!(rows.len(), 1);
    }

    /// get_blob existing row → last_used_at NULL'dan CURRENT_TIMESTAMP'a güncellenir.
    #[test]
    fn get_blob_updates_last_used_at() {
        let repo = SecretsRepo::new(fresh_pool());
        repo.upsert("ai", "k1", b"x").unwrap();
        // İlk get → last_used_at güncellenir.
        let _ = repo.get_blob("ai", "k1").unwrap();
        let rows = repo.list("ai").unwrap();
        assert_eq!(rows.len(), 1);
        assert!(
            rows[0].last_used_at.is_some(),
            "last_used_at should be set after get_blob"
        );
    }

    /// Olmayan (scope, name) → Ok(None), hata değil.
    #[test]
    fn get_blob_missing_returns_none() {
        let repo = SecretsRepo::new(fresh_pool());
        let got = repo.get_blob("ai", "yok").unwrap();
        assert!(got.is_none());
    }

    /// delete sonrası get_blob → None.
    #[test]
    fn delete_then_get_blob_returns_none() {
        let repo = SecretsRepo::new(fresh_pool());
        repo.upsert("ai", "k1", b"abc").unwrap();
        repo.delete("ai", "k1").unwrap();
        let got = repo.get_blob("ai", "k1").unwrap();
        assert!(got.is_none());
    }

    /// list(scope) → name'e göre sıralı satır listesi döner.
    #[test]
    fn list_returns_rows_sorted_by_name() {
        let repo = SecretsRepo::new(fresh_pool());
        repo.upsert("ai", "zebra", b"z").unwrap();
        repo.upsert("ai", "alpha", b"a").unwrap();
        repo.upsert("ai", "mango", b"m").unwrap();
        let rows = repo.list("ai").unwrap();
        let names: Vec<_> = rows.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, vec!["alpha", "mango", "zebra"]);
    }

    /// Farklı scope'lar izole — list("a") "b"yi göstermez.
    #[test]
    fn list_isolates_scopes() {
        let repo = SecretsRepo::new(fresh_pool());
        repo.upsert("ai", "k", b"1").unwrap();
        repo.upsert("ssh", "k", b"2").unwrap();
        let ai_rows = repo.list("ai").unwrap();
        let ssh_rows = repo.list("ssh").unwrap();
        assert_eq!(ai_rows.len(), 1);
        assert_eq!(ssh_rows.len(), 1);
    }
}
