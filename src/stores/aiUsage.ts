// AI kullanım/maliyet kaydı.
//
// Her stream tamamlandığında bir kayıt eklenir. localStorage'da persist edilir
// (SQLite migration yerine pragmatik tercih — ay sonunda export edilebilir
// JSON, aylık kayıt kayda değer hacim oluşturmaz).

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ProviderId } from '@/types/ai';
import { type UsageEstimate, sumUsage } from '@/types/aiPricing';

export interface UsageRecord {
  /** ISO 8601 timestamp */
  at: string;
  provider: ProviderId;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** USD; null = bilinmiyor (model fiyat tablosunda yok) */
  costUsd: number | null;
  /** Hangi pane (leaf id). Multi-pane ayrımı için. Brainstorm aynı pane'de
   *  birden fazla kayıt üretir (provider başına bir tane). */
  paneId: string;
  /** Brainstorm modunda mı çalışıldı (raporda istatistik için). */
  brainstorm: boolean;
}

const STORAGE_KEY = 'dterm.aiUsage.v1';
const MAX_RECORDS = 50_000; // ~birkaç yıllık yoğun kullanım — sonra rotate

function loadInitial(): UsageRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as UsageRecord[];
  } catch {
    return [];
  }
}

export const useAIUsageStore = defineStore('aiUsage', () => {
  const records = ref<UsageRecord[]>(loadInitial());
  /** Kullanıcı aylık eşik koyabilir; aşılırsa ana ekranda uyarı gösterilir. */
  const monthlyLimitUsd = ref<number | null>(null);

  // Persist — manuel + 500ms debounce. 50K rekord deep watch çok pahalı,
  // ekleme/silme her zaman bizim mutator'ımızdan geçiyor; ortak persist'i
  // o noktada planlıyoruz.
  let persistTimer: number | undefined;
  /** QuotaExceeded uyarısını her persist denemesinde tekrar çıkarma — bir kez
   *  uyar, sonraki başarılı persist'te tekrar uyarmaya hazırla. */
  let quotaWarned = false;
  function persist() {
    if (persistTimer !== undefined) window.clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => {
      persistTimer = undefined;
      try {
        const cur = records.value;
        const trimmed = cur.length > MAX_RECORDS ? cur.slice(-MAX_RECORDS) : cur;
        if (trimmed.length !== cur.length) records.value = trimmed;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        quotaWarned = false;
      } catch (e) {
        // QuotaExceeded → kullanıcı son kayıtların kaybolabileceğini bilsin.
        // Tekrar tekrar uyarma (debounced persist sürekli düşmesin).
        if (!quotaWarned) {
          quotaWarned = true;
          console.warn('[aiUsage] localStorage persist failed (quota?):', e);
        }
      }
    }, 500);
  }

  function record(input: Omit<UsageRecord, 'at'>) {
    records.value.push({ ...input, at: new Date().toISOString() });
    persist();
  }

  function recordEstimate(
    provider: ProviderId,
    model: string,
    paneId: string,
    estimate: UsageEstimate,
    brainstorm = false,
  ) {
    if (estimate.inputTokens === 0 && estimate.outputTokens === 0) return;
    record({
      provider,
      model,
      paneId,
      brainstorm,
      inputTokens: estimate.inputTokens,
      outputTokens: estimate.outputTokens,
      costUsd: estimate.costUsd,
    });
  }

  function clear() {
    records.value = [];
    persist();
  }

  function exportJson(): string {
    return JSON.stringify(records.value, null, 2);
  }

  // ---- Aggregations ----
  function recordsBetween(fromMs: number, toMs: number): UsageRecord[] {
    return records.value.filter((r) => {
      const ts = Date.parse(r.at);
      return ts >= fromMs && ts < toMs;
    });
  }

  function asEstimate(r: UsageRecord): UsageEstimate {
    return { inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd };
  }

  function sumOf(rs: UsageRecord[]): UsageEstimate {
    return sumUsage(rs.map(asEstimate));
  }

  function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); }
  function startOfWeek(d: Date) {
    const x = new Date(d); x.setHours(0, 0, 0, 0);
    const day = x.getDay() === 0 ? 6 : x.getDay() - 1; // Pazartesi = 0
    x.setDate(x.getDate() - day);
    return x.getTime();
  }
  function startOfMonth(d: Date) {
    const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(1); return x.getTime();
  }

  const today = computed(() => sumOf(recordsBetween(startOfDay(new Date()), Date.now())));
  const thisWeek = computed(() => sumOf(recordsBetween(startOfWeek(new Date()), Date.now())));
  const thisMonth = computed(() => sumOf(recordsBetween(startOfMonth(new Date()), Date.now())));
  const allTime = computed(() => sumOf(records.value));

  /** Provider başına bu ayın token toplamı (UI'de progress bar için). */
  const monthByProvider = computed<Array<{ provider: ProviderId; tokens: number; costUsd: number | null }>>(() => {
    const month = recordsBetween(startOfMonth(new Date()), Date.now());
    const map = new Map<ProviderId, { tokens: number; cost: number | null }>();
    for (const r of month) {
      const cur = map.get(r.provider) ?? { tokens: 0, cost: 0 as number | null };
      cur.tokens += r.inputTokens + r.outputTokens;
      if (cur.cost === null || r.costUsd === null) cur.cost = null;
      else cur.cost += r.costUsd;
      map.set(r.provider, cur);
    }
    return [...map.entries()].map(([provider, v]) => ({
      provider,
      tokens: v.tokens,
      costUsd: v.cost,
    }));
  });

  /** Aylık limit aşıldı mı (uyarı için). */
  const monthlyOverLimit = computed(() => {
    const cap = monthlyLimitUsd.value;
    if (!cap) return false;
    const cost = thisMonth.value.costUsd;
    return cost !== null && cost >= cap;
  });

  return {
    records,
    monthlyLimitUsd,
    record,
    recordEstimate,
    clear,
    exportJson,
    today,
    thisWeek,
    thisMonth,
    allTime,
    monthByProvider,
    monthlyOverLimit,
  };
});
