<script setup lang="ts">
import { computed } from 'vue';
import { usePanesStore } from '@/stores/panes';
import SplitContainer from './SplitContainer.vue';
import PaneSlot from './PaneSlot.vue';
import WelcomePane from '@/components/panes/WelcomePane.vue';

const panes = usePanesStore();
const root = computed(() => panes.tree.root);
</script>

<template>
  <div class="pane-layout">
    <template v-if="root">
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
  background: var(--color-bg);
}
</style>
