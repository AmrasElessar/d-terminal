// Backend'den emit edilen Tauri event payload'ları (sidecar manager).

export type PtyEvent =
  | { kind: 'stdout'; pane_id: string; data: number[] }
  | { kind: 'exit'; pane_id: string; exit_code: number; signal: string | null }
  | { kind: 'error'; pane_id: string | null; code: string; message: string }
  | { kind: 'sidecar_up' }
  | { kind: 'sidecar_down'; reason: string };

export interface SystemInfo {
  os: string;
  kernel: string;
  hostname: string;
  cpu: string;
  cores: number;
  ram_used: number;
  ram_total: number;
  uptime_secs: number;
  d_terminal_version: string;
}
