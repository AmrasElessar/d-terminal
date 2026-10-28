// PTY stdout akışı — pane başına tek listener + RAF coalescing + streaming
// UTF-8 decoder.
//
// - RAF coalescing: backend 16ms coalescing yapıyor ama frontend her event'te
//   `term.write` çağırınca WebGL + DOM repaint her event'te tetikleniyordu.
//   Pending bytes bir frame içinde birleştirilir.
// - Streaming decoder: chunk sınırında bölünen çok baytlı karakterler (ş, ğ,
//   emoji) trigger/block metninde U+FFFD'ye dönüşmesin (`{ stream: true }`).
// - Erken çıktı: listener spawn'dan ÖNCE kurulur; PTY id'si henüz bilinmezken
//   gelen chunk'lar sınırlı bir tamponda bekler, id öğrenilince replay edilir
//   (ilk prompt/banner kaybolmasın).

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { decodePtyData } from '@/api/events';
import type { PtyEvent } from '@/types/events';

/** Pencere minimize iken RAF durur; bu kadar birikince senkron flush. */
const MAX_PENDING_BYTES = 4 * 1024 * 1024;
/** PTY id bilinmeden önce tutulacak erken çıktı üst sınırı (tüm pane'ler). */
const MAX_EARLY_BYTES = 256 * 1024;

export type FlushHandler = (bytes: Uint8Array, text: string) => void;

export interface PtyStream {
  /** Listener'ı kur (idempotent). PTY id'si henüz yoksa erken tampona alır. */
  start(): Promise<void>;
  /** PTY id'sini bağla; erken tampondaki eşleşen chunk'lar replay edilir. */
  bind(ptyId: string): void;
  readonly ptyId: string | null;
  /** Listener'ı kaldır, pending RAF iptal. */
  stop(): void;
}

export function createPtyStream(onFlush: FlushHandler): PtyStream {
  let unlisten: UnlistenFn | null = null;
  let starting: Promise<void> | null = null;
  let stopped = false;
  let ptyId: string | null = null;
  let rafId: number | null = null;
  let pending: Uint8Array[] = [];
  let pendingLen = 0;
  let early: Array<{ pane: string; bytes: Uint8Array }> = [];
  let earlyLen = 0;
  let decoder = new TextDecoder('utf-8', { fatal: false });

  function flush() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (pending.length === 0) return;
    let merged: Uint8Array;
    if (pending.length === 1) {
      merged = pending[0]!;
    } else {
      merged = new Uint8Array(pendingLen);
      let off = 0;
      for (const c of pending) {
        merged.set(c, off);
        off += c.length;
      }
    }
    pending = [];
    pendingLen = 0;
    const text = decoder.decode(merged, { stream: true });
    onFlush(merged, text);
  }

  function enqueue(bytes: Uint8Array) {
    if (bytes.length === 0) return;
    pending.push(bytes);
    pendingLen += bytes.length;
    if (pendingLen >= MAX_PENDING_BYTES) {
      flush();
      return;
    }
    if (rafId === null) rafId = requestAnimationFrame(flush);
  }

  function onEvent(payload: PtyEvent) {
    if (stopped || payload.kind !== 'stdout') return;
    if (ptyId === null) {
      const bytes = decodePtyData(payload.data);
      early.push({ pane: payload.pane_id, bytes });
      earlyLen += bytes.length;
      while (earlyLen > MAX_EARLY_BYTES && early.length > 0) {
        earlyLen -= early.shift()!.bytes.length;
      }
      return;
    }
    if (payload.pane_id !== ptyId) return;
    enqueue(decodePtyData(payload.data));
  }

  return {
    get ptyId() {
      return ptyId;
    },
    async start() {
      if (unlisten || stopped) return;
      if (!starting) {
        starting = listen<PtyEvent>('pty://stdout', (e) => onEvent(e.payload)).then((fn) => {
          if (stopped) fn();
          else unlisten = fn;
        });
      }
      await starting;
    },
    bind(id: string) {
      if (ptyId === id) return;
      // Farklı PTY'ye geçiş (yeniden spawn) — eski PTY'nin bekleyen baytları
      // yeni decoder'a karışmasın.
      flush();
      ptyId = id;
      decoder = new TextDecoder('utf-8', { fatal: false });
      const mine = early.filter((e) => e.pane === id);
      early = [];
      earlyLen = 0;
      for (const e of mine) enqueue(e.bytes);
    },
    stop() {
      stopped = true;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pending = [];
      pendingLen = 0;
      early = [];
      earlyLen = 0;
      if (unlisten) {
        unlisten();
        unlisten = null;
      }
    },
  };
}
