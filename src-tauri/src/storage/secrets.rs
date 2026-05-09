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
