// Windows DPAPI tabanlı SecretStore.
//
// Bkz. ADR-0002. Per-user binding (CRYPTPROTECT_LOCAL_MACHINE = 0).
// Plaintext zeroize ile temizlenir.

use crate::error::{AppError, AppResult};
use crate::secrets::SecretStore;
use crate::storage::secrets::{SecretRow, SecretsRepo};
use std::sync::Arc;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};
use zeroize::Zeroizing;

pub struct DpapiStore {
    repo: Arc<SecretsRepo>,
}

impl DpapiStore {
    pub fn new(repo: Arc<SecretsRepo>) -> Self {
        Self { repo }
    }

    fn protect(plaintext: &[u8]) -> AppResult<Vec<u8>> {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: plaintext.len() as u32,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB::default();
        // SAFETY: in_blob ömrü çağrı süresince geçerli; out_blob LocalFree ile temizlenir.
        unsafe {
            CryptProtectData(&in_blob, None, None, None, None, 0, &mut out_blob)
                .map_err(|e| AppError::Secret(format!("CryptProtectData: {e}")))?;
        }
        let result = unsafe {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
        };
        unsafe {
            let _ = LocalFree(HLOCAL(out_blob.pbData as *mut _));
        }
        Ok(result)
    }

    fn unprotect(ciphertext: &[u8]) -> AppResult<Zeroizing<Vec<u8>>> {
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: ciphertext.len() as u32,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(&in_blob, None, None, None, None, 0, &mut out_blob)
                .map_err(|e| AppError::Secret(format!("CryptUnprotectData: {e}")))?;
        }
        let plaintext = unsafe {
            std::slice::from_raw_parts(out_blob.pbData, out_blob.cbData as usize).to_vec()
        };
        unsafe {
            let _ = LocalFree(HLOCAL(out_blob.pbData as *mut _));
        }
        Ok(Zeroizing::new(plaintext))
    }
}

impl SecretStore for DpapiStore {
    fn store(&self, scope: &str, name: &str, value: &[u8]) -> AppResult<()> {
        let cipher = Self::protect(value)?;
        self.repo.upsert(scope, name, &cipher)?;
        Ok(())
    }

    fn retrieve(&self, scope: &str, name: &str) -> AppResult<Zeroizing<Vec<u8>>> {
        let blob = self
            .repo
            .get_blob(scope, name)?
            .ok_or_else(|| AppError::Secret(format!("not found: {scope}/{name}")))?;
        Self::unprotect(&blob)
    }

    fn delete(&self, scope: &str, name: &str) -> AppResult<()> {
        self.repo.delete(scope, name)
    }

    fn list(&self, scope: &str) -> AppResult<Vec<SecretRow>> {
        self.repo.list(scope)
    }
}
