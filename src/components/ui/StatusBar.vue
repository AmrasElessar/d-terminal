<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { useAIStore } from '@/stores/ai';
import { useThemeStore } from '@/stores/theme';
import { useAgentWatchStore } from '@/stores/agentWatch';

const { t } = useI18n();
const panes = usePanesStore();
const ai = useAIStore();
const themeStore = useThemeStore();
const agentWatch = useAgentWatchStore();

const aiLabel = computed(() => {
  if (!ai.activeProvider) return t('statusBar.noProvider');
  return t('statusBar.activeProvider', { name: t(`ai.provider.${ai.activeProvider}`) });
});

const sidecarLabel = computed(() =>
  panes.sidecarAlive ? t('statusBar.ready') : t('statusBar.sidecarDown'),
);

/** Tüm pane'lerin agent token+cost toplamı — alt bar'da kompakt göster.
 *  Toplam token > 0 olunca chip görünür, aksi halde gizli (kalabalık olmasın). */
const agentTokensText = computed(() => {
  const s = agentWatch.globalSummary;
  if (s.totalTokens === 0) return '';
  const tok = s.totalTokens < 1000
    ? `${s.totalTokens}`
    : s.totalTokens < 100_000
      ? `${(s.totalTokens / 1000).toFixed(1)}k`
      : `${Math.round(s.totalTokens / 1000)}k`;
  return `Σ ${tok} tok`;
});
const agentCostText = computed(() => {
  const c = agentWatch.globalSummary.totalCost;
  if (c === null || c === 0) return '';
  if (c < 0.001) return 'Σ <$0.001';
  if (c < 1)    return `Σ $${c.toFixed(4)}`;
  return `Σ $${c.toFixed(2)}`;
});
</script>

<template>
  <footer class="status-bar">
    <span class="status-bar__item status-bar__item--panes">
      {{ t('statusBar.panes', { count: panes.paneCount }) }}
    </span>
    <span class="status-bar__item status-bar__item--ai" :class="{ off: !ai.activeProvider }">
      {{ aiLabel }}
    </span>
    <span class="status-bar__item status-bar__item--theme">
      {{ themeStore.activeName }}
    </span>
    <button
      type="button"
      class="status-bar__item status-bar__broadcast"
      :class="{ on: panes.broadcastInput }"
      :title="t('statusBar.broadcastHint')"
      @click="panes.toggleBroadcast()"
    >
      ⌘ {{ panes.broadcastInput ? t('statusBar.broadcastOn') : t('statusBar.broadcastOff') }}
    </button>
    <span
      v-if="agentTokensText"
      class="status-bar__item status-bar__item--tokens"
      :title="t('statusBar.agentTokensHint')"
    >{{ agentTokensText }}</span>
    <span
      v-if="agentCostText"
      class="status-bar__item status-bar__item--cost"
      :title="t('statusBar.agentCostHint')"
    >{{ agentCostText }}</span>
    <span class="status-bar__sep" />
    <span
      class="status-bar__item status-bar__sidecar"
      :class="{ down: !panes.sidecarAlive, up: panes.sidecarAlive }"
    >
      {{ sidecarLabel }}
    </span>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 1px 8px;
  background: var(--color-overlay-medium);
  border-top: 1px solid var(--color-line);
  font-size: 10px;
  color: var(--color-dim);
  user-select: none;
  flex-shrink: 0;
  height: 18px;
  font-family: var(--font-family);
}
/* Bracket'ler ([ ... ]) tüm itemlerde aynı dim renkte — içerik tema rengini
   alırken parantez göz önünde bağırmasın. */
.status-bar__item::before {
  content: '[';
  color: var(--color-dim);
  opacity: 0.5;
  margin-right: 2px;
}
.status-bar__item::after {
  content: ']';
  color: var(--color-dim);
  opacity: 0.5;
  margin-left: 2px;
}
.status-bar__item {
  color: var(--color-dim);
}
/* Her bilgi için temaya özel renk — ANSI palet'inden, color-mix ile
   metni biraz yumuşatıyoruz (saturated tonlar 10pt'de yorucu olur). */
.status-bar__item--panes {
  color: color-mix(in srgb, var(--color-cyan) 80%, var(--color-fg));
}
.status-bar__item--ai {
  color: color-mix(in srgb, var(--color-magenta) 75%, var(--color-fg));
}
.status-bar__item--ai.off {
  color: var(--color-dim);
}
.status-bar__item--theme {
  color: color-mix(in srgb, var(--color-yellow) 75%, var(--color-fg));
}
/* Agent toplam metrikler — sadece aktivite varsa görünür (v-if).
   Cyan token, yellow cost: title bar inline counter ile aynı palet. */
.status-bar__item--tokens {
  color: color-mix(in srgb, var(--color-cyan) 80%, var(--color-fg));
  font-variant-numeric: tabular-nums;
  cursor: help;
}
.status-bar__item--cost {
  color: color-mix(in srgb, var(--color-yellow) 80%, var(--color-fg));
  font-variant-numeric: tabular-nums;
  cursor: help;
}
.status-bar__sep {
  flex: 1;
}
.status-bar__sidecar.up {
  color: color-mix(in srgb, var(--color-green) 80%, var(--color-fg));
}
.status-bar__sidecar.down {
  color: var(--color-red);
  opacity: 1;
  animation: statusBarPulse 1.6s ease-in-out infinite;
}
@keyframes statusBarPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.status-bar__broadcast {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-family: inherit;
  font-size: 10px;
  padding: 0;
}
.status-bar__broadcast.on {
  color: var(--color-yellow);
  text-shadow: 0 0 4px var(--color-yellow);
}
</style>
