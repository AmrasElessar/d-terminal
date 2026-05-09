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

#[derive(Debug, Serialize, Clone)]
pub struct BatteryInfo {
    pub percent: u32,
    pub charging: bool,
    pub full: bool,
    /// Pilden çalışırken kalan tahmini süre (dakika). AC'ye bağlıyken veya
    /// sistemce hesaplanamadığında None.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_remaining_min: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct NetIface {
    pub name: String,
    pub ip: String,
    pub family: &'static str, // "v4" veya "v6"
    /// MAC adresi — `XX:XX:XX:XX:XX:XX`. Bilinmiyorsa None (loopback, tap vb.).
    /// Frontend bu değeri varsayılan maskeli gösterir.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mac: Option<String>,
    /// Sistemin internete çıkış için seçtiği interface (default route source).
    /// `local_ip_address::local_ip()` ile eşleştirme yapılır.
    pub is_primary: bool,
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
    /// Mantıksal işlemci sayısı (SMT/HT dahil thread sayısı). Modern CPU'larda
    /// `cores` (fiziksel) ile ayrı tutulur — ör. 8C/16T veya hybrid 12C/20T.
    pub logical_cores: usize,
    /// Hybrid CPU (Intel 12th+ veya benzeri) tespit edilirse (P-core, E-core).
    /// Tüm core'lar aynı efficiency class'ta ise None.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cpu_hybrid: Option<HybridCores>,
}

#[derive(Debug, Serialize)]
pub struct HybridCores {
    pub p_cores: u32,
    pub e_cores: u32,
}

#[tauri::command]
pub async fn dfetch_get() -> SystemInfo {
    // sysinfo `System::new_all()` Windows'ta tüm process listesi + tüm CPU/disk/
    // network state'ini bir kerede tarar (500+ proses olan makinede 50 MB+
    // alloc, 100-300 ms CPU). Tauri main thread'i bloklanmasın diye
    // spawn_blocking ile worker thread'e taşı (git_stat.rs ile aynı pattern).
    tokio::task::spawn_blocking(dfetch_get_blocking)
        .await
        .unwrap_or_else(|_| dfetch_get_blocking())
}

fn dfetch_get_blocking() -> SystemInfo {
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
        logical_cores: sys.cpus().len(),
        cpu_hybrid: detect_hybrid_cpu(),
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

/// Yerel IP + MAC toplama — public IP'ye dokunulmaz (offline-first, KVKK/GDPR).
/// Loopback (127.x, ::1) ve link-local (169.254.x) hariç tutulur.
/// `is_primary`, sistemin internete çıkışta kullandığı IP ile eşleşen
/// interface için true olur.
fn collect_local_ips() -> Vec<NetIface> {
    use std::net::IpAddr;
    let Ok(ifaces) = local_ip_address::list_afinet_netifas() else {
        return Vec::new();
    };
    let primary_ip = local_ip_address::local_ip().ok();
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
            // MAC: yalnızca isimle eşleşirse — sanal/loopback için None döner.
            let mac = mac_address::mac_address_by_name(&name)
                .ok()
                .flatten()
                .map(|m| m.to_string());
            let is_primary = primary_ip.map(|p| p == ip).unwrap_or(false);
            Some(NetIface {
                name,
                ip: ip.to_string(),
                family,
                mac,
                is_primary,
            })
        })
        .collect()
}

