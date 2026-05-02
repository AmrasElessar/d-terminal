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
  gap: 16px;
  padding: 4px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 11px;
  color: var(--color-fg);
  user-select: none;
  flex-shrink: 0;
}
.status-bar__item {
  opacity: 0.7;
}
.status-bar__sep {
  flex: 1;
}
.status-bar__sidecar.down {
  color: var(--color-red);
  opacity: 1;
}
</style>
