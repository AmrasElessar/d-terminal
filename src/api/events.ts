// Tauri event subscription helper'ları.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { PtyEvent } from '@/types/events';

export type Topic =
  | 'pty://stdout'
  | 'pty://exit'
  | 'pty://error'
  | 'sidecar://up'
  | 'sidecar://down';

export async function on<T = unknown>(topic: Topic, handler: (payload: T) => void): Promise<UnlistenFn> {
  return listen<T>(topic, (e) => handler(e.payload));
}

/** Tek bir handler'a tüm pty/sidecar event'lerini topla — pane store kullanıyor. */
export async function onAllPty(handler: (event: PtyEvent) => void): Promise<UnlistenFn[]> {
  const topics: Topic[] = [
    'pty://stdout',
    'pty://exit',
    'pty://error',
    'sidecar://up',
    'sidecar://down',
  ];
  const unlisteners = await Promise.all(
    topics.map((t) => listen<PtyEvent>(t, (e) => handler(e.payload))),
  );
  return unlisteners;
}

/** `pty://stdout` payload'ındaki `data` alanını byte dizisine çevirir.
 *  Backend base64 (standart alfabe, padding'li) string gönderir — JSON sayı
 *  dizisine göre ~3-4× daha az IPC trafiği. Eski backend'lerle uyum için
 *  number[] de kabul edilir. Bozuk base64 → boş dizi (xterm'e çöp yazma). */
export function decodePtyData(data: string | number[] | Uint8Array | null | undefined): Uint8Array {
  if (data == null) return new Uint8Array(0);
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return Uint8Array.from(data);
  if (typeof data !== 'string' || data.length === 0) return new Uint8Array(0);
  let bin: string;
  try {
    bin = atob(data);
  } catch {
    return new Uint8Array(0);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
