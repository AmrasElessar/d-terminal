// Windows DPAPI tabanlı SecretStore.
//
// Bkz. ADR-0002. Per-user binding (CRYPTPROTECT_LOCAL_MACHINE = 0).
// Plaintext zeroize ile temizlenir.
//
// Entropy katmanı (v0.9.4+): DPAPI'nin per-user master key'inin yanı sıra
// uygulamaya özel sabit bir entropy buffer'ı `CryptProtectData`'nın opsiyonel
// pOptionalEntropy parametresine geçilir. Bu, aynı kullanıcı altında çalışan
// başka bir process'in (mimikatz lsadump, başka bir uygulama) ciphertext'i
// alıp `CryptUnprotectData(NULL, ...)` ile decrypt etmesini engeller —
// saldırgan D-Terminal binary'sinden entropy buffer'ını çıkarmak zorunda kalır.
//
// Migration: v0.9.3'e kadar yazılmış blob'lar entropy=NULL ile şifrelendi.
// `unprotect` önce yeni entropy ile dener; başarısızsa NULL fallback dener.
// NULL ile başarılı olan secret retrieve sırasında otomatik upgrade edilir
// (caller seviyesinde re-store mekanizması). v1.0'da NULL fallback kaldırılır.

use crate::error::{AppError, AppResult};
use crate::secrets::SecretStore;
use crate::storage::secrets::{SecretRow, SecretsRepo};
use std::sync::Arc;
use windows::Win32::Foundation::{LocalFree, HLOCAL};
use windows::Win32::Security::Cryptography::{
    CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB,
};
use zeroize::Zeroizing;

/// Uygulama-özel entropy buffer'ı. Static — değiştirilirse mevcut tüm secret'lar
/// erişilemez hale gelir; yalnızca controlled migration ile rotate edilebilir.
const APP_ENTROPY: &[u8] = b"D-Terminal-v1-secrets-entropy-2026-05";

pub struct DpapiStore {
    repo: Arc<SecretsRepo>,
}

impl DpapiStore {
    pub fn new(repo: Arc<SecretsRepo>) -> Self {
        Self { repo }
    }

    fn protect(plaintext: &[u8]) -> AppResult<Vec<u8>> {
        let len: u32 = plaintext
            .len()
            .try_into()
            .map_err(|_| AppError::Secret("plaintext too large for DPAPI".into()))?;
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: len,
            pbData: plaintext.as_ptr() as *mut u8,
        };
        let entropy = CRYPT_INTEGER_BLOB {
            cbData: APP_ENTROPY.len() as u32,
            pbData: APP_ENTROPY.as_ptr() as *mut u8,
        };
        let mut out_blob = CRYPT_INTEGER_BLOB::default();
        // SAFETY: in_blob & entropy ömrü çağrı süresince geçerli; out_blob LocalFree ile temizlenir.
        unsafe {
            CryptProtectData(&in_blob, None, Some(&entropy), None, None, 0, &mut out_blob)
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

    /// Düşük seviye unprotect — verilen entropy ile dener. None ise legacy
    /// (v0.9.3 öncesi) blob'ları decode eder.
    fn unprotect_with(ciphertext: &[u8], entropy: Option<&[u8]>) -> AppResult<Zeroizing<Vec<u8>>> {
        let cipher_len: u32 = ciphertext
            .len()
            .try_into()
            .map_err(|_| AppError::Secret("ciphertext too large for DPAPI".into()))?;
        let in_blob = CRYPT_INTEGER_BLOB {
            cbData: cipher_len,
            pbData: ciphertext.as_ptr() as *mut u8,
        };
        let entropy_blob = entropy.map(|e| CRYPT_INTEGER_BLOB {
            cbData: e.len() as u32,
            pbData: e.as_ptr() as *mut u8,
        });
        let entropy_ptr: Option<*const CRYPT_INTEGER_BLOB> =
            entropy_blob.as_ref().map(|b| b as *const _);
        let mut out_blob = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(&in_blob, None, entropy_ptr, None, None, 0, &mut out_blob)
                .map_err(|e| AppError::Secret(format!("CryptUnprotectData: {e}")))?;
        }
        // SAFETY: out_blob.pbData DPAPI tarafından alloc edildi; LocalFree ile
        // temizlenecek. Önce plaintext'i Zeroizing<Vec<u8>>'a kopyala, sonra
        // sistem buffer'ını da volatile-zero ile sil — DPAPI'nin döndürdüğü
        // bellek bölgesinde plaintext residue kalmasın.
        let plaintext = unsafe {
            let slice = std::slice::from_raw_parts_mut(out_blob.pbData, out_blob.cbData as usize);
            let v = slice.to_vec();
            for b in slice.iter_mut() {
                std::ptr::write_volatile(b, 0);
            }
            v
        };
        let zeroized = Zeroizing::new(plaintext);
        unsafe {
            let _ = LocalFree(HLOCAL(out_blob.pbData as *mut _));
        }
        Ok(zeroized)
    }

