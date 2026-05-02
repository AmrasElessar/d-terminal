// SecretStore trait + platform impl seçimi.
//
// Bkz. ADR-0002 (docs/adr/0002-secret-storage-dpapi.md).
//
// Plaintext anahtar bellekte zeroize edilir. Cross-platform port için trait
// stabil — yeni backend `dpapi.rs` benzeri tek dosyada eklenir.

#[cfg(target_os = "windows")]
pub mod dpapi;

#[cfg(not(target_os = "windows"))]
use crate::error::AppError;
use crate::error::AppResult;
use crate::storage::secrets::{SecretRow, SecretsRepo};
use std::sync::Arc;
use zeroize::Zeroizing;

pub trait SecretStore: Send + Sync {
    /// Düz değeri şifreleyip ilgili scope/name altında saklar.
    fn store(&self, scope: &str, name: &str, value: &[u8]) -> AppResult<()>;
    /// Şifreli blob'u çözüp düz değeri döndürür. Zeroizing ile bellek temizlenir.
    fn retrieve(&self, scope: &str, name: &str) -> AppResult<Zeroizing<Vec<u8>>>;
    fn delete(&self, scope: &str, name: &str) -> AppResult<()>;
    fn list(&self, scope: &str) -> AppResult<Vec<SecretRow>>;
}

#[cfg(target_os = "windows")]
pub fn build(repo: Arc<SecretsRepo>) -> Arc<dyn SecretStore> {
    Arc::new(dpapi::DpapiStore::new(repo))
}

#[cfg(not(target_os = "windows"))]
pub fn build(_repo: Arc<SecretsRepo>) -> Arc<dyn SecretStore> {
    Arc::new(NoopStore)
}

#[cfg(not(target_os = "windows"))]
struct NoopStore;

#[cfg(not(target_os = "windows"))]
impl SecretStore for NoopStore {
    fn store(&self, _: &str, _: &str, _: &[u8]) -> AppResult<()> {
        Err(AppError::NotImplemented(
            "secret store: Windows-only in v1.0; macOS/Linux Keychain port pending",
        ))
    }
    fn retrieve(&self, _: &str, _: &str) -> AppResult<Zeroizing<Vec<u8>>> {
        Err(AppError::NotImplemented("secret store: Windows-only"))
    }
    fn delete(&self, _: &str, _: &str) -> AppResult<()> {
        Err(AppError::NotImplemented("secret store: Windows-only"))
    }
    fn list(&self, _: &str) -> AppResult<Vec<SecretRow>> {
        Ok(Vec::new())
    }
}
