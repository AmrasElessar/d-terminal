// Pencere efekti runtime kontrolü.
//
// Settings'te kullanıcı vibrancy seçeneğini değiştirdiğinde frontend bu
// command'ı çağırır. Tauri pencere referansı ile Mica/Acrylic/None geçişi
// runtime'da uygulanır.

use tauri::{AppHandle, Manager};

#[tauri::command]
#[allow(unused_variables)]
pub fn window_set_vibrancy(app: AppHandle, mode: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use window_vibrancy::{apply_acrylic, apply_mica, clear_acrylic, clear_mica};
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "main window not found".to_string())?;

        // Mevcut vibrancy'yi temizle (idempotent — uygulanmamışsa hata verebilir, yutulur).
        let _ = clear_mica(&window);
        let _ = clear_acrylic(&window);

        match mode.as_str() {
            "mica" | "auto" => {
                apply_mica(&window, Some(true)).map_err(|e| format!("Mica apply failed: {e}"))?;
                tracing::info!("vibrancy switched: Mica");
            }
            "acrylic" => {
                apply_acrylic(&window, Some((10, 14, 26, 180)))
                    .map_err(|e| format!("Acrylic apply failed: {e}"))?;
                tracing::info!("vibrancy switched: Acrylic");
            }
            "none" => {
                tracing::info!("vibrancy switched: none (transparent, no material)");
            }
            other => return Err(format!("unknown vibrancy mode: {other}")),
        }
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = mode;
        Ok(())
    }
}
