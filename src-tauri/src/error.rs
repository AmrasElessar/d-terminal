// D-Terminal global hata tipi.
//
// Tauri command'lar `Result<T, AppError>` döner; serde ile frontend'e i18n
// key'i + opsiyonel detay olarak iletilir.

use serde::{Serialize, Serializer};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("pool: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("migration: {0}")]
    Migration(String),

    #[error("secret backend: {0}")]
    Secret(String),

    #[error("sidecar: {0}")]
    Sidecar(String),

    #[error("pane not found: {0}")]
    PaneNotFound(String),

    #[error("invalid argument: {0}")]
    InvalidArg(String),

    #[error("not implemented: {0}")]
    NotImplemented(&'static str),

    #[error("internal: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let kind = match self {
            AppError::Io(_) => "io",
            AppError::Sqlite(_) => "sqlite",
            AppError::Pool(_) => "pool",
            AppError::Migration(_) => "migration",
            AppError::Secret(_) => "secret",
            AppError::Sidecar(_) => "sidecar",
            AppError::PaneNotFound(_) => "pane_not_found",
            AppError::InvalidArg(_) => "invalid_arg",
            AppError::NotImplemented(_) => "not_implemented",
            AppError::Internal(_) => "internal",
        };
        let mut state = <S as Serializer>::serialize_struct(serializer, "AppError", 2)?;
        use serde::ser::SerializeStruct;
        state.serialize_field("kind", kind)?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

pub type AppResult<T> = std::result::Result<T, AppError>;

impl From<refinery::Error> for AppError {
    fn from(e: refinery::Error) -> Self {
        AppError::Migration(e.to_string())
    }
}

impl From<crate::sidecar::protocol::ProtocolError> for AppError {
    fn from(e: crate::sidecar::protocol::ProtocolError) -> Self {
        AppError::Sidecar(e.to_string())
    }
}
