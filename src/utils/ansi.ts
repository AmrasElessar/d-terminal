// ANSI escape temizleme — tek kaynak (TerminalPane, BlockPanel, triggers).
//
// Kapsam: CSI (`ESC [ ... harf`), OSC (`ESC ] ... BEL` veya `ESC ] ... ESC \`)
// ve tek karakterlik ESC dizileri (`ESC =`, `ESC >`, `ESC 7` ...).
// Control byte'lar runtime'da inşa — `no-control-regex` literal regex'i hedefler.

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);

/** Global regex — `String.replace` ile kullanılmalı (lastIndex state'i yok). */
export const ANSI_RE = new RegExp(
  `${ESC}\\[[0-9;?<>=!]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|${ESC}[@-Z\\\\-_=>78]`,
  'g',
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}