fn detect_shell() -> String {
    // Unix: SHELL env (her zaman set'tir; bash/zsh/fish vb).
    if let Ok(shell) = std::env::var("SHELL") {
        return std::path::Path::new(&shell)
            .file_stem()
            .and_then(|s| s.to_str())
            .map(String::from)
            .unwrap_or(shell);
    }
    // Windows: kullanıcının "tek bir shell"i yok — sistemde mevcut tüm
    // ana shell'leri listele. Sıra: PS7 → PS5 → cmd → wt (Windows Terminal
    // kabuk değil, ama yaygın varlık). " · " ile ayrılmış görüntü.
    #[cfg(target_os = "windows")]
    {
        let mut shells: Vec<&'static str> = Vec::new();
        if has_in_path("pwsh.exe") {
            shells.push("PowerShell 7+");
        }
        if has_in_path("powershell.exe") {
            shells.push("Windows PowerShell");
        }
        // cmd.exe her Windows'ta var — sadece varlık kontrolü için ComSpec
        if std::env::var("ComSpec")
            .or_else(|_| std::env::var("COMSPEC"))
            .is_ok()
        {
            shells.push("cmd");
        }
        if !shells.is_empty() {
            return shells.join(" · ");
        }
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

#[cfg(target_os = "windows")]
fn has_in_path(name: &str) -> bool {
    let Ok(path) = std::env::var("PATH") else {
        return false;
    };
    path.split(';')
        .filter(|d| !d.is_empty())
        .any(|d| std::path::Path::new(d).join(name).exists())
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
    // Tauri main thread'i STA modunda başlattığı için aynı thread'de COM
    // moda zorla MTA'ya geçemeyiz (HRESULT 0x80010106 = RPC_E_CHANGED_MODE).
    // Çözüm: yeni bir worker thread'de WMI sorgusu çalıştır, sonucu join ile al.
    std::thread::spawn(collect_gpus_inner)
        .join()
        .unwrap_or_default()
}

#[cfg(target_os = "windows")]
fn collect_gpus_inner() -> Vec<GpuInfo> {
    use std::collections::HashMap;
    use wmi::{COMLibrary, Variant, WMIConnection};

    let mut out = Vec::new();
    let com = match COMLibrary::new() {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("dfetch: GPU COM init failed: {e}");
            return out;
        }
    };
    let con = match WMIConnection::new(com) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("dfetch: GPU WMI connect failed: {e}");
            return out;
        }
    };
    let query = "SELECT Name, AdapterRAM, DriverVersion FROM Win32_VideoController";
    let rows: Vec<HashMap<String, Variant>> = match con.raw_query(query) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("dfetch: GPU WMI query failed: {e}");
            return out;
        }
    };
    tracing::info!("dfetch: GPU WMI rows = {}", rows.len());
    for (i, row) in rows.iter().enumerate() {
        let name = match row.get("Name") {
            Some(Variant::String(s)) => s.clone(),
            other => {
                tracing::warn!("dfetch: GPU[{i}] Name unexpected variant: {other:?}");
                "Unknown GPU".into()
            }
        };
        // AdapterRAM: schema uint32 ama wmi crate çoğu zaman I4 olarak döner;
        // bazı sürücüler hiç değer döndürmez (Variant::Empty/Null) — 0 kabul.
        let vram = match row.get("AdapterRAM") {
            Some(Variant::UI4(n)) => *n as u64,
            Some(Variant::I4(n)) if *n >= 0 => *n as u64,
            Some(Variant::I4(n)) => (*n as u32) as u64, // 4 GB+ wraparound düzelt
            Some(Variant::I8(n)) if *n >= 0 => *n as u64,
            Some(Variant::UI8(n)) => *n,
            other => {
                tracing::debug!("dfetch: GPU[{i}] AdapterRAM unexpected variant: {other:?}");
                0
            }
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
    tracing::info!("dfetch: GPU collected = {}", out.len());
    out
}

#[cfg(not(target_os = "windows"))]
fn collect_gpus() -> Vec<GpuInfo> {
    Vec::new()
}

#[cfg(target_os = "windows")]
fn detect_battery() -> Option<BatteryInfo> {
    // GPU ile aynı sebep: Tauri STA thread'inde MTA'ya geçemeyiz, fresh
    // thread'de yürüt.
    //
    // Performans: dfetch_live saniyede bir çağrılır → her seferinde yeni thread
    // + COM init + WMI query (~50-200ms). Cache layer ile 5sn TTL — battery
    // değeri pratik olarak %1 kresedikçe değişir, 5sn yeterli güncellik.
    // Cache miss'te yine fresh thread spawn ederiz (STA kısıtı kaldı).
    use parking_lot::Mutex;
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    struct BatteryCache {
        value: Option<BatteryInfo>,
        last_fetch: Instant,
    }
    static CACHE: OnceLock<Mutex<BatteryCache>> = OnceLock::new();
    const TTL: Duration = Duration::from_secs(5);

    let cell = CACHE.get_or_init(|| {
        Mutex::new(BatteryCache {
            value: None,
            last_fetch: Instant::now() - TTL * 2,
        })
    });
    {
        let guard = cell.lock();
        if guard.last_fetch.elapsed() < TTL {
            return guard.value.clone();
        }
    }
    let fresh = std::thread::spawn(detect_battery_inner)
        .join()
        .ok()
        .flatten();
    let mut guard = cell.lock();
    guard.value = fresh.clone();
    guard.last_fetch = Instant::now();
    fresh
}

#[cfg(target_os = "windows")]
fn detect_battery_inner() -> Option<BatteryInfo> {
    use std::collections::HashMap;
    use wmi::{COMLibrary, Variant, WMIConnection};

    let com = COMLibrary::new().ok()?;
    let con = WMIConnection::new(com).ok()?;
    let query =
        "SELECT EstimatedChargeRemaining, BatteryStatus, EstimatedRunTime FROM Win32_Battery";
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
    // EstimatedRunTime: dakika cinsinden, AC'ye bağlıyken Windows sentinel
    // 71582788 (~0xFFFFFFFE/60) veya u32::MAX döndürür → None'a çevir.
    let time_remaining_min = match row.get("EstimatedRunTime") {
        Some(Variant::UI4(n)) => Some(*n),
        Some(Variant::I4(n)) if *n >= 0 => Some(*n as u32),
        Some(Variant::UI2(n)) => Some(*n as u32),
        _ => None,
    }
    .filter(|n| *n < 1_000_000 && !charging && !full); // sentinel + AC modu temizliği
    Some(BatteryInfo {
        percent,
        charging,
        full,
        time_remaining_min,
    })
}

#[cfg(not(target_os = "windows"))]
fn detect_battery() -> Option<BatteryInfo> {
    None
}

// ─── Hybrid CPU detection (Intel 12th+ P/E, future ARM big.LITTLE) ───────────
//
// Windows GetLogicalProcessorInformationEx ile her fiziksel core'un
// EfficiencyClass değerini okuruz. Intel hybrid'de:
//   - P-core: yüksek EfficiencyClass (genellikle 1)
//   - E-core: düşük EfficiencyClass (genellikle 0)
// Tüm core'lar aynı class'taysa hybrid değil → None.

#[cfg(target_os = "windows")]
fn detect_hybrid_cpu() -> Option<HybridCores> {
    use std::collections::HashMap;
    use windows::Win32::Foundation::{GetLastError, ERROR_INSUFFICIENT_BUFFER};
    use windows::Win32::System::SystemInformation::{
        GetLogicalProcessorInformationEx, RelationProcessorCore,
        SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX,
    };

    unsafe {
        // İlk çağrı: gereken buffer boyutunu öğren (ERROR_INSUFFICIENT_BUFFER beklenir).
        let mut size: u32 = 0;
        let _ = GetLogicalProcessorInformationEx(RelationProcessorCore, None, &mut size);
        if GetLastError() != ERROR_INSUFFICIENT_BUFFER {
            return None;
        }
        if size == 0 {
            return None;
        }
        let mut buf = vec![0u8; size as usize];
        let ptr = buf.as_mut_ptr() as *mut SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX;
        if GetLogicalProcessorInformationEx(RelationProcessorCore, Some(ptr), &mut size).is_err() {
            return None;
        }

        // Buffer değişken-uzunluklu kayıtlardan oluşur — her kaydın `Size` alanı
        // sonraki ofset için yol gösterir.
        let mut classes: HashMap<u8, u32> = HashMap::new();
        let mut offset: usize = 0;
        let buf_end = size as usize;
        while offset + std::mem::size_of::<SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX>() <= buf_end {
            let info =
                &*(buf.as_ptr().add(offset) as *const SYSTEM_LOGICAL_PROCESSOR_INFORMATION_EX);
            let rec_size = info.Size as usize;
            if rec_size == 0 || offset + rec_size > buf_end {
                break;
            }
            // Yalnızca RelationProcessorCore kayıtlarına bakıyoruz
            let proc_info = info.Anonymous.Processor;
            *classes.entry(proc_info.EfficiencyClass).or_insert(0) += 1;
            offset += rec_size;
        }

        if classes.len() < 2 {
            return None; // homojen — hybrid değil
        }
        // En yüksek EfficiencyClass = P-core, en düşük = E-core (Intel
        // konvansiyonu). 3+ class olursa middle'ları P'ye katmak makul.
        let max_class = *classes.keys().max()?;
        let min_class = *classes.keys().min()?;
        if max_class == min_class {
            return None;
        }
        let p_cores: u32 = classes
            .iter()
            .filter(|(c, _)| **c == max_class)
            .map(|(_, n)| *n)
            .sum();
        let e_cores: u32 = classes
            .iter()
            .filter(|(c, _)| **c == min_class)
            .map(|(_, n)| *n)
            .sum();
        Some(HybridCores { p_cores, e_cores })
    }
}

#[cfg(not(target_os = "windows"))]
fn detect_hybrid_cpu() -> Option<HybridCores> {
    None
}

// ─── Snapshot PNG yaz ────────────────────────────────────────────────────────
//
// Frontend html-to-image ile dataURL üretir, Tauri save dialog'tan path alır,
// bu komut path + binary'i diske yazar. Plugin-fs eklemekten kaçınıldı.
//
// GÜVENLİK: frontend XSS post-compromise senaryosunda saldırgan path olarak
// `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\evil.exe` veya
// kullanıcının `.bashrc` / `profile.ps1` dosyasını gönderebilir. Bu yüzden
// burada path'i WHITE-LIST kontrol ediyoruz: yalnızca kullanıcının resim/desktop
// dizinlerine + uygulamanın AppData snapshots klasörüne, üstelik yalnızca .png
// uzantısıyla yazmaya izin veriyoruz. Dialog akışı normalde bu yollara çıkar
// ama backend dialog'a güvenmek zorunda değil.

#[tauri::command]
pub fn dfetch_save_snapshot(path: String, bytes: Vec<u8>) -> Result<(), String> {
    use std::io::Write;
    let p = std::path::PathBuf::from(&path);

    // Uzantı kontrolü — yalnızca .png. Diğer hiçbir şey yazılmaz.
    let ext_ok = p
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("png"))
        .unwrap_or(false);
    if !ext_ok {
        return Err("only .png files allowed".into());
    }

    // UNC reddet.
    if path.starts_with(r"\\") || path.starts_with("//") {
        return Err("UNC path not allowed".into());
    }

    // Allowed root listesi — çoğu canonical değil çünkü dosya henüz yok;
    // ancak parent canonical olabilir. Önce parent'ı resolve ediyoruz.
    let parent = p
        .parent()
        .ok_or_else(|| "path has no parent dir".to_string())?;
    // create_dir_all parent yoksa oluştur — yine de allowed root altında olmalı.
    let allowed_roots: Vec<std::path::PathBuf> = [
        dirs::picture_dir(),
        dirs::desktop_dir(),
        dirs::download_dir(),
        dirs::document_dir(),
        // Uygulama snapshot klasörü — auto-save akışı için.
        dirs::data_dir().map(|d| d.join("D-Terminal").join("snapshots")),
    ]
    .into_iter()
    .flatten()
    .collect();

    // create_dir_all sonra canonicalize edebiliriz; ama önce başlangıç check.
    let _ = std::fs::create_dir_all(parent);
    let canon_parent = parent
        .canonicalize()
        .map_err(|e| format!("canonicalize parent: {e}"))?;
    let allowed = allowed_roots.iter().any(|root| {
        root.canonicalize()
            .map(|r| canon_parent.starts_with(&r))
            .unwrap_or(false)
    });
    if !allowed {
        return Err(
            "path outside allowed roots (Pictures/Desktop/Documents/Downloads/AppData)".into(),
        );
    }

    // Boyut sınırı — html-to-image PNG genelde &lt; 5 MB; saldırgan 1 GB
    // gönderemesin (DoS).
    const MAX_PNG_BYTES: usize = 25 * 1024 * 1024;
    if bytes.len() > MAX_PNG_BYTES {
        return Err(format!(
            "snapshot too large: {} bytes (max {MAX_PNG_BYTES})",
            bytes.len()
        ));
    }

    let mut f = std::fs::File::create(&p).map_err(|e| format!("create: {e}"))?;
    f.write_all(&bytes).map_err(|e| format!("write: {e}"))?;
    Ok(())
}

