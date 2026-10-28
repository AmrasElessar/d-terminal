// Pane başına block listesi ve OSC 133 parser state.
// Her TerminalPane mount'unda ayrı bir state instance'ı.
// Global registry — her component paneId ile tracker'a erişir.

import { ref, shallowReactive, type Ref } from 'vue';
import { type CommandBlock, newBlock } from '@/types/block';
import { redact } from '@/utils/redact';

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
  /** Kullanıcı klavye girişi — komutu yakala. Yalnızca OSC 133 B (komut
   *  girişi) ile komutun çalışması arasında dikkate alınır; çalışan bir
   *  komutun stdin'ine yazılanlar (şifre, `Read-Host`, ssh parola istemi)
   *  ya da alternate screen (vim, less) girdileri asla komut sayılmaz. */
  onUserInput: (data: string, opts?: { altBuffer?: boolean }) => void;
  /** Komut geçmişe yazılmalı mı? Boşlukla başlayan komutlar (bash/zsh
   *  HISTCONTROL=ignorespace geleneği) ve secret içeren komutlar hariç. */
  historyCommand: (block: CommandBlock) => string | null;
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
  /** Komut girişi evresi — yalnızca 'input' iken klavye girdisi biriktirilir.
   *  'idle'   : prompt yok / bilinmiyor (A öncesi veya D sonrası)
   *  'input'  : B geldi, kullanıcı komut satırını yazıyor
   *  'running': komut çalışıyor (Enter / C) — girdi komutun stdin'idir */
  let phase: 'idle' | 'input' | 'running' = 'idle';
  /** Satır geçmiş gezinmesiyle değişti — yakalanan metin güvenilmez. */
  let unreliable = false;

  function pushNew(): CommandBlock {
    const b = newBlock();
    if (pendingCwd) b.cwd = pendingCwd;
    blocks.value.push(b);
    // Reactive proxy'yi tut — ham nesneyi mutate etmek watcher'ları
    // tetiklemez (BlockPanel canlı güncellenmiyordu).
    const reactiveBlock = blocks.value[blocks.value.length - 1]!;
    activeBlock = reactiveBlock;
    return reactiveBlock;
  }

  function startRunning(command: string) {
    if (!activeBlock) pushNew();
    const raw = command;
    activeBlock!.command = raw.trim();
    activeBlock!.private = /^\s/.test(raw);
    activeBlock!.startedAt = new Date();
    activeBlock!.status = 'running';
    inputAccumulator = '';
    phase = 'running';
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
      phase = 'idle';
    },

    onCommandStart() {
      // Prompt sonrası, kullanıcı yazma evresi
      if (!activeBlock) pushNew();
      inputAccumulator = '';
      unreliable = false;
      phase = 'input';
    },

    onCommandRun(command: string) {
      // C, Enter ile zaten 'running'e geçmiş bir block için tekrar gelebilir —
      // yakalanmış komutu ezme.
      if (phase === 'running' && activeBlock?.status === 'running' && !command) return;
      startRunning(command || inputAccumulator);
    },

    onCommandEnd(exitCode: number) {
      if (!activeBlock) return;
      // Komut yakalanmadıysa (Enter gözlenmeden D geldi) input'tan al
      if (!activeBlock.command && phase === 'input' && inputAccumulator.trim()) {
        activeBlock.command = inputAccumulator.trim();
        activeBlock.private = /^\s/.test(inputAccumulator);
      }
      activeBlock.endedAt = new Date();
      activeBlock.exitCode = exitCode;
      activeBlock.status = exitCode === 0 ? 'success' : 'error';
      inputAccumulator = '';
      phase = 'idle';
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

    onUserInput(data: string, opts?: { altBuffer?: boolean }) {
      // Yalnızca prompt'ta (B ile komut çalışması arası) yazılanlar komuttur.
      // Çalışan komuta giden girdi (parola, y/n onayı) veya TUI girdisi
      // kaydedilmez — aksi halde `ssh`/`sudo` parolası geçmişe sızar.
      if (phase !== 'input' || !activeBlock || opts?.altBuffer) return;
      // Enter veya newline — komutu yakala
      if (data.includes('\r') || data.includes('\n')) {
        const finished = (inputAccumulator + data).split(/[\r\n]/)[0] ?? '';
        if (finished.trim() && !unreliable) startRunning(finished);
        else if (unreliable) startRunning('');
        else inputAccumulator = '';
        unreliable = false;
      } else if (data === '\x7f' || data === '\b') {
        // Backspace
        inputAccumulator = inputAccumulator.slice(0, -1);
      } else if (data.charCodeAt(0) === 0x03) {
        // Ctrl+C satırı iptal eder
        inputAccumulator = '';
      } else if (data === '\x1b[A' || data === '\x1b[B') {
        // ↑/↓ geçmiş gezinmesi satırı bizim göremediğimiz şekilde değiştirir —
        // yanlış komut kaydetmektense satırı "bilinmiyor" say.
        inputAccumulator = '';
        unreliable = true;
      } else if (data.charCodeAt(0) === 0x1b) {
        // Diğer ESC dizileri (←/→ vb.) — biriktirmeye dahil etme
      } else if (data.charCodeAt(0) >= 32 || data === '\t') {
        inputAccumulator += data;
      }
    },

    historyCommand(block: CommandBlock) {
      if (!block.command || block.private) return null;
      const { text, redactedLines } = redact(block.command);
      // Secret içeren komut geçmişe yazılmaz (redacte edilmiş hali de
      // anlamsız — tekrar çalıştırılamaz).
      if (redactedLines > 0 || text !== block.command) return null;
      return block.command;
    },

    remove(id: string) {
      blocks.value = blocks.value.filter((b) => b.id !== id);
    },

    clear() {
      blocks.value = [];
      activeBlock = null;
      inputAccumulator = '';
      phase = 'idle';
    },

    toggleCollapsed(id: string) {
      const b = blocks.value.find((x) => x.id === id);
      if (b) b.collapsed = !b.collapsed;
    },
  };
}

// Global registry — pane id'sinden tracker erişimi. shallowReactive: BlockPanel
// tracker kaydından önce mount olursa, kayıt geldiğinde computed yeniden çalışsın.
const trackerByPane = shallowReactive(new Map<string, BlockTracker>());

export function registerBlockTracker(paneId: string, tracker: BlockTracker) {
  trackerByPane.set(paneId, tracker);
}

export function unregisterBlockTracker(paneId: string) {
  trackerByPane.delete(paneId);
}

export function getBlockTracker(paneId: string): BlockTracker | null {
  return trackerByPane.get(paneId) ?? null;
}
