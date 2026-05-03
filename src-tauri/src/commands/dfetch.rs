// DFetch — sistem bilgi toplama komutu (architecture-v1.1.md §12, ADR-0009).
//
// Neofetch paritesi: os/kernel/host/cpu/cores/ram/swap/uptime/boot/version
// + shell/terminal/desktop/theme/locale/timezone/disks/gpus/screen/battery.
//
// Windows-spesifik alanlar (gpu/battery/screen/theme): hata olursa None/boş döner,
// frontend o alanı atlar — neofetch davranışıyla aynı.

use chrono::Local;
use serde::Serialize;
use sysinfo::{Disks, System};

#[derive(Debug, Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub fs_type: String,
    pub total: u64,
    pub used: u64,
}

#[derive(Debug, Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub vram: u64,
    pub driver_version: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ScreenInfo {
    pub width: u32,
    pub height: u32,
    pub scale: f32,
}

#[derive(Debug, Serialize)]
pub struct BatteryInfo {
    pub percent: u32,
    pub charging: bool,
    pub full: bool,
}

#[derive(Debug, Serialize)]
pub struct NetIface {
    pub name: String,
    pub ip: String,
    pub family: &'static str, // "v4" veya "v6"
}

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub os: String,
    pub kernel: String,
    pub hostname: String,
    pub cpu: String,
    pub cores: usize,
    pub ram_used: u64,
    pub ram_total: u64,
    pub swap_used: u64,
    pub swap_total: u64,
    pub uptime_secs: u64,
    pub boot_time_unix: u64,
    pub d_terminal_version: String,

    // --- Extended (neofetch paritesi) ---
    pub shell: String,
    pub terminal: String,
    pub desktop: String,
    pub theme: String,
    pub locale: String,
    pub timezone: String,
    pub disks: Vec<DiskInfo>,
    pub gpus: Vec<GpuInfo>,
    pub screen: Option<ScreenInfo>,
    pub battery: Option<BatteryInfo>,
    pub local_ips: Vec<NetIface>,
}

#[tauri::command]
pub fn dfetch_get() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_all();
    SystemInfo {
        os: System::long_os_version().unwrap_or_else(|| "Unknown".into()),
        kernel: System::kernel_version().unwrap_or_else(|| "?".into()),
        hostname: System::host_name().unwrap_or_else(|| "localhost".into()),
        cpu: sys
            .cpus()
            .first()
            .map(|c| c.brand().trim().to_string())
            .unwrap_or_else(|| "Unknown CPU".into()),
        cores: sys.physical_core_count().unwrap_or(0),
        ram_used: sys.used_memory(),
        ram_total: sys.total_memory(),
        swap_used: sys.used_swap(),
        swap_total: sys.total_swap(),
        uptime_secs: System::uptime(),
        boot_time_unix: System::boot_time(),
        d_terminal_version: env!("CARGO_PKG_VERSION").to_string(),

        shell: detect_shell(),
        terminal: format!("D-Terminal {}", env!("CARGO_PKG_VERSION")),
        desktop: detect_desktop(),
        theme: detect_theme(),
        locale: sys_locale::get_locale().unwrap_or_else(|| "C".into()),
        timezone: Local::now().format("%Z (UTC%:z)").to_string(),
        disks: collect_disks(),
        gpus: collect_gpus(),
        screen: detect_screen(),
        battery: detect_battery(),
        local_ips: collect_local_ips(),
    }
}

/// Yerel IP toplama — public IP'ye dokunulmaz (offline-first, KVKK/GDPR).
/// Loopback (127.x, ::1) ve link-local (169.254.x) hariç tutulur.
fn collect_local_ips() -> Vec<NetIface> {
    use std::net::IpAddr;
    let Ok(ifaces) = local_ip_address::list_afinet_netifas() else {
        return Vec::new();
    };
    ifaces
        .into_iter()
        .filter_map(|(name, ip)| {
            let (family, is_useful) = match ip {
                IpAddr::V4(v4) => {
                    let octets = v4.octets();
                    let useful = !v4.is_loopback() && octets[0] != 169;
                    ("v4", useful)
                }
                IpAddr::V6(v6) => ("v6", !v6.is_loopback() && !v6.is_unspecified()),
            };
            if !is_useful {
                return None;
            }
            Some(NetIface {
                name,
                ip: ip.to_string(),
                family,
            })
        })
        .collect()
}

fn detect_shell() -> String {
    // Windows: ComSpec → cmd.exe path. PowerShell sürümü subprocess gerek (atlıyoruz).
    // Unix-vari: SHELL env.
    if let Ok(shell) = std::env::var("SHELL") {
        return std::path::Path::new(&shell)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(String::from)
            .unwrap_or(shell);
    }
    if let Ok(comspec) = std::env::var("ComSpec").or_else(|_| std::env::var("COMSPEC")) {
        return std::path::Path::new(&comspec)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(String::from)
            .unwrap_or(comspec);
    }
    "unknown".into()
}

fn detect_desktop() -> String {
    #[cfg(target_os = "windows")]
    {
        return "Windows Shell · DWM".into();
    }
    #[cfg(target_os = "macos")]
    {
        return "Aqua".into();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        return std::env::var("XDG_CURRENT_DESKTOP")
            .or_else(|_| std::env::var("DESKTOP_SESSION"))
            .unwrap_or_else(|_| "Unknown".into());
    }
    #[allow(unreachable_code)]
    "Unknown".into()
}

