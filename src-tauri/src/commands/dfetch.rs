// DFetch — sistem bilgi toplama komutu (architecture-v1.1.md §12).

use serde::Serialize;
use sysinfo::System;

#[derive(Debug, Serialize)]
pub struct SystemInfo {
    pub os: String,
    pub kernel: String,
    pub hostname: String,
    pub cpu: String,
    pub cores: usize,
    pub ram_used: u64,
    pub ram_total: u64,
    pub uptime_secs: u64,
    pub d_terminal_version: String,
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
            .map(|c| c.brand().to_string())
            .unwrap_or_else(|| "Unknown CPU".into()),
        cores: sys.physical_core_count().unwrap_or(0),
        ram_used: sys.used_memory(),
        ram_total: sys.total_memory(),
        uptime_secs: System::uptime(),
        d_terminal_version: env!("CARGO_PKG_VERSION").to_string(),
    }
}
