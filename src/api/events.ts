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
