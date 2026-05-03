<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { useAIStore } from '@/stores/ai';
import { useThemeStore } from '@/stores/theme';

const { t } = useI18n();
const panes = usePanesStore();
const ai = useAIStore();
const themeStore = useThemeStore();

const aiLabel = computed(() => {
  if (!ai.activeProvider) return t('statusBar.noProvider');
  return t('statusBar.activeProvider', { name: t(`ai.provider.${ai.activeProvider}`) });
});

const sidecarLabel = computed(() =>
  panes.sidecarAlive ? t('statusBar.ready') : t('statusBar.sidecarDown'),
);
</script>

<template>
  <footer class="status-bar">
    <span class="status-bar__item">{{ t('statusBar.panes', { count: panes.paneCount }) }}</span>
    <span class="status-bar__item">{{ aiLabel }}</span>
    <span class="status-bar__item">{{ themeStore.activeName }}</span>
    <button
      type="button"
      class="status-bar__item status-bar__broadcast"
      :class="{ on: panes.broadcastInput }"
      :title="t('statusBar.broadcastHint')"
      @click="panes.toggleBroadcast()"
    >
      ⌘ {{ panes.broadcastInput ? t('statusBar.broadcastOn') : t('statusBar.broadcastOff') }}
    </button>
    <span class="status-bar__sep" />
    <span
      class="status-bar__item status-bar__sidecar"
      :class="{ down: !panes.sidecarAlive }"
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
  background: rgba(0, 0, 0, 0.5);
  border-top: 1px solid var(--color-line);
  font-size: 10px;
  color: var(--color-dim);
  user-select: none;
  flex-shrink: 0;
  height: 18px;
  font-family: var(--font-family);
}
.status-bar__item::before { content: '['; opacity: 0.4; margin-right: 2px; }
.status-bar__item::after  { content: ']'; opacity: 0.4; margin-left: 2px; }
.status-bar__item {
  color: var(--color-dim);
}
.status-bar__sep {
  flex: 1;
}
.status-bar__sidecar.down {
  color: var(--color-red);
  opacity: 1;
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
