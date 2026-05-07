// Pane başına block listesi ve OSC 133 parser state.
// Her TerminalPane mount'unda ayrı bir state instance'ı.
// Global registry — her component paneId ile tracker'a erişir.

import { ref, type Ref } from 'vue';
import { type CommandBlock, newBlock } from '@/types/block';

/** Block output buffer üst sınırı — büyük log akışlarında (npm install,
 *  cargo build) string'in sınırsız büyümesini engelle. V8'de string append
 *  her seferinde yeni allocation + GC; bu sınır sürekli rotate ile baskıyı
 *  bounded tutar. 256KB ekran scrollback'inden çok daha fazlasını hatırlar. */
const MAX_OUTPUT_BYTES = 256 * 1024;

export interface BlockTracker {
  blocks: Ref<CommandBlock[]>;
  /** Şu an aktif (çalışan veya prompt yazılan) block. */
  active: () => CommandBlock | null;
  /** OSC 133;A — yeni prompt başladı. Önceki block'u kapat (eğer pending'se). */
  onPromptStart: () => void;
  /** OSC 133;B — komut girişi başlıyor (kullanıcı yazma). */
  onCommandStart: () => void;
  /** OSC 133;C — komut çalıştırıldı (Enter). Output'u toplamaya başla. */
  onCommandRun: (command: string) => void;
  /** OSC 133;D;<exit> — komut bitti, exit code ile. */
  onCommandEnd: (exitCode: number) => void;
  /** OSC 133;P;cwd=<path> — cwd metadata. */
  onCwd: (cwd: string) => void;
  /** Sidecar STDOUT — output topla (raw bytes). */
  onOutput: (text: string) => void;
  /** Kullanıcı klavye girişi — komutu yakala. */
  onUserInput: (data: string) => void;
  /** Block silme. */
  remove: (id: string) => void;
  /** Hepsini temizle. */
  clear: () => void;
  /** Toggle collapsed. */
  toggleCollapsed: (id: string) => void;
}

export function createBlockTracker(): BlockTracker {
  const blocks = ref<CommandBlock[]>([]);
  let activeBlock: CommandBlock | null = null;
  let pendingCwd: string | null = null;
  let inputAccumulator = ''; // user typed bytes between B and C/Enter

  function pushNew(): CommandBlock {
    const b = newBlock();
    if (pendingCwd) b.cwd = pendingCwd;
    blocks.value.push(b);
    activeBlock = b;
    return b;
  }

  return {
    blocks,
    active: () => activeBlock,

    onPromptStart() {
      // Önceki block hala "pending" ise (D gelmediyse), kapatma — kullanıcı henüz
      // bir komut çalıştırmadan yeni prompt aldı (Ctrl+C gibi). Aborted işaretle.
      if (activeBlock && activeBlock.status === 'pending' && !activeBlock.command) {
        // boş block — listeden çıkar
        blocks.value = blocks.value.filter((b) => b.id !== activeBlock!.id);
      } else if (activeBlock && activeBlock.status === 'running') {
        activeBlock.status = 'aborted';
        activeBlock.endedAt = new Date();
      }
      activeBlock = null;
      inputAccumulator = '';
    },

    onCommandStart() {
      // Prompt sonrası, kullanıcı yazma evresi
      if (!activeBlock) pushNew();
      inputAccumulator = '';
    },

    onCommandRun(command: string) {
      if (!activeBlock) pushNew();
      activeBlock!.command = command || inputAccumulator.trim();
      activeBlock!.startedAt = new Date();
      activeBlock!.status = 'running';
      inputAccumulator = '';
    },

    onCommandEnd(exitCode: number) {
      if (!activeBlock) return;
      activeBlock.endedAt = new Date();
      activeBlock.exitCode = exitCode;
      activeBlock.status = exitCode === 0 ? 'success' : 'error';
      // Komut zaten yakalandıysa input'u sıfırla; yakalanmadıysa input'tan al
      if (!activeBlock.command && inputAccumulator.trim()) {
        activeBlock.command = inputAccumulator.trim();
      }
    },

    onCwd(cwd: string) {
      pendingCwd = cwd;
      if (activeBlock) activeBlock.cwd = cwd;
    },

    onOutput(text: string) {
      if (!activeBlock) return;
      // Output OSC marker'larını strip etmemize gerek yok — xterm zaten render etti.
      // Rotate at MAX_OUTPUT_BYTES — büyük log akışlarında V8 GC baskısını önler.
      // Yeni metin tek başına sınırı aşarsa direkt sondan al; aksi halde mevcut+yeni
      // birlikte sınırı aşarsa baştan kırp.
      if (text.length >= MAX_OUTPUT_BYTES) {
        activeBlock.output = text.slice(text.length - MAX_OUTPUT_BYTES);
      } else {
        const combined = activeBlock.output + text;
        activeBlock.output = combined.length > MAX_OUTPUT_BYTES
          ? combined.slice(combined.length - MAX_OUTPUT_BYTES)
          : combined;
      }
      activeBlock.outputLineCount += (text.match(/\n/g) || []).length;
    },

    onUserInput(data: string) {
      // Enter veya newline — komutu yakala
      if (data.includes('\r') || data.includes('\n')) {
        const finished = (inputAccumulator + data).split(/[\r\n]/)[0] ?? '';
        if (finished.trim() && activeBlock) {
          activeBlock.command = finished.trim();
          activeBlock.startedAt = new Date();
          activeBlock.status = 'running';
        }
        inputAccumulator = '';
      } else if (data === '\x7f' || data === '\b') {
        // Backspace
        inputAccumulator = inputAccumulator.slice(0, -1);
      } else if (data.charCodeAt(0) >= 32 || data === '\t') {
        inputAccumulator += data;
      }
    },

    remove(id: string) {
      blocks.value = blocks.value.filter((b) => b.id !== id);
    },

    clear() {
      blocks.value = [];
      activeBlock = null;
      inputAccumulator = '';
    },

    toggleCollapsed(id: string) {
      const b = blocks.value.find((x) => x.id === id);
      if (b) b.collapsed = !b.collapsed;
    },
  };
}

// Global registry — pane id'sinden tracker erişimi. Plain Map; tracker içindeki
// `blocks` zaten reactive Ref olduğu için reactivity kaybolmuyor.
const trackerByPane = new Map<string, BlockTracker>();

export function registerBlockTracker(paneId: string, tracker: BlockTracker) {
  trackerByPane.set(paneId, tracker);
}

export function unregisterBlockTracker(paneId: string) {
  trackerByPane.delete(paneId);
}

export function getBlockTracker(paneId: string): BlockTracker | null {
  return trackerByPane.get(paneId) ?? null;
}
