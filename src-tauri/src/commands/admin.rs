// Yönetici (UAC elevation) komutları.
//
// - `admin_is_elevated`: mevcut process admin token'ına sahip mi (TokenElevation)
// - `admin_restart_elevated`: ShellExecute "runas" verb'ü ile kendini relaunch
//   eder, UAC prompt'u tetikler, mevcut instance'ı kapatır
// - `admin_open_dev_settings`: ms-settings:developers — Win 11 23H2+ sudo
//   togglesi burada

use crate::error::{AppError, AppResult};

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn admin_is_elevated() -> bool {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::{
        GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY,
    };
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token = HANDLE::default();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).is_err() {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION::default();
        let mut size: u32 = 0;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            Some(&mut elevation as *mut _ as *mut _),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut size,
        )
        .is_ok();
        let _ = CloseHandle(token);
        ok && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn admin_is_elevated() -> bool {
    false
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub fn admin_restart_elevated(app: tauri::AppHandle) -> AppResult<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let exe =
        std::env::current_exe().map_err(|e| AppError::Internal(format!("current_exe: {e}")))?;
    // UTF-16 + null terminator
    let exe_w: Vec<u16> = exe
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let runas_w: Vec<u16> = "runas\0".encode_utf16().collect();

    unsafe {
        let hinst = ShellExecuteW(
            None,
            PCWSTR(runas_w.as_ptr()),
            PCWSTR(exe_w.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        // ShellExecuteW: dönen HINSTANCE > 32 başarı, ≤32 hata kodu (SE_ERR_*).
        let code = hinst.0 as isize;
        if code <= 32 {
            return Err(AppError::Internal(format!(
                "ShellExecuteW runas failed (code {code})"
            )));
        }
    }

    // UAC prompt user'ı bekler; biz mevcut instance'ı kısa gecikme ile kapatırız.
    // Eğer kullanıcı UAC'i reddederse yeni process açılmayacak ama biz zaten
    // çağrıyı yaptık — relaunch bizim sorumluluğumuz değil. Kullanıcı reddederse
    // mevcut instance açık kalsın diye exit'i kısa Sleep sonrası async yapıyoruz.
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(600));
        app.exit(0);
    });
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn admin_restart_elevated(_app: tauri::AppHandle) -> AppResult<()> {
    Err(AppError::NotImplemented("admin restart only on Windows"))
}

/// Windows Settings → For developers sayfasını açar. Win 11 23H2+ kullanıcılar
/// burada built-in `sudo` toggle'ını bulur. Win 10'da aynı sayfa açılır ama
/// sudo toggle yoktur (kullanıcı gsudo kurabilir).
#[cfg(target_os = "windows")]
#[tauri::command]
pub fn admin_open_dev_settings() -> AppResult<()> {
    std::process::Command::new("cmd")
        .args(["/c", "start", "ms-settings:developers"])
        .spawn()
        .map_err(|e| AppError::Internal(format!("open settings: {e}")))?;
    Ok(())
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn admin_open_dev_settings() -> AppResult<()> {
    Err(AppError::NotImplemented("only windows"))
}
