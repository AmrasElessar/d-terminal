// Komut block — Warp tarzı: her komut + çıktı + metadata = ayrı block
// OSC 133 sequence ile sınırlandırılır (A=prompt start, B=cmd start, C=cmd run, D=cmd end).

export type BlockStatus = 'pending' | 'running' | 'success' | 'error' | 'aborted';

export interface CommandBlock {
  id: string;
  /** Komut metni (kullanıcının yazdığı satır). */
  command: string;
  /** Komut çıktısı (raw, ANSI escape dahil). */
  output: string;
  /** Çalıştırıldığı çalışma dizini. */
  cwd: string | null;
  /** Komut başlangıç zamanı. */
  startedAt: Date;
  /** Komut bitiş zamanı. */
  endedAt: Date | null;
  /** Process exit code. 0 = başarılı, ≠0 = hata. */
  exitCode: number | null;
  status: BlockStatus;
  /** Bu block'un satır sayısı (terminal scrollback bookkeeping). */
  outputLineCount: number;
  /** Block hidden/collapsed mu (UI). */
  collapsed: boolean;
}

export function newBlock(): CommandBlock {
  return {
    id: crypto.randomUUID(),
    command: '',
    output: '',
    cwd: null,
    startedAt: new Date(),
    endedAt: null,
    exitCode: null,
    status: 'pending',
    outputLineCount: 0,
    collapsed: false,
  };
}

export function blockDuration(block: CommandBlock): number | null {
  if (!block.endedAt) return null;
  return block.endedAt.getTime() - block.startedAt.getTime();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
