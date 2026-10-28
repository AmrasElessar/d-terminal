use crate::error::{AppError, AppResult};
use crate::state::AppState;
use std::collections::HashMap;
use tauri::State;

/// `_` önekli key'ler backend'e ayrılmıştır (`_app_version` downgrade guard'ı,
/// `_ai_bound_origin.*` key-endpoint bağı). Webview bunları yazıp silemez:
/// ör. `settings_set('_app_version','99.0.0')` sonraki açılışta downgrade
/// guard'ını tetikleyip uygulamayı kalıcı olarak açılmaz hale getiriyordu.
fn ensure_not_reserved(key: &str) -> AppResult<()> {
    if key.starts_with('_') {
        return Err(AppError::InvalidArg(format!("reserved settings key: {key}")));
    }
    Ok(())
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    ensure_not_reserved(&key)?;
    state.storage.settings.get(&key)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    ensure_not_reserved(&key)?;
    state.storage.settings.set(&key, &value)
}

#[tauri::command]
pub fn settings_delete(state: State<'_, AppState>, key: String) -> AppResult<()> {
    ensure_not_reserved(&key)?;
    state.storage.settings.delete(&key)
}

#[tauri::command]
pub fn settings_all(state: State<'_, AppState>) -> AppResult<HashMap<String, String>> {
    let mut all = state.storage.settings.all()?;
    all.retain(|k, _| !k.starts_with('_'));
    Ok(all)
}

#[cfg(test)]
mod tests {
    use super::ensure_not_reserved;

    #[test]
    fn reserved_keys_rejected() {
        assert!(ensure_not_reserved("_app_version").is_err());
        assert!(ensure_not_reserved("_ai_bound_origin.custom").is_err());
    }

    #[test]
    fn normal_keys_allowed() {
        assert!(ensure_not_reserved("ui.theme").is_ok());
        assert!(ensure_not_reserved("triggers").is_ok());
    }
}
