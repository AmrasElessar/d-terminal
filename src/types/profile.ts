// Shell profil sistemi (iTerm2/Tabby paritesi).
//
// Profil = bir terminal pane'inin nasıl spawn edileceğini tanımlayan reçete.
// Built-in profiller (PowerShell/CMD/WSL) varsayılan olarak listelenir.
// Kullanıcı kendi profillerini ekler — örnek: "PowerShell 7", "SSH prod", "Docker container".

import type { PaneType } from '@/types/pane';

export interface ShellProfile {
  id: string;
  name: string;
  /** Çalıştırılacak shell binary path'i veya komut adı (örn: pwsh.exe, ssh.exe). */
  shell: string;
  /** Argümanlar — kullanıcı sonradan değiştirebilir. */
  args: string[];
  /** Çalışma dizini — boş ise kullanıcı klasörü. */
  cwd?: string;
  /** Ek environment değişkenleri (KEY=VALUE çiftleri). */
  env?: Record<string, string>;
  /** UI'da gösterilecek emoji/icon. */
  icon: string;
  /** Hangi pane tipinin (= shell integration marker setup) kullanılacağı. */
  paneType: PaneType;
  /** Built-in profiller silinemez ve değiştirilemez. */
  builtin: boolean;
  /** Renk badge'i — hızlı görsel ayırt etme. */
  color?: string;
}

/** Built-in profile id'leri — TerminalPane.SHELL_OF defaults bunlardan beslenir. */
export const BUILTIN_PROFILE_IDS = {
  powershell: 'builtin.powershell',
  cmd: 'builtin.cmd',
  wsl: 'builtin.wsl',
} as const;

export function defaultProfile(): Omit<ShellProfile, 'id'> {
  return {
    name: '',
    shell: '',
    args: [],
    cwd: '',
    env: {},
    icon: '⚡',
    paneType: 'powershell',
    builtin: false,
  };
}

/** Bundled built-in profiller. Built-in olduğu için store load'unda her zaman yeniden eklenir. */
export const BUILTIN_PROFILES: ShellProfile[] = [
  {
    id: BUILTIN_PROFILE_IDS.powershell,
    name: 'PowerShell',
    shell: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile', '-NoExit'],
    icon: '⚡',
    paneType: 'powershell',
    builtin: true,
    color: '#1E90FF',
  },
  {
    id: BUILTIN_PROFILE_IDS.cmd,
    name: 'Command Prompt',
    shell: 'cmd.exe',
    args: ['/K'],
    icon: '🪟',
    paneType: 'cmd',
    builtin: true,
    color: '#FFBD2E',
  },
  {
    id: BUILTIN_PROFILE_IDS.wsl,
    name: 'WSL',
    shell: 'wsl.exe',
    args: [],
    icon: '🐧',
    paneType: 'wsl',
    builtin: true,
    color: '#FFA500',
  },
];

/** Profilden Tauri pty_spawn args'ı üret. PaneType-spesifik shell init script'i çağrı yerinde eklenir. */
export interface SpawnSpec {
  shell: string;
  args: string[];
  cwd?: string;
  env?: Array<[string, string]>;
}

export function profileToSpawnSpec(p: ShellProfile, augmentArgs: string[] = []): SpawnSpec {
  return {
    shell: p.shell,
    args: [...p.args, ...augmentArgs],
    cwd: p.cwd && p.cwd.length > 0 ? p.cwd : undefined,
    env:
      p.env && Object.keys(p.env).length > 0
        ? Object.entries(p.env)
        : undefined,
  };
}
