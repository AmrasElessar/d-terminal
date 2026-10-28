// Secret komutları. Plaintext frontend'e ASLA dönmez — bunun yerine
// AI proxy komutları (`ai_proxy.rs`) içinde decrypt edilip provider'a gönderilir.
//
// Frontend'in tek görevi: key kaydet, listele, sil. Çözme yok.
//
// DPAPI + SQLite çağrıları blocking pool'da koşar (`run_blocking`) — UI
// thread'i bloklanmaz.

use crate::error::{run_blocking, AppResult};
use crate::state::AppState;
use crate::storage::secrets::SecretRow;
use tauri::State;
use zeroize::{Zeroize, Zeroizing};

#[tauri::command]
pub async fn secrets_store(
    state: State<'_, AppState>,
    scope: String,
    name: String,
    mut value: String,
) -> AppResult<()> {
    let storage = state.storage.clone();
    // String'i Vec<u8>'e taşı → Zeroizing kapsayıcısına al ki store sonrası
    // bellekten silinsin. `std::mem::take` + `into_bytes()` orijinal tamponu
    // devralır; `value` artık boş String'dir (zeroize çağrısı garanti amaçlı).
    let plaintext = Zeroizing::new(std::mem::take(&mut value).into_bytes());
    value.zeroize();
    run_blocking(move || {
        crate::secrets::for_storage(&storage).store(&scope, &name, plaintext)?;
        if scope == "ai_provider" {
            // Yeni key → endpoint bağını yeniden kur (bkz. commands::ai).
            crate::commands::ai::rebind_key_origin(&storage, &name, true);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn secrets_delete(
    state: State<'_, AppState>,
    scope: String,
    name: String,
) -> AppResult<()> {
    let storage = state.storage.clone();
    run_blocking(move || {
        crate::secrets::for_storage(&storage).delete(&scope, &name)?;
        if scope == "ai_provider" {
            crate::commands::ai::rebind_key_origin(&storage, &name, false);
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn secrets_list(state: State<'_, AppState>, scope: String) -> AppResult<Vec<SecretRow>> {
    let storage = state.storage.clone();
    run_blocking(move || crate::secrets::for_storage(&storage).list(&scope)).await
}

/// Secret'in mevcut olup olmadığını döner — değeri DEĞİL.
#[tauri::command]
pub async fn secrets_has(state: State<'_, AppState>, scope: String, name: String) -> AppResult<bool> {
    let storage = state.storage.clone();
    run_blocking(move || {
        let rows = crate::secrets::for_storage(&storage).list(&scope)?;
        Ok(rows.iter().any(|r| r.name == name))
    })
    .await
}
