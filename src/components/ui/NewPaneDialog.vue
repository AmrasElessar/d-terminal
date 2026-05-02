<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { PaneType } from '@/types/pane';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  create: [type: PaneType];
}>();

const { t } = useI18n();

const TYPES: PaneType[] = ['powershell', 'cmd', 'aiChat', 'wsl'];
const selected = ref<PaneType>('powershell');

function create() {
  emit('create', selected.value);
}

void props.open;
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="dialog__panel">
      <h2>{{ t('newPane.title') }}</h2>
      <p class="hint">{{ t('newPane.selectType') }}</p>
      <div class="types">
        <button
          v-for="type in TYPES"
          :key="type"
          type="button"
          class="type"
          :class="{ active: selected === type }"
          @click="selected = type"
        >
          {{ t(`pane.type.${type}`) }}
        </button>
      </div>
      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">{{ t('newPane.cancel') }}</button>
        <button type="button" class="primary" @click="create">{{ t('newPane.create') }}</button>
      </div>
    </article>
  </dialog>
</template>

<style scoped>
.dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 100;
}
.dialog__panel {
  background: var(--color-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--ui-radius, 8px);
  padding: 24px;
  min-width: 360px;
  max-width: 480px;
  color: var(--color-fg);
}
h2 {
  margin: 0 0 8px 0;
  font-size: 16px;
}
.hint {
  margin: 0 0 16px 0;
  font-size: 12px;
  opacity: 0.7;
}
.types {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}
.type {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--color-fg);
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  font-family: var(--font-family);
  text-align: left;
}
.type:hover {
  background: rgba(255, 255, 255, 0.05);
}
.type.active {
  border-color: var(--color-accent);
  background: rgba(0, 180, 216, 0.08);
  color: var(--color-accent);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions button {
  padding: 6px 16px;
  border-radius: 4px;
  cursor: pointer;
  font-family: inherit;
  border: 1px solid transparent;
}
.ghost {
  background: transparent;
  color: var(--color-fg);
  border-color: rgba(255, 255, 255, 0.1);
}
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  font-weight: 600;
}
</style>