#[cfg(target_os = "windows")]
fn detect_theme() -> String {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    if let Ok(key) = hkcu.open_subkey(path) {
        if let Ok(apps_light) = key.get_value::<u32, _>("AppsUseLightTheme") {
            return if apps_light == 1 {
                "Light".into()
            } else {
                "Dark".into()
            };
        }
    }
    "Unknown".into()
}

#[cfg(not(target_os = "windows"))]
fn detect_theme() -> String {
    "Unknown".into()
}

fn collect_disks() -> Vec<DiskInfo> {
    let disks = Disks::new_with_refreshed_list();
    disks
        .iter()
        .map(|d| {
            let total = d.total_space();
            let used = total.saturating_sub(d.available_space());
            DiskInfo {
                name: d.name().to_string_lossy().into_owned(),
                mount_point: d.mount_point().to_string_lossy().into_owned(),
                fs_type: d.file_system().to_string_lossy().into_owned(),
                total,
                used,
            }
        })
        .collect()
}

#[cfg(target_os = "windows")]
fn detect_screen() -> Option<ScreenInfo> {
    use windows::Win32::Graphics::Gdi::{
        GetDC, GetDeviceCaps, ReleaseDC, HORZRES, LOGPIXELSX, VERTRES,
    };

    unsafe {
        let dc = GetDC(None);
        if dc.is_invalid() {
            return None;
        }
        let dpi = GetDeviceCaps(dc, LOGPIXELSX);
        let w = GetDeviceCaps(dc, HORZRES);
        let h = GetDeviceCaps(dc, VERTRES);
        ReleaseDC(None, dc);
        if w <= 0 || h <= 0 {
            return None;
        }
        Some(ScreenInfo {
            width: w as u32,
            height: h as u32,
            scale: if dpi > 0 { dpi as f32 / 96.0 } else { 1.0 },
        })
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_screen() -> Option<ScreenInfo> {
    None
}

#[cfg(target_os = "windows")]
fn collect_gpus() -> Vec<GpuInfo> {
    use std::collections::HashMap;
    use wmi::{COMLibrary, Variant, WMIConnection};

    let mut out = Vec::new();
    let Ok(com) = COMLibrary::new() else {
        return out;
    };
    let Ok(con) = WMIConnection::new(com) else {
        return out;
    };
    let query = "SELECT Name, AdapterRAM, DriverVersion FROM Win32_VideoController";
    let Ok(rows): Result<Vec<HashMap<String, Variant>>, _> = con.raw_query(query) else {
        return out;
    };
    for row in rows {
        let name = match row.get("Name") {
            Some(Variant::String(s)) => s.clone(),
            _ => "Unknown GPU".into(),
        };
        let vram = match row.get("AdapterRAM") {
            Some(Variant::UI4(n)) => *n as u64,
            Some(Variant::I4(n)) if *n > 0 => *n as u64,
            // u32 wraparound: 4 GB+ kartlarda WMI eksi sayı verir, kabaca düzelt
            Some(Variant::I4(n)) => (*n as u32) as u64,
            _ => 0,
        };
        let driver = match row.get("DriverVersion") {
            Some(Variant::String(s)) => Some(s.clone()),
            _ => None,
        };
        if !name.is_empty() {
            out.push(GpuInfo {
                name,
                vram,
                driver_version: driver,
            });
        }
    }
    out
}

#[cfg(not(target_os = "windows"))]
fn collect_gpus() -> Vec<GpuInfo> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn detect_battery() -> Option<BatteryInfo> {
    use std::collections::HashMap;
    use wmi::{COMLibrary, Variant, WMIConnection};

    let com = COMLibrary::new().ok()?;
    let con = WMIConnection::new(com).ok()?;
    let query = "SELECT EstimatedChargeRemaining, BatteryStatus FROM Win32_Battery";
    let rows: Vec<HashMap<String, Variant>> = con.raw_query(query).ok()?;
    let row = rows.into_iter().next()?;

    let percent = match row.get("EstimatedChargeRemaining") {
        Some(Variant::UI1(n)) => *n as u32,
        Some(Variant::UI2(n)) => *n as u32,
        Some(Variant::UI4(n)) => *n,
        Some(Variant::I4(n)) => (*n).max(0) as u32,
        _ => return None,
    };
    let status = match row.get("BatteryStatus") {
        Some(Variant::UI1(n)) => *n as u16,
        Some(Variant::UI2(n)) => *n,
        Some(Variant::UI4(n)) => *n as u16,
        Some(Variant::I4(n)) => *n as u16,
        _ => 0,
    };
    // Win32_Battery.BatteryStatus: 1=Other(discharging), 2=Unknown, 3=Fully Charged,
    // 4=Low, 5=Critical, 6=Charging, 7=Charging+High, 8=Charging+Low, 9=Charging+Critical,
    // 10=Undefined, 11=Partially Charged
    let charging = matches!(status, 6..=9);
    let full = status == 3;
    Some(BatteryInfo {
        percent,
        charging,
        full,
    })
}

#[cfg(not(target_os = "windows"))]
fn detect_battery() -> Option<BatteryInfo> {
    None
}
