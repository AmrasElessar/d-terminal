// Smart link provider — file paths, IP addresses, git refs.
// xterm.js'in built-in WebLinksAddon URL'leri yakalar; bu composable iTerm2/WezTerm
// benzeri "smart selection" davranışını ekler. Tıklandığında open_path /
// kopyala / AI'a gönder seçenekleri için custom handler çağırır.

import type { IBufferLine, ILinkProvider, ILink, Terminal, IBufferRange } from '@xterm/xterm';

export interface SmartLinkHandlers {
  /** File path tıklandığında — explorer/vscode/notepad açma callback'i. */
  onPath?: (path: string) => void;
  /** Git SHA tıklandığında. */
  onGitRef?: (sha: string) => void;
  /** IP/host:port tıklandığında. */
  onHost?: (host: string) => void;
}

interface PatternDef {
  /** `g` flag eklenecek; her satırda tüm match'ler için iterate. */
  pattern: RegExp;
  hover: string;
  activate: (text: string, handlers: SmartLinkHandlers) => void;
}

// Windows file path: C:\foo\bar.ext, drive-letter + backslash chain + uzantı.
// Unix path: /usr/local/.../file.ext veya ./relative/file.
// Filtre: en az 1 ayraç + uzantı (yanlış yere yapışmayı azaltır).
const PATTERNS: PatternDef[] = [
  {
    pattern: /(?<![A-Za-z0-9])([A-Za-z]:[\\/](?:[\w.-]+[\\/])*[\w.-]+)/g,
    hover: 'Windows path — open in Explorer',
    activate: (text, h) => h.onPath?.(text),
  },
  {
    pattern: /(?<![A-Za-z0-9])((?:\.{1,2}[\\/])(?:[\w.-]+[\\/])*[\w.-]+)/g,
    hover: 'Relative path',
    activate: (text, h) => h.onPath?.(text),
  },
  {
    pattern: /(?<![A-Za-z0-9])(\/(?:[\w.-]+\/)*[\w.-]+)/g,
    hover: 'Unix path',
    activate: (text, h) => h.onPath?.(text),
  },
  {
    pattern: /(?<![A-Za-z0-9])([0-9a-f]{7,40})(?![A-Za-z0-9])/g,
    hover: 'Git ref — copy SHA',
    activate: (text, h) => h.onGitRef?.(text),
  },
  {
    // IPv4 + opsiyonel port
    pattern: /(?<![A-Za-z0-9.])((?:\d{1,3}\.){3}\d{1,3}(?::\d{1,5})?)(?![A-Za-z0-9.])/g,
    hover: 'IP address',
    activate: (text, h) => h.onHost?.(text),
  },
];

interface Match {
  text: string;
  /** Satır içi 1-based start kolonu (xterm range konvansiyonu). */
  startCol: number;
  endCol: number;
  def: PatternDef;
}

function readLine(line: IBufferLine | undefined): string {
  if (!line) return '';
  return line.translateToString(true);
}

function findMatches(line: string): Match[] {
  const out: Match[] = [];
  for (const def of PATTERNS) {
    const re = new RegExp(def.pattern.source, def.pattern.flags.includes('g') ? def.pattern.flags : def.pattern.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const matchText = m[1] ?? m[0];
      if (!matchText) continue;
      const start = (m.index ?? 0) + (m[0].indexOf(matchText));
      out.push({
        text: matchText,
        startCol: start + 1, // xterm 1-based
        endCol: start + matchText.length,
        def,
      });
    }
  }
  // Aynı pozisyonda birden çok match varsa (path + git ref örtüşmesi) — daha uzun olan kazansın
  out.sort((a, b) => (b.endCol - b.startCol) - (a.endCol - a.startCol));
  const claimed: Array<[number, number]> = [];
  return out.filter((m) => {
    const overlaps = claimed.some(([s, e]) => !(m.endCol < s || m.startCol > e));
    if (overlaps) return false;
    claimed.push([m.startCol, m.endCol]);
    return true;
  });
}

export function createSmartLinkProvider(
  term: Terminal,
  handlers: SmartLinkHandlers,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const buffer = term.buffer.active;
      const line = buffer.getLine(bufferLineNumber - 1);
      const text = readLine(line);
      if (!text) {
        callback(undefined);
        return;
      }
      const matches = findMatches(text);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map((m) => {
        const range: IBufferRange = {
          start: { x: m.startCol, y: bufferLineNumber },
          end: { x: m.endCol, y: bufferLineNumber },
        };
        return {
          range,
          text: m.text,
          activate: () => m.def.activate(m.text, handlers),
          hover: () => { /* tooltip yok — hover decoration default */ },
          leave: () => { /* noop */ },
        };
      });
      callback(links);
    },
  };
}
