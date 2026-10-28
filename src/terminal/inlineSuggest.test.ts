import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInlineSuggest, pickBestSuggestion } from './inlineSuggest';
import type { HistoryEntry } from '@/types/history';

const h = (command: string, hoursAgo = 1, isFavorite = false): HistoryEntry => ({
  id: 0,
  command,
  executedAt: new Date(Date.now() - hoursAgo * 36e5).toISOString(),
  isFavorite,
});

describe('pickBestSuggestion', () => {
  it('prefix ile başlayan en yüksek frecency', () => {
    const r = pickBestSuggestion([h('git status'), h('git stash', 1), h('git stash', 2), h('ls')], 'git st');
    expect(r).toBe('git stash');
  });
  it('prefix ile birebir aynı ve çok satırlı komutlar atlanır', () => {
    expect(pickBestSuggestion([h('git'), h('git a\nb')], 'git')).toBeNull();
  });
});

describe('createInlineSuggest — yarış koruması', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cevap gelmeden tampon değişirse eski sonuç atılır', async () => {
    let buf: string | null = 'git s';
    let resolve!: (v: HistoryEntry[]) => void;
    const s = createInlineSuggest({
      enabled: () => true,
      buffer: () => buf,
      search: () => new Promise((r) => (resolve = r)),
    });
    s.schedule();
    await vi.advanceTimersByTimeAsync(100);
    // Kullanıcı Enter'a bastı — tampon bilinmiyor
    buf = null;
    resolve([h('git status')]);
    await vi.runAllTimersAsync();
    expect(s.suggestion.value).toBeNull();
  });

  it('clear uçuştaki isteği geçersiz kılar', async () => {
    let resolve!: (v: HistoryEntry[]) => void;
    const s = createInlineSuggest({
      enabled: () => true,
      buffer: () => 'git s',
      search: () => new Promise((r) => (resolve = r)),
    });
    s.schedule();
    await vi.advanceTimersByTimeAsync(100);
    s.clear();
    resolve([h('git status')]);
    await vi.runAllTimersAsync();
    expect(s.suggestion.value).toBeNull();
  });

  it('geçerli öneri suffix döner', async () => {
    const s = createInlineSuggest({
      enabled: () => true,
      buffer: () => 'git s',
      search: async () => [h('git status')],
    });
    s.schedule();
    await vi.runAllTimersAsync();
    expect(s.suggestion.value).toBe('git status');
    expect(s.acceptableSuffix('git s')).toBe('tatus');
    expect(s.acceptableSuffix('ls')).toBeNull();
  });

  it('baştaki boşluk (private) için öneri yok', async () => {
    const search = vi.fn(async () => [h(' git status')]);
    const s = createInlineSuggest({ enabled: () => true, buffer: () => ' git', search });
    s.schedule();
    await vi.runAllTimersAsync();
    expect(search).not.toHaveBeenCalled();
    expect(s.suggestion.value).toBeNull();
  });
});