    /// İki aşamalı unprotect: önce entropy ile, başarısızsa legacy NULL ile.
    /// Legacy başarılı olursa caller upgrade etmek isteyebilir (re-store).
    /// Tuple: (plaintext, used_legacy_path)
    fn unprotect_with_fallback(ciphertext: &[u8]) -> AppResult<(Zeroizing<Vec<u8>>, bool)> {
        match Self::unprotect_with(ciphertext, Some(APP_ENTROPY)) {
            Ok(p) => Ok((p, false)),
            Err(_) => {
                // Legacy v0.9.3 blob'u (entropy=NULL) — bir kerelik decode +
                // caller tarafında re-store ile upgrade edilebilir.
                let p = Self::unprotect_with(ciphertext, None)?;
                tracing::info!("DPAPI legacy blob decoded (entropy=NULL); re-store önerilir");
                Ok((p, true))
            }
        }
    }
}

impl SecretStore for DpapiStore {
    fn store(&self, scope: &str, name: &str, value: Zeroizing<Vec<u8>>) -> AppResult<()> {
        // value `Zeroizing<Vec<u8>>` — fonksiyon sonunda otomatik sıfırlanır.
        let cipher = Self::protect(&value)?;
        self.repo.upsert(scope, name, &cipher)?;
        Ok(())
    }

    fn retrieve(&self, scope: &str, name: &str) -> AppResult<Zeroizing<Vec<u8>>> {
        let blob = self
            .repo
            .get_blob(scope, name)?
            .ok_or_else(|| AppError::Secret(format!("not found: {scope}/{name}")))?;
        let (plaintext, was_legacy) = Self::unprotect_with_fallback(&blob)?;
        if was_legacy {
            // Otomatik upgrade — yeni entropy ile re-encrypt edip DB'yi güncelle.
            // Bu yol bir kerelik geçişte tetiklenir; sonraki retrieve'lerde
            // doğrudan entropy ile decode edilir.
            if let Ok(new_cipher) = Self::protect(&plaintext) {
                if let Err(e) = self.repo.upsert(scope, name, &new_cipher) {
                    tracing::warn!(error = %e, "legacy DPAPI blob upgrade failed (retrieve OK)");
                }
            }
        }
        Ok(plaintext)
    }

    fn delete(&self, scope: &str, name: &str) -> AppResult<()> {
        self.repo.delete(scope, name)
    }

    fn list(&self, scope: &str) -> AppResult<Vec<SecretRow>> {
        self.repo.list(scope)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // round-trip test'leri Windows'ta gerçek DPAPI çağrısı yapar; CI Windows
    // runner'larında geçer.
    #[cfg(target_os = "windows")]
    #[test]
    fn protect_unprotect_roundtrip_ascii() {
        let plaintext = b"sk-test-1234567890ABCDEF";
        let cipher = DpapiStore::protect(plaintext).expect("protect");
        let (out, was_legacy) = DpapiStore::unprotect_with_fallback(&cipher).expect("unprotect");
        assert_eq!(&out[..], &plaintext[..]);
        assert!(!was_legacy, "yeni blob legacy yolundan dönmemeli");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn protect_unprotect_roundtrip_unicode() {
        // Türkçe + emoji round-trip — utf-8 byte stream
        let plaintext = "şifre 🔐 güvenli".as_bytes();
        let cipher = DpapiStore::protect(plaintext).expect("protect");
        let (out, _) = DpapiStore::unprotect_with_fallback(&cipher).expect("unprotect");
        assert_eq!(&out[..], plaintext);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn unprotect_with_wrong_entropy_fails() {
        let plaintext = b"secret-data";
        let cipher = DpapiStore::protect(plaintext).expect("protect");
        // Yanlış entropy ile direkt çağrı → fail
        let r = DpapiStore::unprotect_with(&cipher, Some(b"different-entropy"));
        assert!(r.is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn unprotect_handles_corrupt_blob() {
        let bad = vec![0u8; 32];
        let r = DpapiStore::unprotect_with_fallback(&bad);
        assert!(r.is_err(), "bozuk blob hata vermeli");
    }
}