// ─── Live stats (CPU/RAM/Network throughput) ─────────────────────────────────
//
// `dfetch_get` ağır toplama (disk, GPU, WMI, vs.) — frontend açılışta bir kez
// çağırır. `dfetch_live` hafif refresh: sadece CPU%, RAM, ağ delta'ları, pil.
// State (sysinfo System + Networks instance + son refresh zamanı) Tauri
// State olarak tutulur ki ardışık çağrılar arasında throughput hesaplanabilsin.

use parking_lot::Mutex;
use std::time::Instant;
use sysinfo::Networks;

pub struct DfetchLiveState {
    sys: Mutex<System>,
    nets: Mutex<Networks>,
    last_refresh: Mutex<Option<Instant>>,
}

impl DfetchLiveState {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu();
        sys.refresh_memory();
        let nets = Networks::new_with_refreshed_list();
        Self {
            sys: Mutex::new(sys),
            nets: Mutex::new(nets),
            last_refresh: Mutex::new(None),
        }
    }
}

impl Default for DfetchLiveState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Serialize)]
pub struct NetThroughput {
    pub name: String,
    /// Bytes/sn alış (download).
    pub rx_bps: u64,
    /// Bytes/sn gönderim (upload).
    pub tx_bps: u64,
}

#[derive(Debug, Serialize)]
pub struct LiveStats {
    /// 0-100 arası ortalama CPU kullanımı (tüm çekirdekler ortalaması).
    pub cpu_percent: f32,
    pub ram_used: u64,
    pub ram_total: u64,
    /// İlk çağrıda boş — sonraki refresh'lerde delta hesaplanır.
    pub net: Vec<NetThroughput>,
    pub battery: Option<BatteryInfo>,
}

