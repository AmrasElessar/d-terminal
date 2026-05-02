<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';

const props = defineProps<{ leaf: LeafNode; focused: boolean }>();
const emit = defineEmits<{ close: [] }>();

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
      type="button"
      class="title-bar__close"
      :title="t('pane.close')"
      :aria-label="t('pane.close')"
      @click.stop="emit('close')"
    >×</button>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.025);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  font-size: 11px;
  user-select: none;
  flex-shrink: 0;
}
.title-bar.focused {
  background: rgba(0, 180, 216, 0.06);
}
.title-bar__indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-fg);
  opacity: 0.4;
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
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-size: 10px;
}
.title-bar__title {
  flex: 1;
  font-family: var(--font-family);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.title-bar__status {
  opacity: 0.6;
  font-size: 10px;
}
.title-bar__close {
  background: transparent;
  border: none;
  color: var(--color-fg);
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 0 6px;
  border-radius: 3px;
  opacity: 0.6;
}
.title-bar__close:hover {
  background: var(--color-red);
  opacity: 1;
}
</style>
