// Toast store — push/dismiss/duration/actions.
// vi.useFakeTimers ile setTimeout deterministik.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useToastsStore } from './toasts';

describe('useToastsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('push items dizisine ekler ve id döner', () => {
    const s = useToastsStore();
    const id = s.push('info', 'merhaba');
    expect(typeof id).toBe('number');
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.message).toBe('merhaba');
    expect(s.items[0]?.kind).toBe('info');
  });

  it('default duration 3500ms — setTimeout sonrası auto-dismiss', () => {
    const s = useToastsStore();
    s.push('info', 'auto');
    expect(s.items.length).toBe(1);
    vi.advanceTimersByTime(3499);
    expect(s.items.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(s.items.length).toBe(0);
  });

  it('duration:0 → manuel dismiss gerekli, auto-dismiss yok', () => {
    const s = useToastsStore();
    s.push('warning', 'persistent', { duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(s.items.length).toBe(1);
  });

  it('dismiss(id) ilgili toast kaldırır, diğerleri kalır', () => {
    const s = useToastsStore();
    const id1 = s.push('info', 'a');
    s.push('info', 'b');
    s.dismiss(id1);
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.message).toBe('b');
  });

  it('info/success/warning/error helper doğru kind atar', () => {
    const s = useToastsStore();
    s.info('i');
    s.success('s');
    s.warning('w');
    s.error('e');
    const kinds = s.items.map((t) => t.kind);
    expect(kinds).toEqual(['info', 'success', 'warning', 'error']);
  });

  it('error default duration 6000ms (info default 3500 ms degerinden uzun)', () => {
    const s = useToastsStore();
    s.error('hata');
    vi.advanceTimersByTime(3500);
    expect(s.items.length).toBe(1); // info ise burada kapanırdı
    vi.advanceTimersByTime(2500);
    expect(s.items.length).toBe(0);
  });

  it('helper number argümanı opts.duration olarak yorumlanır', () => {
    const s = useToastsStore();
    s.info('shortlife', 1000);
    vi.advanceTimersByTime(999);
    expect(s.items.length).toBe(1);
    vi.advanceTimersByTime(1);
    expect(s.items.length).toBe(0);
  });

  it('actions seçeneği items içine iletilir', () => {
    const s = useToastsStore();
    const handler = vi.fn();
    s.push('success', 'tamam', {
      duration: 0,
      actions: [{ label: 'Undo', handler, primary: true }],
    });
    expect(s.items[0]?.actions).toHaveLength(1);
    expect(s.items[0]?.actions?.[0]?.label).toBe('Undo');
    expect(s.items[0]?.actions?.[0]?.primary).toBe(true);
  });

  it('birden çok toast birlikte kalır, sırayla auto-dismiss', () => {
    const s = useToastsStore();
    s.push('info', 'a', { duration: 1000 });
    s.push('info', 'b', { duration: 2000 });
    expect(s.items.length).toBe(2);
    vi.advanceTimersByTime(1000);
    expect(s.items.length).toBe(1);
    expect(s.items[0]?.message).toBe('b');
    vi.advanceTimersByTime(1000);
    expect(s.items.length).toBe(0);
  });

  it('aynı id ile dismiss tekrar çağrılırsa no-op', () => {
    const s = useToastsStore();
    const id = s.push('info', 'a', { duration: 0 });
    s.dismiss(id);
    s.dismiss(id); // tekrar
    expect(s.items.length).toBe(0);
  });
});
