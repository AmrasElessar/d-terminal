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
  /** Satır içi string index'i (0-based) ve uzunluk — kolon dönüşümü ayrıca. */
  index: number;
  length: number;
  def: PatternDef;
}

/** URL aralıkları — WebLinksAddon bunları zaten yakalar; Unix-path deseni
 *  `https://host/a/b` içindeki `/a/b`'yi ayrı link yapmasın. */
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi;

/** String index → hücre kolonu eşlemesi. Geniş karakterler (CJK, emoji) iki
 *  hücre kaplar; translateToString tek karakter döndürdüğü için index'ler
 *  kayıyordu ve link yanlış yeri işaretliyordu. */
interface ColumnMap {
  col: number[];
  width: number[];
}
function buildColumnMap(line: IBufferLine | undefined): ColumnMap | null {
  if (!line || typeof line.getCell !== 'function') return null;
  const col: number[] = [];
  const width: number[] = [];
  for (let x = 0; x < line.length; x++) {
    const cell = line.getCell(x);
    if (!cell) break;
    const w = cell.getWidth();
    if (w === 0) continue; // geniş karakterin devam hücresi
    const chars = cell.getChars() || ' ';
    for (let k = 0; k < chars.length; k++) {
      col.push(x);
      width.push(w);
    }
  }
  return { col, width };
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
      out.push({ text: matchText, index: start, length: matchText.length, def });
    }
  }
  // URL içindeki parçalar link olmasın
  const claimed: Array<[number, number]> = [];
  for (const u of line.matchAll(URL_RE)) {
    claimed.push([u.index ?? 0, (u.index ?? 0) + u[0].length - 1]);
  }
  // Aynı pozisyonda birden çok match varsa (path + git ref örtüşmesi) — daha uzun olan kazansın
  out.sort((a, b) => b.length - a.length);
  return out.filter((m) => {
    const s = m.index;
    const e = m.index + m.length - 1;
    const overlaps = claimed.some(([cs, ce]) => !(e < cs || s > ce));
    if (overlaps) return false;
    claimed.push([s, e]);
    return true;
  });
}

/** String aralığını xterm 1-based kolon aralığına çevir. */
function toRange(m: Match, map: ColumnMap | null): { startCol: number; endCol: number } {
  const last = m.index + m.length - 1;
  if (!map || last >= map.col.length) {
    return { startCol: m.index + 1, endCol: m.index + m.length };
  }
  return {
    startCol: map.col[m.index]! + 1,
    endCol: map.col[last]! + map.width[last]!,
  };
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
      const map = buildColumnMap(line);
      const links: ILink[] = matches.map((m) => {
        const { startCol, endCol } = toRange(m, map);
        const range: IBufferRange = {
          start: { x: startCol, y: bufferLineNumber },
          end: { x: endCol, y: bufferLineNumber },
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
