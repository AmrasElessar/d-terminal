use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::history::{HistoryEntry, HistoryQuery, NewHistoryEntry};
use tauri::State;

#[tauri::command]
pub fn history_add(state: State<'_, AppState>, entry: NewHistoryEntry) -> AppResult<i64> {
    state.storage.history.add(entry)
}

#[tauri::command]
pub fn history_search(
    state: State<'_, AppState>,
    query: HistoryQuery,
) -> AppResult<Vec<HistoryEntry>> {
    state.storage.history.search(query)
}

#[tauri::command]
pub fn history_toggle_favorite(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.storage.history.toggle_favorite(id)
}

#[tauri::command]
pub fn history_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.storage.history.delete(id)
}
