<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';

const props = defineProps<{
  leaf: LeafNode;
  focused: boolean;
  blockCount?: number;
  blockPanelOpen?: boolean;
}>();
const emit = defineEmits<{ close: []; toggleBlocks: [] }>();

const { t } = useI18n();

const typeLabel = computed(() => t(`pane.type.${props.leaf.type}`));
const statusLabel = computed(() => {
  if (props.leaf.status === 'exited') {
    return t('pane.status.exited', { code: props.leaf.exitCode ?? 0 });
  }
  return t(`pane.status.${props.leaf.status}`);
});

const title = computed(() => props.leaf.title || t('pane.untitled'));
</script>

<template>
  <div class="title-bar" :class="{ focused }">
    <div class="title-bar__indicator" :data-status="leaf.status" />
    <div class="title-bar__type">{{ typeLabel }}</div>
    <div class="title-bar__title">{{ title }}</div>
    <div class="title-bar__status">{{ statusLabel }}</div>
    <button
      v-if="blockCount && blockCount > 0"
      type="button"
      class="title-bar__blocks"
      :class="{ active: blockPanelOpen }"
      :title="t('block.title')"
      @click.stop="emit('toggleBlocks')"
    >
▣ {{ blockCount }}
</button>
    <button
      type="button"
      class="title-bar__close"
      :title="t('pane.close')"
      :aria-label="t('pane.close')"
      @click.stop="emit('close')"
    >
×
</button>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 6px;
  background: rgba(0, 0, 0, 0.4);
  border-bottom: 1px solid var(--color-line);
  font-size: 10px;
  user-select: none;
  flex-shrink: 0;
  height: 18px;
  font-family: var(--font-family);
}
.title-bar.focused {
  background: rgba(0, 180, 216, 0.1);
  border-bottom-color: var(--color-accent);
}
.title-bar__indicator {
  width: 6px;
  height: 6px;
  border-radius: 0;
  background: var(--color-dim);
  opacity: 0.6;
  flex-shrink: 0;
}
.title-bar__indicator[data-status="running"] {
  background: var(--color-green);
  opacity: 0.9;
}
.title-bar__indicator[data-status="error"] {
  background: var(--color-red);
  opacity: 0.9;
}
.title-bar__indicator[data-status="exited"] {
  background: var(--color-yellow);
  opacity: 0.7;
}
.title-bar__indicator[data-status="spawning"] {
  background: var(--color-accent);
  opacity: 0.6;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.title-bar__type {
  font-weight: 600;
  color: var(--color-accent);
  text-transform: lowercase;
  letter-spacing: 0;
  font-size: 9px;
}
.title-bar__type::after { content: ':'; }
.title-bar__title {
  flex: 1;
  font-family: var(--font-family);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-fg);
}
.title-bar__status {
  color: var(--color-dim);
  font-size: 9px;
}
.title-bar__blocks {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-dim);
  cursor: pointer;
  font-size: 9px;
  line-height: 1;
  padding: 1px 5px;
  border-radius: 2px;
  font-family: inherit;
}
.title-bar__blocks:hover,
.title-bar__blocks.active {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.title-bar__close {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 0;
}
.title-bar__close:hover {
  background: var(--color-red);
  opacity: 1;
}
</style>
