// Storage layer — rusqlite + r2d2 connection pool, WAL mode (ADR-0003).
//
// Tek SQLite dosyası: %APPDATA%\D-Terminal\dterminal.db
// Migration runner: refinery (`migrations/V*.sql`).

pub mod db;
pub mod history;
pub mod migrations;
pub mod secrets;
pub mod session;
pub mod settings;

pub use db::Storage;
