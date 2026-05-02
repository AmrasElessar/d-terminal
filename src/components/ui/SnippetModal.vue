<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSnippetsStore } from '@/stores/snippets';
import { useToastsStore } from '@/stores/toasts';
import type { Snippet } from '@/types/snippet';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const snippets = useSnippetsStore();
const toasts = useToastsStore();

const editing = ref<{ name: string; command: string; description: string; shortcut: string } | null>(null);

onMounted(() => snippets.load());

function startNew() {
  editing.value = { name: '', command: '', description: '', shortcut: '' };
}

function startEdit(s: Snippet) {
  editing.value = {
    name: s.name,
    command: s.command,
    description: s.description ?? '',
    shortcut: s.shortcut ?? '',
  };
}

async function save() {
  if (!editing.value || !editing.value.name.trim() || !editing.value.command.trim()) return;
  await snippets.upsert({
    name: editing.value.name.trim(),
    command: editing.value.command,
    description: editing.value.description.trim() || null,
    shortcut: editing.value.shortcut.trim() || null,
  });
  toasts.success(t('snippet.saved', { name: editing.value.name }));
  editing.value = null;
}

async function remove(s: Snippet) {
  if (!confirm(t('snippet.deleteConfirm', { name: s.name }))) return;
  await snippets.remove(s.id);
  toasts.success(t('snippet.deleted'));
}

function run(s: Snippet) {
  snippets.run(s);
  emit('close');
}

void props.open;
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="panel">
      <header class="panel__header">
        <h2>{{ t('snippet.title') }}</h2>
        <button v-if="!editing" type="button" class="primary small" @click="startNew">
          {{ t('snippet.addNew') }}
        </button>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>

      <form v-if="editing" class="form" @submit.prevent="save">
        <label>
          <span>{{ t('snippet.name') }}</span>
          <input v-model="editing.name" type="text" :placeholder="t('snippet.namePlaceholder')" required />
        </label>
        <label>
          <span>{{ t('snippet.command') }}</span>
          <textarea v-model="editing.command" rows="3" :placeholder="t('snippet.commandPlaceholder')" required />
        </label>
        <label>
          <span>{{ t('snippet.description') }}</span>
          <input v-model="editing.description" type="text" :placeholder="t('snippet.descriptionPlaceholder')" />
        </label>
        <label>
          <span>{{ t('snippet.shortcut') }}</span>
          <input v-model="editing.shortcut" type="text" :placeholder="t('snippet.shortcutPlaceholder')" />
        </label>
        <div class="actions">
          <button type="button" class="ghost" @click="editing = null">{{ t('common.cancel') }}</button>
          <button type="submit" class="primary">{{ t('snippet.save') }}</button>
        </div>
      </form>

      <ul v-else-if="snippets.items.length > 0" class="list">
        <li v-for="s in snippets.items" :key="s.id">
          <div class="info">
            <strong>{{ s.name }}</strong>
            <small v-if="s.description">{{ s.description }}</small>
            <code>{{ s.command }}</code>
          </div>
          <div class="meta">
            <kbd v-if="s.shortcut">{{ s.shortcut }}</kbd>
          </div>
          <div class="actions">
            <button type="button" class="primary small" @click="run(s)">{{ t('snippet.run') }}</button>
            <button type="button" class="ghost small" @click="startEdit(s)">{{ t('snippet.edit') }}</button>
            <button type="button" class="danger small" @click="remove(s)">{{ t('snippet.delete') }}</button>
          </div>
        </li>
      </ul>

      <div v-else class="empty">{{ t('snippet.empty') }}</div>
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
.panel {
  background: var(--color-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--ui-radius, 8px);
  width: min(640px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  color: var(--color-fg);
}
.panel__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.panel__header h2 { margin: 0; flex: 1; font-size: 14px; }
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 20px; line-height: 1; }
.form { padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.form label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.form input, .form textarea {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 8px;
  border-radius: 4px;
  font-family: var(--font-family);
  font-size: 13px;
}
.form input:focus, .form textarea:focus { outline: none; border-color: var(--color-accent); }
.form .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.list { list-style: none; padding: 0; margin: 0; }
.list li {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  padding: 10px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
  align-items: center;
}
.info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.info strong { font-size: 13px; }
.info small { font-size: 11px; opacity: 0.6; }
.info code {
  font-family: var(--font-family);
  font-size: 12px;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.meta kbd {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 11px;
  font-family: var(--font-family);
}
.actions { display: flex; gap: 4px; flex-shrink: 0; }
.empty { padding: 32px; text-align: center; opacity: 0.5; font-size: 13px; }
.primary { background: var(--color-accent); color: var(--color-bg); border: none; padding: 5px 12px; border-radius: 4px; font-weight: 600; cursor: pointer; }
.primary.small, .ghost.small, .danger.small { font-size: 11px; padding: 3px 8px; }
.ghost { background: transparent; color: var(--color-fg); border: 1px solid rgba(255, 255, 255, 0.1); padding: 5px 12px; border-radius: 4px; cursor: pointer; }
.danger { background: transparent; color: var(--color-red); border: 1px solid rgba(255, 95, 87, 0.3); padding: 5px 12px; border-radius: 4px; cursor: pointer; }
.danger:hover { background: var(--color-red); color: var(--color-bg); }
</style>
