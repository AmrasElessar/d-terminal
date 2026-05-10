// ProcessJail için runtime kontrol komutları.
//
// Settings UI'daki "Suppress child console windows" toggle'ı bu komutu
// çağırarak jail davranışını anlık değiştirir — uygulama yeniden
// başlatılmadan etki eder. Mevcut çalışan child process'ler etkilenmez
// (doğru davranış: jail stateful tracker değil), sadece toggle sonrası
// spawn'lar.

use crate::state::AppState;
use tauri::State;

/// Console window suppression toggle'ını runtime'da değiştir.
/// Frontend `Settings → Privacy & Performance → Suppress child consoles`
/// watch'unda çağrılır.
#[tauri::command]
pub fn process_set_suppress_consoles(state: State<'_, AppState>, val: bool) {
    state.jail.set_suppress_consoles(val);
    tracing::info!(suppress = val, "process jail: suppress_consoles toggled");
}

/// Mevcut suppress durumu — UI senkronizasyonu için. Settings store load
/// sırasında backend ile doğrulama yapabilir.
#[tauri::command]
pub fn process_suppress_consoles(state: State<'_, AppState>) -> bool {
    state.jail.suppress_consoles()
}

/// Job Object aktif mi (Windows + yaratım başarılı). Settings UI'da
/// "Kill-on-close koruması: aktif/devre dışı" rozetini render etmek için.
#[tauri::command]
pub fn process_jail_active(state: State<'_, AppState>) -> bool {
    state.jail.has_job()
}
