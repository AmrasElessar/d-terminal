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
}

export interface NetIface {
  name: string;
  ip: string;
  family: 'v4' | 'v6';
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
}
