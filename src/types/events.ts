// Backend'den emit edilen Tauri event payload'ları (sidecar manager).

export type PtyEvent =
  | { kind: 'stdout'; pane_id: string; data: number[] }
  | { kind: 'exit'; pane_id: string; exit_code: number; signal: string | null }
  | { kind: 'error'; pane_id: string | null; code: string; message: string }
  | { kind: 'sidecar_up' }
  | { kind: 'sidecar_down'; reason: string };

export interface DiskInfo {
  name: string;
  mount_point: string;
  fs_type: string;
  total: number;
  used: number;
}

export interface GpuInfo {
  name: string;
  vram: number;
  driver_version: string | null;
}

export interface ScreenInfo {
  width: number;
  height: number;
  scale: number;
}

export interface BatteryInfo {
  percent: number;
  charging: boolean;
  full: boolean;
  /** Pilden çalışırken kalan tahmini süre (dakika). AC'deyken yok. */
  time_remaining_min?: number | null;
}

export interface NetThroughput {
  name: string;
  rx_bps: number;
  tx_bps: number;
}

export interface LiveStats {
  cpu_percent: number;
  ram_used: number;
  ram_total: number;
  net: NetThroughput[];
  battery: BatteryInfo | null;
}

export interface NetIface {
  name: string;
  ip: string;
  family: 'v4' | 'v6';
  /** MAC adresi (XX:XX:XX:XX:XX:XX). Loopback/sanal interfacelerde yok. */
  mac?: string | null;
  /** Sistemin internete çıkışta kullandığı interface (default route source). */
  is_primary: boolean;
}

export interface HybridCores {
  p_cores: number;
  e_cores: number;
}

export interface SystemInfo {
  os: string;
  kernel: string;
  hostname: string;
  cpu: string;
  cores: number;
  ram_used: number;
  ram_total: number;
  swap_used: number;
  swap_total: number;
  uptime_secs: number;
  boot_time_unix: number;
  d_terminal_version: string;

  shell: string;
  terminal: string;
  desktop: string;
  theme: string;
  locale: string;
  timezone: string;
  disks: DiskInfo[];
  gpus: GpuInfo[];
  screen: ScreenInfo | null;
  battery: BatteryInfo | null;
  local_ips: NetIface[];
  /** Mantıksal işlemci sayısı (SMT/HT dahil thread). */
  logical_cores: number;
  /** Hybrid CPU (Intel 12th+ vb.) tespit edilirse P+E ayrımı. */
  cpu_hybrid?: HybridCores | null;
}
