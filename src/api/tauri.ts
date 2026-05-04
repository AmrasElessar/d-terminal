// Tauri command wrapper'ları — tip güvenli ince katman.
//
// Frontend her yerde direkt `invoke()` yerine bunları çağırır; lib.rs'de
// command imzası değişirse buradan tek yerde güncellenir.

import { invoke } from '@tauri-apps/api/core';
import type { HistoryEntry, HistoryQuery, NewHistoryEntry } from '@/types/history';
import type { NewSnippet, Snippet } from '@/types/snippet';
import type { SystemInfo } from '@/types/events';

export interface SpawnArgs {
  shell: string;
  args?: string[];
  cwd?: string;
  env?: Array<[string, string]>;
  cols: number;
  rows: number;
}

export interface SecretRow {
  id: number;
  scope: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

export interface SessionRecord {
  id: number;
  name: string;
  layout_json: string;
  created_at: string;
  updated_at: string;
}

export interface ThemeFile {
  name: string;
  path: string;
  content: string;
}

export const api = {
  // PTY
  ptySpawn: (args: SpawnArgs) => invoke<string>('pty_spawn', { args }),
  ptyWrite: (paneId: string, data: Uint8Array) =>
    invoke<void>('pty_write', { paneId, data: Array.from(data) }),
  ptyResize: (paneId: string, cols: number, rows: number) =>
    invoke<void>('pty_resize', { paneId, cols, rows }),
  ptyKill: (paneId: string) => invoke<void>('pty_kill', { paneId }),

  // History
  historyAdd: (entry: NewHistoryEntry) => invoke<number>('history_add', { entry }),
  historySearch: (query: HistoryQuery) => invoke<HistoryEntry[]>('history_search', { query }),
  historyToggleFavorite: (id: number) => invoke<void>('history_toggle_favorite', { id }),
  historyDelete: (id: number) => invoke<void>('history_delete', { id }),

  // Session
  sessionSave: (name: string, layoutJson: string) =>
    invoke<number>('session_save', { name, layoutJson }),
  sessionLoad: (name: string) =>
    invoke<SessionRecord | null>('session_load', { name }),
  sessionList: () => invoke<SessionRecord[]>('session_list'),
  sessionDelete: (name: string) => invoke<void>('session_delete', { name }),

  // Settings
  settingsGet: (key: string) => invoke<string | null>('settings_get', { key }),
  settingsSet: (key: string, value: string) =>
    invoke<void>('settings_set', { key, value }),
  settingsDelete: (key: string) => invoke<void>('settings_delete', { key }),
  settingsAll: () => invoke<Record<string, string>>('settings_all'),

  // Config as Code (TOML dotfile)
  configDotfilePath: () => invoke<string>('config_dotfile_path'),
  configExport: () => invoke<string>('config_export'),
  configImport: () => invoke<number>('config_import'),

  // Secrets
  secretsStore: (scope: string, name: string, value: string) =>
    invoke<void>('secrets_store', { scope, name, value }),
  secretsDelete: (scope: string, name: string) =>
    invoke<void>('secrets_delete', { scope, name }),
  secretsList: (scope: string) => invoke<SecretRow[]>('secrets_list', { scope }),
  secretsHas: (scope: string, name: string) =>
    invoke<boolean>('secrets_has', { scope, name }),

  // AI: maskeli key bilgisi UI için. Asıl çağrılar Rust proxy üzerinden,
  // key frontend'e hiçbir zaman ulaşmaz.
  aiKeyMasked: (provider: string) =>
    invoke<string | null>('ai_key_masked', { provider }),
  aiModels: (provider: string) =>
    invoke<Array<{ id: string; label: string; context_window?: number; supports_streaming: boolean }>>(
      'ai_models',
      { provider },
    ),

  // DFetch
  dfetchGet: () => invoke<SystemInfo>('dfetch_get'),

  // Themes
  themesList: () => invoke<ThemeFile[]>('themes_list'),
  themesSaveUser: (name: string, content: string) =>
    invoke<string>('themes_save_user', { name, content }),

  // Snippets
  snippetList: () => invoke<Snippet[]>('snippet_list'),
  snippetUpsert: (snippet: NewSnippet) => invoke<number>('snippet_upsert', { snippet }),
  snippetDelete: (id: number) => invoke<void>('snippet_delete', { id }),
  snippetGet: (id: number) => invoke<Snippet | null>('snippet_get', { id }),

  // PSReadLine
  psreadlineImport: () =>
    invoke<{
      imported: number;
      skipped_duplicates: number;
      source_lines: number;
      source_path: string;
    }>('psreadline_import'),

  // Logger (Rust file appender path bilgisi)
  logPaths: () =>
    invoke<{ directory: string; current_file: string }>('log_paths'),

  // Window vibrancy runtime apply (Mica/Acrylic/none)
  windowSetVibrancy: (mode: 'auto' | 'mica' | 'acrylic' | 'none') =>
    invoke<void>('window_set_vibrancy', { mode }),

  // Log Stream (dosya tail -f benzeri canlı izleme)
  logStreamOpen: (id: string, path: string, tail: boolean, channel: import('@tauri-apps/api/core').Channel<string>) =>
    invoke<void>('log_stream_open', { id, path, tail, onLine: channel }),
  logStreamClose: (id: string) =>
    invoke<void>('log_stream_close', { id }),
};
