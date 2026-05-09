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
    Ok(())
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
