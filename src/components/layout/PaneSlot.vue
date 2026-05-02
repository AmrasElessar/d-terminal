<script setup lang="ts">
import { computed } from 'vue';
import type { LeafNode } from '@/types/pane';
import { usePanesStore } from '@/stores/panes';
import PaneTitleBar from '@/components/ui/PaneTitleBar.vue';
import TerminalPane from '@/components/panes/TerminalPane.vue';
import AIChatPane from '@/components/panes/AIChatPane.vue';
import WelcomePane from '@/components/panes/WelcomePane.vue';
import ErrorPane from '@/components/panes/ErrorPane.vue';

const props = defineProps<{ leaf: LeafNode }>();
const panes = usePanesStore();

const isFocused = computed(() => panes.tree.focusedId === props.leaf.id);

function focus() {
  panes.focus(props.leaf.id);
}

function close() {
  panes.closePane(props.leaf.id);
}

const isTerminal = computed(() =>
  ['powershell', 'cmd', 'wsl'].includes(props.leaf.type),
);
</script>

<template>
  <div
    class="slot"
    :class="{ focused: isFocused, error: leaf.status === 'error' }"
    @mousedown="focus"
  >
    <PaneTitleBar :leaf="leaf" :focused="isFocused" @close="close" />
    <div class="slot__body">
      <ErrorPane v-if="leaf.status === 'error'" :leaf="leaf" />
      <TerminalPane v-else-if="isTerminal" :leaf="leaf" />
      <AIChatPane v-else-if="leaf.type === 'aiChat'" :leaf="leaf" />
      <WelcomePane v-else-if="leaf.type === 'welcome'" />
    </div>
  </div>
</template>

<style scoped>
.slot {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid transparent;
  transition: border-color 0.12s ease;
  background: var(--color-bg);
}
.slot.focused {
  border-color: var(--color-accent);
}
.slot.error {
  border-color: var(--color-red);
}
.slot__body {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
