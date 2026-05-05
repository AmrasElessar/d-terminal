<script setup lang="ts">
// AI Maliyet panosu — Settings → AI Maliyetleri sekmesi.
//
// Tüm veriler localStorage'dan okunur (aiUsage store). Görüntülenenler:
//   - Bugün / Bu hafta / Bu ay / Tüm zamanlar (token + ≈ $)
//   - Bu ay provider başına dağılım (progress bar + token + cost)
//   - Aylık limit ayarı (uyarı eşiği)
//   - JSON export, ham kayıt sil

import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useAIUsageStore } from '@/stores/aiUsage';
import { useToastsStore } from '@/stores/toasts';
import { formatUsageBadge } from '@/types/aiPricing';

const { t } = useI18n();
const usage = useAIUsageStore();
const toasts = useToastsStore();

const limitInput = ref<string>(usage.monthlyLimitUsd?.toString() ?? '');

function applyLimit() {
  const v = parseFloat(limitInput.value);
  usage.monthlyLimitUsd = Number.isFinite(v) && v > 0 ? v : null;
}

function clearLimit() {
  usage.monthlyLimitUsd = null;
  limitInput.value = '';
}

function clearAll() {
  if (!confirm(t('settings.aiCost.clearConfirm'))) return;
  usage.clear();
  toasts.success(t('settings.aiCost.cleared'));
}

async function exportJson() {
  try {
    const text = usage.exportJson();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toasts.success(t('settings.aiCost.exported'));
  } catch (e: unknown) {
    toasts.error(`${(e as Error).message}`);
  }
}

const totalMonthTokens = computed(() =>
  usage.monthByProvider.reduce((s, x) => s + x.tokens, 0),
);

function pct(tokens: number): number {
  const total = totalMonthTokens.value;
  return total === 0 ? 0 : Math.round((tokens / total) * 100);
}

function fmtCost(c: number | null): string {
  if (c === null) return '—';
  if (c === 0) return t('settings.aiCost.local');
  if (c < 0.01) return `<$0.01`;
  if (c < 1) return `≈ $${c.toFixed(4)}`;
  return `≈ $${c.toFixed(2)}`;
}
</script>

<template>
  <div class="cost">
    <header class="cost__head">
      <strong>{{ t('settings.aiCost.title') }}</strong>
      <small>{{ t('settings.aiCost.note') }}</small>
    </header>

    <div class="cost__cards">
      <div class="cost__card">
        <span class="cost__label">{{ t('settings.aiCost.today') }}</span>
        <span class="cost__value">{{ formatUsageBadge(usage.today) }}</span>
      </div>
      <div class="cost__card">
        <span class="cost__label">{{ t('settings.aiCost.week') }}</span>
        <span class="cost__value">{{ formatUsageBadge(usage.thisWeek) }}</span>
      </div>
      <div class="cost__card" :class="{ 'cost__card--warn': usage.monthlyOverLimit }">
        <span class="cost__label">{{ t('settings.aiCost.month') }}</span>
        <span class="cost__value">{{ formatUsageBadge(usage.thisMonth) }}</span>
        <small v-if="usage.monthlyOverLimit" class="cost__warn">
          ⚠ {{ t('settings.aiCost.limitExceeded') }}
        </small>
      </div>
      <div class="cost__card">
        <span class="cost__label">{{ t('settings.aiCost.allTime') }}</span>
        <span class="cost__value">{{ formatUsageBadge(usage.allTime) }}</span>
      </div>
    </div>

    <div class="cost__breakdown">
      <h3>{{ t('settings.aiCost.byProvider') }}</h3>
      <div v-if="usage.monthByProvider.length === 0" class="cost__empty">
        {{ t('settings.aiCost.empty') }}
      </div>
      <div v-else class="cost__bars">
        <div v-for="row in usage.monthByProvider" :key="row.provider" class="cost__bar">
          <span class="cost__provider">{{ t(`ai.provider.${row.provider}`) }}</span>
          <div class="cost__barTrack">
            <div class="cost__barFill" :style="{ width: pct(row.tokens) + '%' }" />
          </div>
          <span class="cost__barTokens">{{ (row.tokens / 1000).toFixed(1) }}k</span>
          <span class="cost__barCost">{{ fmtCost(row.costUsd) }}</span>
        </div>
      </div>
    </div>

    <div class="cost__limit">
      <h3>{{ t('settings.aiCost.monthlyLimit') }}</h3>
      <p class="cost__hint">{{ t('settings.aiCost.limitHint') }}</p>
      <div class="cost__limitRow">
        <span>$</span>
        <input
          v-model="limitInput"
          type="number"
          min="0"
          step="1"
          placeholder="50"
          @blur="applyLimit"
        />
        <button type="button" class="ghost" @click="applyLimit">{{ t('common.save') }}</button>
        <button v-if="usage.monthlyLimitUsd" type="button" class="ghost" @click="clearLimit">
          {{ t('common.clear') }}
        </button>
      </div>
    </div>

    <div class="cost__actions">
      <button type="button" class="ghost" @click="exportJson">
        ⬇ {{ t('settings.aiCost.exportJson') }}
      </button>
      <button type="button" class="ghost danger" @click="clearAll">
        🗑 {{ t('settings.aiCost.clearAll') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.cost { display: flex; flex-direction: column; gap: 16px; }
.cost__head {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cost__head strong { font-size: 14px; }
.cost__head small { font-size: 11px; opacity: 0.6; }
.cost__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}
.cost__card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 6px;
}
.cost__card--warn {
  border-color: var(--color-yellow, #ffbd2e);
  background: color-mix(in srgb, var(--color-yellow) 12%, transparent);
}
.cost__label {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}
.cost__value {
  font-family: var(--font-family);
  font-size: 14px;
  color: var(--color-accent);
}
.cost__warn { font-size: 10px; color: var(--color-yellow, #ffbd2e); }

.cost__breakdown h3 { font-size: 12px; margin: 0 0 8px; opacity: 0.8; }
.cost__bars { display: flex; flex-direction: column; gap: 6px; }
.cost__bar {
  display: grid;
  grid-template-columns: 100px 1fr 60px 80px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}
.cost__provider { opacity: 0.85; }
.cost__barTrack {
  height: 8px;
  background: color-mix(in srgb, var(--color-fg) 6%, transparent);
  border-radius: 4px;
  overflow: hidden;
}
.cost__barFill {
  height: 100%;
  background: var(--color-accent);
  transition: width 0.3s ease;
}
.cost__barTokens, .cost__barCost {
  font-family: var(--font-family);
  font-size: 11px;
  text-align: right;
  opacity: 0.85;
}
.cost__empty {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  opacity: 0.5;
}

.cost__limit h3 { font-size: 12px; margin: 0 0 4px; opacity: 0.8; }
.cost__hint { font-size: 11px; opacity: 0.6; margin: 0 0 8px; }
.cost__limitRow {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cost__limitRow input {
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 12%, transparent);
  border-radius: 4px;
  padding: 6px 8px;
  width: 100px;
  font-family: inherit;
}
.cost__actions { display: flex; gap: 8px; margin-top: 8px; }
.ghost {
  background: transparent;
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 14%, transparent);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.ghost:hover { background: color-mix(in srgb, var(--color-fg) 6%, transparent); }
.ghost.danger { color: var(--color-red, #ff5f57); border-color: color-mix(in srgb, var(--color-red, #ff5f57) 35%, transparent); }
</style>