#[tauri::command]
pub fn dfetch_live(state: tauri::State<'_, DfetchLiveState>) -> LiveStats {
    let mut sys = state.sys.lock();
    sys.refresh_cpu();
    sys.refresh_memory();

    // Network: sysinfo `received()`/`transmitted()` son refresh'ten beri
    // gelen byte sayısını verir → süreye böl, bps hesapla.
    let mut nets = state.nets.lock();
    nets.refresh();
    let mut last = state.last_refresh.lock();
    let now = Instant::now();
    let elapsed_secs = last
        .map(|t| now.duration_since(t).as_secs_f64().max(0.001))
        .unwrap_or(1.0);
    *last = Some(now);
    drop(last);

    let mut net = Vec::new();
    for (name, data) in nets.iter() {
        // Sıfır trafikli interface'leri DE listele — frontend primary
        // arayüzü gösterirken trafik 0'a düşse bile satır ekranda kalsın.
        // (Loopback'i sysinfo zaten ayrı tutar; yine de zarar vermez.)
        let rx = data.received();
        let tx = data.transmitted();
        net.push(NetThroughput {
            name: name.clone(),
            rx_bps: ((rx as f64) / elapsed_secs) as u64,
            tx_bps: ((tx as f64) / elapsed_secs) as u64,
        });
    }

    let cpu_percent = sys.global_cpu_info().cpu_usage();
    let ram_used = sys.used_memory();
    let ram_total = sys.total_memory();
    drop(sys);
    drop(nets);

    LiveStats {
        cpu_percent,
        ram_used,
        ram_total,
        net,
        battery: detect_battery(),
    }
}
