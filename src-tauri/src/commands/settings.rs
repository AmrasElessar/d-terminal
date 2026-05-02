use crate::error::AppResult;
use crate::state::AppState;
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>, key: String) -> AppResult<Option<String>> {
    state.storage.settings.get(&key)
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, key: String, value: String) -> AppResult<()> {
    state.storage.settings.set(&key, &value)
}

#[tauri::command]
pub fn settings_delete(state: State<'_, AppState>, key: String) -> AppResult<()> {
    state.storage.settings.delete(&key)
}

#[tauri::command]
pub fn settings_all(state: State<'_, AppState>) -> AppResult<HashMap<String, String>> {
    state.storage.settings.all()
}
