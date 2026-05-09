// D-Terminal uygulama state'i.
//
// Tauri `manage()` ile lib.rs setup içinde register edilir; command'lar
// `tauri::State<AppState>` ile alır.

use crate::sidecar::manager::SidecarManager;
use crate::storage::Storage;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::oneshot;

pub struct AppState {
    pub storage: Arc<Storage>,
    pub sidecar: Arc<SidecarManager>,
    /// Aktif AI streaming task'larının abort handle'ları. Frontend
    /// `ai_abort_stream(stream_id)` çağırınca buradaki sender'a `()` gider;
    /// `ai_chat_stream` `tokio::select!` ile chat future'ını drop eder ve
    /// reqwest HTTP bağlantısını kapatır → token harcaması durur.
    pub ai_aborts: Arc<Mutex<HashMap<u64, oneshot::Sender<()>>>>,
}

impl AppState {
    pub fn new(storage: Arc<Storage>, sidecar: Arc<SidecarManager>) -> Self {
        Self {
            storage,
            sidecar,
            ai_aborts: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}
