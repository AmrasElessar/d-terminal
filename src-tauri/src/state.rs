// D-Terminal uygulama state'i.
//
// Tauri `manage()` ile lib.rs setup içinde register edilir; command'lar
// `tauri::State<AppState>` ile alır.

use crate::sidecar::manager::SidecarManager;
use crate::storage::Storage;
use std::sync::Arc;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub sidecar: Arc<SidecarManager>,
}

impl AppState {
    pub fn new(storage: Arc<Storage>, sidecar: Arc<SidecarManager>) -> Self {
        Self { storage, sidecar }
    }
}
