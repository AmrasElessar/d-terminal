<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SplitNode } from '@/types/pane';
import { usePanesStore } from '@/stores/panes';
import PaneSlot from './PaneSlot.vue';

const props = defineProps<{ node: SplitNode }>();
const panes = usePanesStore();

const isHorizontal = computed(() => props.node.direction === 'horizontal');
const dragging = ref(false);

function startDrag(e: PointerEvent) {
  dragging.value = true;
  const target = e.currentTarget as HTMLElement;
  const container = target.parentElement!;
  const rect = container.getBoundingClientRect();

  const move = (ev: PointerEvent) => {
    const ratio = isHorizontal.value
      ? (ev.clientX - rect.left) / rect.width
      : (ev.clientY - rect.top) / rect.height;
    panes.setSplitRatio(props.node.id, ratio);
  };
  const stop = () => {
    dragging.value = false;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', stop);
}

const firstStyle = computed(() => ({
  flex: `${props.node.ratio} 1 0%`,
  minWidth: 0,
  minHeight: 0,
}));
const secondStyle = computed(() => ({
  flex: `${1 - props.node.ratio} 1 0%`,
  minWidth: 0,
  minHeight: 0,
}));
</script>

<template>
  <div class="split" :class="{ horizontal: isHorizontal, vertical: !isHorizontal }">
    <div class="split__pane" :style="firstStyle">
      <SplitContainer v-if="node.first.kind === 'split'" :node="node.first" />
      <PaneSlot v-else :leaf="node.first" />
    </div>
    <div
      class="split__divider"
      :class="{ dragging }"
      @pointerdown.prevent="startDrag"
    />
    <div class="split__pane" :style="secondStyle">
      <SplitContainer v-if="node.second.kind === 'split'" :node="node.second" />
      <PaneSlot v-else :leaf="node.second" />
    </div>
  </div>
</template>

<style scoped>
.split {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}
.split.horizontal {
  flex-direction: row;
}
.split.vertical {
  flex-direction: column;
}
.split__pane {
  display: flex;
  min-width: 0;
  min-height: 0;
}
.split__divider {
  background: rgba(255, 255, 255, 0.04);
  transition: background 0.15s ease;
  flex-shrink: 0;
}
.split__divider:hover,
.split__divider.dragging {
  background: var(--color-accent);
}
.horizontal > .split__divider {
  width: 4px;
  cursor: col-resize;
}
.vertical > .split__divider {
  height: 4px;
  cursor: row-resize;
}
</style>
