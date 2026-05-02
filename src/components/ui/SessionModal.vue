<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type SessionRecord } from '@/api/tauri';
import { usePanesStore } from '@/stores/panes';
import { useToastsStore } from '@/stores/toasts';
import { deserializeTree, serializeTree } from '@/stores/session';

const props = defineProps<{ open: boolean; mode: 'save' | 'load' }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const panes = usePanesStore();
const toasts = useToastsStore();

const sessions = ref<SessionRecord[]>([]);
const newName = ref('');

async function refresh() {
  sessions.value = await api.sessionList();
}

async function save() {
  const name = newName.value.trim();
  if (!name) return;
  const json = serializeTree(panes.tree);
  await api.sessionSave(name, json);
  toasts.success(t('session.saved', { name }));
  emit('close');
}

async function load(rec: SessionRecord) {
  const root = deserializeTree(rec.layout_json);
  panes.tree.root = root;
  panes.tree.focusedId = root && root.kind === 'leaf' ? root.id : null;
  toasts.success(t('session.loaded', { name: rec.name }));
  emit('close');
}

async function remove(rec: SessionRecord) {
  if (!confirm(t('session.deleteConfirm', { name: rec.name }))) return;
  await api.sessionDelete(rec.name);
  await refresh();
}

watch(
  () => props.open,
  async (open) => {
    if (open) await refresh();
  },
);

onMounted(refresh);
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="panel">
      <header class="panel__header">
        <h2>{{ mode === 'save' ? t('session.save') : t('session.load') }}</h2>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>

      <section v-if="mode === 'save'" class="save">
        <label>
          <span>{{ t('session.name') }}</span>
          <input
            v-model="newName"
            type="text"
            :placeholder="t('session.namePlaceholder')"
            @keydown.enter="save"
            autofocus
          />
        </label>
        <button type="button" class="primary" :disabled="!newName.trim()" @click="save">
          {{ t('common.save') }}
        </button>
      </section>

      <section class="list">
        <h3>{{ t('session.list') }}</h3>
        <div v-if="sessions.length === 0" class="empty">{{ t('session.empty') }}</div>
        <ul v-else>
          <li v-for="s in sessions" :key="s.id">
            <div class="info">
              <strong>{{ s.name }}</strong>
              <small>{{ t('session.lastUpdated', { date: s.updated_at.slice(0, 19).replace('T', ' ') }) }}</small>
            </div>
            <div class="actions">
              <button v-if="mode === 'load'" type="button" class="primary" @click="load(s)">
                {{ t('session.load') }}
              </button>
              <button type="button" class="danger" @click="remove(s)">
                {{ t('common.delete') }}
              </button>
            </div>
          </li>
        </ul>
      </section>
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
  width: min(560px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  color: var(--color-fg);
}
.panel__header {
  display: flex;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.panel__header h2 { margin: 0; font-size: 15px; flex: 1; }
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 20px; line-height: 1; }
.save {
  padding: 16px 18px;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.save label { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.save input {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 10px;
  border-radius: 4px;
  font-family: var(--font-family);
}
.list { padding: 12px 18px 18px; }
.list h3 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.6;
  margin: 0 0 8px 0;
}
ul { list-style: none; padding: 0; margin: 0; }
li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.info strong { font-size: 13px; }
.info small { font-size: 11px; opacity: 0.5; font-family: var(--font-family); }
.actions { display: flex; gap: 6px; flex-shrink: 0; }
.empty { font-size: 12px; opacity: 0.5; padding: 12px 0; }
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  padding: 5px 14px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
}
.primary:disabled { opacity: 0.4; cursor: not-allowed; }
.danger {
  background: transparent;
  color: var(--color-red);
  border: 1px solid rgba(255, 95, 87, 0.3);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.danger:hover { background: var(--color-red); color: var(--color-bg); }
</style>
