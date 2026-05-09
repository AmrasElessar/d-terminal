// Refinery migration runner.
//
// `migrations/V*__*.sql` dosyaları derleme sırasında embed edilir.
//
// `set_abort_divergent(false)`: refinery 0.8.x'te embed_migrations! macro'sunun
// hesapladığı checksum, derleme ortamına bağlı olarak (whitespace/encoding
// nuance) tutarsız olabilir. v0.1.1 ile v0.9.2 arasında V001 dosyası git'te
// hiç değişmediği halde kullanıcıların DB'sinde kayıtlı checksum mismatch
// çıkıyordu. Strict mode panic atıp app'i çökertiyordu. Tolerant mode warning
// log'lar, app çalışmaya devam eder. Migration disiplini değişmedi: V001
// dokunulmaz, yeni şema değişiklikleri V002+ olarak eklenir.

refinery::embed_migrations!("./migrations");

pub fn run(conn: &mut rusqlite::Connection) -> crate::error::AppResult<()> {
    migrations::runner().set_abort_divergent(false).run(conn)?;
    // Downgrade guard: stored _app_version mevcut binary'den daha yüksekse
    // refuse — eski binary yeni şemayı kıramasın (kolon eksik vs. crash).
    // İlk açılışta settings tablosu boştur, no-op.
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = '_app_version'",
            [],
            |r| r.get(0),
        )
        .ok();
    let current = env!("CARGO_PKG_VERSION");
    if let Some(v) = stored {
        if semver_lt(current, &v) {
            return Err(crate::error::AppError::Migration(format!(
                "DB v{v} > app v{current}; downgrade desteklenmiyor"
            )));
        }
    }
    // Mevcut sürümü yaz — sonraki açılışta downgrade tespiti için baz.
    conn.execute(
        "INSERT INTO settings(key, value) VALUES ('_app_version', ?1) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![current],
    )?;
    Ok(())
}

/// Naive semver karşılaştırma — yalnızca `MAJOR.MINOR.PATCH` parse eder
/// (pre-release suffix göz ardı). Production semver tam parse istersen
/// `semver` crate'i ekleyebilirsin; mevcut versiyonlama için yeterli.
fn semver_lt(a: &str, b: &str) -> bool {
    let parse = |s: &str| -> (u32, u32, u32) {
        let mut it = s.split('-').next().unwrap_or(s).split('.');
        let major = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let minor = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        let patch = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
        (major, minor, patch)
    };
    parse(a) < parse(b)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    /// V001 + V002 fresh DB üzerinde temiz uygulanmalı.
    #[test]
    fn fresh_db_migration_succeeds() {
        let mut conn = Connection::open_in_memory().expect("in-memory");
        run(&mut conn).expect("migration");
        // 5 ana tablo (V001) + history_fts virtual table (V002) oluştu mu?
        let n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type IN ('table','view') \
                 AND name IN ('command_history','snippets','secrets','sessions',\
                 'settings','history_fts')",
                [],
                |r| r.get(0),
            )
            .expect("count");
        assert!(n >= 5, "Expected at least 5 core tables, got {n}");
    }

    /// Migration idempotent — peş peşe iki kere çalıştırılabilmeli.
    #[test]
    fn migration_idempotent() {
        let mut conn = Connection::open_in_memory().expect("in-memory");
        run(&mut conn).expect("first run");
        run(&mut conn).expect("second run (idempotent)");
    }

    /// V002 indexleri yüklendi mi (idx_history_favorite, FTS5 trigger'lar).
    #[test]
    fn v002_indexes_and_fts_present() {
        let mut conn = Connection::open_in_memory().expect("in-memory");
        run(&mut conn).expect("migration");
        let idx_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' \
                 AND name IN ('idx_history_favorite','idx_history_pane_executed',\
                 'idx_secrets_last_used','idx_snippets_shortcut','idx_sessions_updated')",
                [],
                |r| r.get(0),
            )
            .expect("idx count");
        assert_eq!(idx_count, 5, "V002 indexes missing");

        let trigger_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' \
                 AND name LIKE 'history_fts_%'",
                [],
                |r| r.get(0),
            )
            .expect("trigger count");
        assert_eq!(trigger_count, 3, "FTS5 triggers missing");
    }

    /// `_app_version` settings tablosuna yazılıyor (downgrade guard temeli).
    #[test]
    fn migration_writes_app_version() {
        let mut conn = Connection::open_in_memory().expect("in-memory");
        run(&mut conn).expect("migration");
        let v: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = '_app_version'",
                [],
                |r| r.get(0),
            )
            .expect("app_version");
        assert_eq!(v, env!("CARGO_PKG_VERSION"));
    }

    /// Stored DB versiyonu binary'den yüksekse migration reddedilir.
    #[test]
    fn migration_rejects_downgrade() {
        let mut conn = Connection::open_in_memory().expect("in-memory");
        run(&mut conn).expect("first run");
        // DB'ye gelecekten gelmiş gibi yüksek versiyon yaz.
        conn.execute(
            "UPDATE settings SET value = '99.0.0' WHERE key = '_app_version'",
            [],
        )
        .unwrap();
        let result = run(&mut conn);
        assert!(result.is_err(), "Downgrade should be rejected");
    }

    #[test]
    fn semver_lt_basic() {
        assert!(semver_lt("0.9.3", "0.9.4"));
        assert!(semver_lt("0.9.3", "0.10.0"));
        assert!(semver_lt("0.9.3", "1.0.0"));
        assert!(!semver_lt("0.9.4", "0.9.3"));
        assert!(!semver_lt("0.9.3", "0.9.3"));
        assert!(semver_lt("0.9.3-beta", "0.9.4")); // pre-release suffix ignored
    }

    /// FTS5 sorgusu çalışıyor — INSERT/DELETE/UPDATE trigger'ları senkron.
    #[test]
    fn history_fts_insert_delete_roundtrip() {
        let mut conn = Connection::open_in_memory().expect("in-memory");
        run(&mut conn).expect("migration");
        conn.execute(
            "INSERT INTO command_history (command) VALUES ('cargo build --release')",
            [],
        )
        .expect("insert");
        conn.execute(
            "INSERT INTO command_history (command) VALUES ('git push origin main')",
            [],
        )
        .expect("insert");
        let hits: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM history_fts WHERE history_fts MATCH 'cargo'",
                [],
                |r| r.get(0),
            )
            .expect("fts query");
        assert_eq!(hits, 1, "FTS5 should match 'cargo' once");
    }
}
