-- V002 — Performance indexes + history full-text search
-- Audit: Storage P1-4 + Rust-perf O3.
--
-- Eklenenler:
--   - idx_history_favorite: favori liste sorgusu (WHERE is_favorite=1)
--   - idx_history_pane_executed: pane-scoped recent history (composite)
--   - idx_secrets_last_used: erişim takibi (last_used_at DESC sıralı listeler)
--   - idx_snippets_shortcut: shortcut → snippet reverse lookup
--   - idx_sessions_updated: sessions sıralı list
--   - history_fts (FTS5 virtual table) + 3 trigger: LIKE %query% yerine
--     gerçek full-text search (10K+ history'de tablo taraması yerine indeks).

-- Favori liste — partial index, yalnızca is_favorite=1 satırlarını kapsar.
CREATE INDEX IF NOT EXISTS idx_history_favorite
  ON command_history(is_favorite, executed_at DESC)
  WHERE is_favorite = 1;

-- Pane-scoped recent — composite, "son N komut bu pane'de" sorgusu O(log N).
CREATE INDEX IF NOT EXISTS idx_history_pane_executed
  ON command_history(pane_id, executed_at DESC);

-- Secret erişim takibi
CREATE INDEX IF NOT EXISTS idx_secrets_last_used
  ON secrets(last_used_at DESC);

-- Snippet shortcut reverse lookup (Ctrl+; ile kısayoldan snippet bulma)
CREATE INDEX IF NOT EXISTS idx_snippets_shortcut
  ON snippets(shortcut)
  WHERE shortcut IS NOT NULL;

-- Sessions list sırası
CREATE INDEX IF NOT EXISTS idx_sessions_updated
  ON sessions(updated_at DESC);

-- ─── FTS5 history search ──────────────────────────────────────────────────
-- LIKE %query% pattern'i full table scan; FTS5 prefix-aware token index.
-- content_rowid → command_history.id; insert/delete/update trigger'ları
-- senkron tutar. Frontend search hala command_history üzerinden çalışmaya
-- devam edebilir (geriye uyumlu); FTS5 opt-in.
CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
  command,
  content='command_history',
  content_rowid='id'
);

-- INSERT trigger
CREATE TRIGGER IF NOT EXISTS history_fts_insert AFTER INSERT ON command_history BEGIN
  INSERT INTO history_fts(rowid, command) VALUES (new.id, new.command);
END;

-- DELETE trigger (FTS5 'delete' command)
CREATE TRIGGER IF NOT EXISTS history_fts_delete AFTER DELETE ON command_history BEGIN
  INSERT INTO history_fts(history_fts, rowid, command) VALUES('delete', old.id, old.command);
END;

-- UPDATE trigger (delete+insert)
CREATE TRIGGER IF NOT EXISTS history_fts_update AFTER UPDATE ON command_history BEGIN
  INSERT INTO history_fts(history_fts, rowid, command) VALUES('delete', old.id, old.command);
  INSERT INTO history_fts(rowid, command) VALUES (new.id, new.command);
END;

-- Mevcut history satırları için FTS index'ini doldur (idempotent — daha önce
-- yapıldıysa rebuild yine aynı sonucu verir).
INSERT INTO history_fts(history_fts) VALUES('rebuild');
