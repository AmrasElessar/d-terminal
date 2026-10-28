import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (e: { payload: unknown }) => void;
const { handlers } = vi.hoisted(() => ({ handlers: [] as Handler[] }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_topic: string, h: Handler) => {
    handlers.push(h);
    return () => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }),
}));

import { createPtyStream } from './ptyStream';

function b64(bytes: number[]): string {
  return btoa(String.fromCharCode(...bytes));
}
function emit(pane: string, bytes: number[]) {
  for (const h of [...handlers]) h({ payload: { kind: 'stdout', pane_id: pane, data: b64(bytes) } });
}
const flushRaf = () => new Promise((r) => setTimeout(r, 40));

describe('createPtyStream', () => {
  beforeEach(() => {
    handlers.length = 0;
  });

  it('yalnızca bağlı PTY çıktısını iletir', async () => {
    const got: string[] = [];
    const s = createPtyStream((_b, text) => got.push(text));
    await s.start();
    s.bind('p1');
    emit('p1', [104, 105]);
    emit('p2', [120]);
    await flushRaf();
    expect(got.join('')).toBe('hi');
    s.stop();
  });

  it('bind öncesi gelen erken çıktı replay edilir', async () => {
    const got: string[] = [];
    const s = createPtyStream((_b, text) => got.push(text));
    await s.start();
    emit('p1', [65]);
    emit('other', [66]);
    s.bind('p1');
    await flushRaf();
    expect(got.join('')).toBe('A');
    s.stop();
  });

  it('chunk sınırında bölünen UTF-8 karakter bozulmaz (streaming decoder)', async () => {
    const got: string[] = [];
    const s = createPtyStream((_b, text) => got.push(text));
    await s.start();
    s.bind('p');
    // "ş" = C5 9F
    emit('p', [0xc5]);
    await flushRaf();
    emit('p', [0x9f, 0x0a]);
    await flushRaf();
    expect(got.join('')).toBe('ş\n');
    expect(got.join('')).not.toContain('�');
    s.stop();
  });

  it('stop sonrası listener kalkar, çıktı iletilmez', async () => {
    const onFlush = vi.fn();
    const s = createPtyStream(onFlush);
    await s.start();
    s.bind('p');
    s.stop();
    expect(handlers.length).toBe(0);
    emit('p', [1]);
    await flushRaf();
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('start bitmeden stop edilirse listener sızmaz', async () => {
    const s = createPtyStream(() => {});
    const p = s.start();
    s.stop();
    await p;
    expect(handlers.length).toBe(0);
  });
});
