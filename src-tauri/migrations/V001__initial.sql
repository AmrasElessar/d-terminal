-- V001 — D-Terminal initial schema
-- Bkz. architecture-v1.1.md §14.3

CREATE TABLE IF NOT EXISTS command_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  command     TEXT NOT NULL,
  pane_id     TEXT,
  pane_type   TEXT,
  exit_code   INTEGER,
  duration_ms INTEGER,
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_favorite BOOLEAN DEFAULT 0,
  tags        TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_pane ON command_history(pane_id);
CREATE INDEX IF NOT EXISTS idx_history_executed ON command_history(executed_at DESC);

CREATE TABLE IF NOT EXISTS snippets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  command     TEXT NOT NULL,
  description TEXT,
  shortcut    TEXT
);

CREATE TABLE IF NOT EXISTS secrets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scope         TEXT NOT NULL,
  name          TEXT NOT NULL,
  ciphertext    BLOB NOT NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at  DATETIME,
  UNIQUE(scope, name)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  layout_json TEXT NOT NULL,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
