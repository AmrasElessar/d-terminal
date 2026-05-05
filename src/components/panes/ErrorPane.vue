<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';
import { usePanesStore } from '@/stores/panes';

const props = defineProps<{ leaf: LeafNode }>();
const { t } = useI18n();
const panes = usePanesStore();

function close() {
  panes.closePane(props.leaf.id);
}
</script>

<template>
  <div class="error-pane">
    <h3>{{ t('common.error') }}</h3>
    <p class="msg">{{ leaf.errorMessage ?? t('errors.generic') }}</p>
    <div class="actions">
      <button type="button" @click="close">{{ t('common.close') }}</button>
    </div>
  </div>
</template>

<style scoped>
.error-pane {
  flex: 1;
  padding: 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--color-fg);
}
h3 {
  color: var(--color-red);
  margin: 0;
}
.msg {
  font-family: var(--font-family);
  font-size: 13px;
  text-align: center;
  opacity: 0.8;
}
button {
  background: color-mix(in srgb, var(--color-fg) 5%, transparent);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
}
</style>
