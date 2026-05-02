// Secret komutları. Plaintext frontend'e ASLA dönmez — bunun yerine
// AI proxy komutları (`ai_proxy.rs`) içinde decrypt edilip provider'a gönderilir.
//
// Frontend'in tek görevi: key kaydet, listele, sil. Çözme yok.

use crate::error::AppResult;
use crate::secrets::SecretStore;
use crate::state::AppState;
use crate::storage::secrets::SecretRow;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub fn secrets_store(
    state: State<'_, AppState>,
    scope: String,
    name: String,
    value: String,
) -> AppResult<()> {
    let store = build_store(&state);
    store.store(&scope, &name, value.as_bytes())
}

#[tauri::command]
pub fn secrets_delete(state: State<'_, AppState>, scope: String, name: String) -> AppResult<()> {
    let store = build_store(&state);
    store.delete(&scope, &name)
}

#[tauri::command]
pub fn secrets_list(state: State<'_, AppState>, scope: String) -> AppResult<Vec<SecretRow>> {
    let store = build_store(&state);
    store.list(&scope)
}

/// Secret'in mevcut olup olmadığını döner — değeri DEĞİL.
#[tauri::command]
pub fn secrets_has(state: State<'_, AppState>, scope: String, name: String) -> AppResult<bool> {
    let rows = build_store(&state).list(&scope)?;
    Ok(rows.iter().any(|r| r.name == name))
}

fn build_store(state: &State<'_, AppState>) -> Arc<dyn SecretStore> {
    crate::secrets::build(Arc::new(crate::storage::secrets::SecretsRepo::new(
        state.storage.pool().clone(),
    )))
}
