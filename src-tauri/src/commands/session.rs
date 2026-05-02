use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::session::SessionRecord;
use tauri::State;

#[tauri::command]
pub fn session_save(state: State<'_, AppState>, name: String, layout_json: String) -> AppResult<i64> {
    state.storage.session.save(&name, &layout_json)
}

#[tauri::command]
pub fn session_load(state: State<'_, AppState>, name: String) -> AppResult<Option<SessionRecord>> {
    state.storage.session.load(&name)
}

#[tauri::command]
pub fn session_list(state: State<'_, AppState>) -> AppResult<Vec<SessionRecord>> {
    state.storage.session.list()
}

#[tauri::command]
pub fn session_delete(state: State<'_, AppState>, name: String) -> AppResult<()> {
    state.storage.session.delete(&name)
}
