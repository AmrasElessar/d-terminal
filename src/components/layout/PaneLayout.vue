<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import SplitContainer from './SplitContainer.vue';
import PaneSlot from './PaneSlot.vue';
import WelcomePane from '@/components/panes/WelcomePane.vue';

const panes = usePanesStore();
const { t } = useI18n();
const root = computed(() => panes.tree.root);
const maximized = computed(() => panes.maximizedLeaf);
</script>

<template>
  <div class="pane-layout">
    <!-- Zoom modu: tek pane tam ekran (tmux z, Warp ⌘⇧↵). ESC veya kısayolla geri dön. -->
    <template v-if="maximized">
      <div class="pane-layout__zoom">
        <PaneSlot :leaf="maximized" />
        <div class="pane-layout__zoom-hint">
          {{ t('pane.zoomHint') }}
        </div>
      </div>
    </template>
    <template v-else-if="root">
      <SplitContainer v-if="root.kind === 'split'" :node="root" />
      <PaneSlot v-else :leaf="root" />
    </template>
    <WelcomePane v-else />
  </div>
</template>

<style scoped>
.pane-layout {
  flex: 1;
  display: flex;
  min-height: 0;
  /* Transparent — pane'ler kendi bg'lerini sunar; alttan body color-mix görünür */
  background: transparent;
  position: relative;
}
.pane-layout__zoom {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
}
.pane-layout__zoom-hint {
  position: absolute;
  bottom: 6px;
  right: 8px;
  background: var(--color-overlay-dark);
  border: 1px solid var(--color-accent);
  color: var(--color-accent);
  padding: 2px 8px;
  border-radius: 2px;
  font-family: var(--font-family);
  font-size: 10px;
  pointer-events: none;
  z-index: 10;
}
</style>
