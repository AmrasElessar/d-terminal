// Shell init script'leri — Vite `?raw` ile string olarak import edilir.
// Yeni shell desteği eklenirken (bash/zsh/fish) bu dosyaya yeni anahtar gelir;
// TerminalPane sadece map'ten okur, vue dosyası temiz kalır.

// Vite'ın raw asset import'u — string olarak gelir (vite/client.d.ts).
import psInit from './powershell.ps1?raw';
import cmdInit from './cmd-prompt.txt?raw';

import type { PaneType } from '@/types/pane';

/** PowerShell prompt + OSC 133 + welcome banner. */
export const POWERSHELL_INIT: string = (psInit as string).trim();

/** CMD prompt setter — `cmd /K <CMD_INIT>` ile çalıştırılır. */
export const CMD_INIT: string = (cmdInit as string).trim();

/** Built-in profile için pane tipinin shell-init argümanlarını döndür.
 *  Kullanıcı tanımlı profiller (SSH, Docker vb.) için bunlar kullanılmaz —
 *  o durumda init script'i atlanır. */
export function builtinShellInitArgs(paneType: PaneType): string[] {
  switch (paneType) {
    case 'powershell':
      return ['-Command', POWERSHELL_INIT];
    case 'cmd':
      return [CMD_INIT];
    default:
      return [];
  }
}
