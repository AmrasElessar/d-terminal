// aiUsage — kayıt + zaman agregasyonları + quota.
// localStorage mock — `STORAGE_KEY`'i temizler her test öncesi.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAIUsageStore, type UsageRecord } from './aiUsage';

const STORAGE_KEY = 'dterm.aiUsage.v1';

function makeRecord(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    at: new Date().toISOString(),
    provider: 'openai',
    model: 'gpt-4o-mini',
    inputTokens: 1000,
    outputTokens: 500,
    costUsd: 0.001,
    paneId: 'p1',
    brainstorm: false,
    ...overrides,
  };
}

describe('useAIUsageStore', () => {
  beforeEach(() => {
    localStorage.clear();
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  it('Başlangıçta records boş', () => {
    const s = useAIUsageStore();
    expect(s.records).toEqual([]);
  });

  it('localStorage initial state oku', () => {
    const initial = [makeRecord({ paneId: 'preload' })];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    setActivePinia(createPinia()); // store yeniden init
    const s = useAIUsageStore();
    expect(s.records).toHaveLength(1);
    expect(s.records[0]?.paneId).toBe('preload');
  });

  it('record() ekler, at timestamp atar', () => {
    const s = useAIUsageStore();
    s.record({
      provider: 'anthropic',
      model: 'claude-3-5-sonnet',
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.005,
      paneId: 'p1',
      brainstorm: false,
    });
    expect(s.records).toHaveLength(1);
    expect(s.records[0]?.at).toBeTruthy();
    expect(new Date(s.records[0]!.at).getTime()).not.toBeNaN();
  });

  it('recordEstimate token=0 ise eklemez', () => {
    const s = useAIUsageStore();
    s.recordEstimate('openai', 'gpt-4o', 'p1', {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    });
    expect(s.records).toHaveLength(0);
  });

  it('recordEstimate token>0 ise ekler', () => {
    const s = useAIUsageStore();
    s.recordEstimate('openai', 'gpt-4o', 'p1', {
      inputTokens: 100,
      outputTokens: 200,
      costUsd: 0.001,
    });
    expect(s.records).toHaveLength(1);
  });

  it('clear() records temizler ve persist tetiklenir', async () => {
    vi.useFakeTimers();
    const s = useAIUsageStore();
    s.record(makeRecord());
    s.clear();
    expect(s.records).toEqual([]);
    vi.advanceTimersByTime(600);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('[]');
  });

  it('exportJson tüm records JSON döner', () => {
    const s = useAIUsageStore();
    s.record(makeRecord({ paneId: 'a' }));
    s.record(makeRecord({ paneId: 'b' }));
    const json = s.exportJson();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].paneId).toBe('a');
  });

  // recordsBetween [from, to) strict less-than kullanır; "şu an"ı kaçırmamak
  // için kayıt zamanını 1 saniye geriye al.
  function nowMinus(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
  }

  it('today aggregation: bugünkü kayıtlar toplanır', () => {
    const s = useAIUsageStore();
    s.records.push(
      makeRecord({ at: nowMinus(1000), inputTokens: 100, outputTokens: 50, costUsd: 0.01 }),
    );
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    s.records.push(makeRecord({ at: yesterday.toISOString(), inputTokens: 999, outputTokens: 999, costUsd: 9.99 }));
    expect(s.today.inputTokens).toBe(100);
    expect(s.today.costUsd).toBeCloseTo(0.01);
  });

  it('thisMonth bu ayın kayıtlarını toplar', () => {
    const s = useAIUsageStore();
    s.records.push(makeRecord({ at: nowMinus(1000), inputTokens: 500, outputTokens: 250, costUsd: 0.02 }));
    const lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1);
    s.records.push(makeRecord({ at: lastMonth.toISOString(), inputTokens: 1_000_000, outputTokens: 0, costUsd: 50 }));
    expect(s.thisMonth.inputTokens).toBe(500);
    expect(s.thisMonth.costUsd).toBeCloseTo(0.02);
  });

  it('monthByProvider — provider başına token + cost', () => {
    const s = useAIUsageStore();
    const now = nowMinus(1000);
    s.records.push(makeRecord({ at: now, provider: 'openai', inputTokens: 100, outputTokens: 200, costUsd: 0.01 }));
    s.records.push(makeRecord({ at: now, provider: 'openai', inputTokens: 50, outputTokens: 100, costUsd: 0.005 }));
    s.records.push(makeRecord({ at: now, provider: 'anthropic', inputTokens: 1000, outputTokens: 500, costUsd: 0.05 }));
    const byProvider = s.monthByProvider;
    const oa = byProvider.find((p) => p.provider === 'openai')!;
    const an = byProvider.find((p) => p.provider === 'anthropic')!;
    expect(oa.tokens).toBe(450);
    expect(oa.costUsd).toBeCloseTo(0.015);
    expect(an.tokens).toBe(1500);
  });

  it('monthlyOverLimit: limit null ise daima false', () => {
    const s = useAIUsageStore();
    s.records.push(makeRecord({ at: nowMinus(1000), costUsd: 999 }));
    expect(s.monthlyOverLimit).toBe(false);
  });

  it('monthlyOverLimit: limit + cost karşılaştırma', () => {
    const s = useAIUsageStore();
    s.monthlyLimitUsd = 10;
    s.records.push(makeRecord({ at: nowMinus(2000), costUsd: 5 }));
    expect(s.monthlyOverLimit).toBe(false);
    s.records.push(makeRecord({ at: nowMinus(1000), costUsd: 10 }));
    expect(s.monthlyOverLimit).toBe(true);
  });

  it('Bozuk localStorage JSON → boş başlangıç (catch fallback)', () => {
    localStorage.setItem(STORAGE_KEY, 'NOT-JSON{{');
    setActivePinia(createPinia());
    const s = useAIUsageStore();
    expect(s.records).toEqual([]);
  });
});
