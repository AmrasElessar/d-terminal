<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api, type SessionRecord } from '@/api/tauri';
import { usePanesStore } from '@/stores/panes';
import { useToastsStore } from '@/stores/toasts';
import {
  deserializeTree,
  serializeTree,
  serializeWorkspace,
  deserializeWorkspace,
} from '@/stores/session';
import { useDialogA11y } from '@/composables/useDialogA11y';
import { confirmAsk } from '@/utils/dialog';

const props = defineProps<{ open: boolean; mode: 'save' | 'load' }>();
const emit = defineEmits<{ close: [] }>();
const dialogEl = ref<HTMLElement | null>(null);
useDialogA11y(dialogEl, () => props.open, { onEscape: () => emit('close') });

const { t } = useI18n();
const panes = usePanesStore();
const toasts = useToastsStore();

const sessions = ref<SessionRecord[]>([]);
const newName = ref('');
/** Workspace modu: kapalıyken sadece aktif tab'ı kaydeder/yükler (eski davranış);
 *  açıkken tüm tab'lar + her tab'ın profileId + tag bilgisini saklar. */
const workspaceMode = ref(true);

async function refresh() {
  sessions.value = await api.sessionList();
}

async function save() {
  const name = newName.value.trim();
  if (!name) return;
  const json = workspaceMode.value
    ? serializeWorkspace(panes.tabs, panes.activeTabId)
    : serializeTree(panes.tree);
  await api.sessionSave(name, json);
  toasts.success(t('session.saved', { name }));
  emit('close');
}

async function load(rec: SessionRecord) {
  // Önce workspace olarak çözümle (v2 schema). Eski v1 kayıtlar fallback ile
  // tek tab içinde mount edilir.
  const ws = deserializeWorkspace(rec.layout_json);
  if (ws && ws.tabs.length > 0) {
    await panes.loadWorkspace(ws.tabs, ws.activeTabId);
  } else {
    const root = deserializeTree(rec.layout_json);
    panes.tree.root = root;
    panes.tree.focusedId = root && root.kind === 'leaf' ? root.id : null;
  }
  toasts.success(t('session.loaded', { name: rec.name }));
  emit('close');
}

async function remove(rec: SessionRecord) {
  if (!(await confirmAsk(t('session.deleteConfirm', { name: rec.name }), { kind: 'warning' }))) return;
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
  <dialog
    v-if="open"
    ref="dialogEl"
    class="dialog"
    open
    role="dialog"
    aria-modal="true"
    :aria-label="mode === 'save' ? t('session.save') : t('session.load')"
    @click.self="emit('close')"
  >
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
            autofocus
            @keydown.enter="save"
          />
        </label>
        <label class="workspace-toggle">
          <input v-model="workspaceMode" type="checkbox" />
          <span>{{ t('session.workspaceMode') }}</span>
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
  background: var(--color-overlay-medium);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 100;
}
.panel {
  background: var(--color-bg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
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
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 5%, transparent);
}
.panel__header h2 { margin: 0; font-size: 15px; flex: 1; }
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 20px; line-height: 1; }
.save {
  padding: 16px 18px;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 5%, transparent);
}
.save label:not(.workspace-toggle) { flex: 1; display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.workspace-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; cursor: pointer; opacity: 0.85; }
.save input {
  background: color-mix(in srgb, var(--color-fg) 4%, transparent);
  color: var(--color-fg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
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
  border-top: 1px solid color-mix(in srgb, var(--color-fg) 4%, transparent);
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
  border: 1px solid var(--color-red-soft-30);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.danger:hover { background: var(--color-red); color: var(--color-bg); }
</style>
