use crate::error::AppResult;
use crate::state::AppState;
use crate::storage::snippets::{NewSnippet, Snippet};
use tauri::State;

#[tauri::command]
pub fn snippet_list(state: State<'_, AppState>) -> AppResult<Vec<Snippet>> {
    state.storage.snippets.list()
}

#[tauri::command]
pub fn snippet_upsert(state: State<'_, AppState>, snippet: NewSnippet) -> AppResult<i64> {
    state.storage.snippets.upsert(snippet)
}

#[tauri::command]
pub fn snippet_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    state.storage.snippets.delete(id)
}

#[tauri::command]
pub fn snippet_get(state: State<'_, AppState>, id: i64) -> AppResult<Option<Snippet>> {
    state.storage.snippets.get(id)
}
