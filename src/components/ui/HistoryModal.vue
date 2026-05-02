<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/tauri';
import type { HistoryEntry } from '@/types/history';
import { usePanesStore } from '@/stores/panes';
import { useToastsStore } from '@/stores/toasts';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t } = useI18n();
const panes = usePanesStore();
const toasts = useToastsStore();

type Filter = 'all' | 'thisPane' | 'favorites';

const search = ref('');
const filter = ref<Filter>('all');
const results = ref<HistoryEntry[]>([]);
const selectedIdx = ref(0);
const inputEl = ref<HTMLInputElement>();

async function refresh() {
  const focusedPty = panes.focused?.ptyId ?? null;
  const focusedLeafId = panes.focused?.id ?? null;
  results.value = await api.historySearch({
    text: search.value.trim() || undefined,
    paneId: filter.value === 'thisPane' && focusedLeafId ? focusedLeafId : undefined,
    favoritesOnly: filter.value === 'favorites',
    limit: 200,
  });
  selectedIdx.value = 0;
  // suppress unused warning if focusedPty needed later
  void focusedPty;
}

watch(search, refresh);
watch(filter, refresh);
watch(
  () => props.open,
  async (open) => {
    if (open) {
      await refresh();
      await nextTick();
      inputEl.value?.focus();
    }
  },
);

const selected = computed(() => results.value[selectedIdx.value] ?? null);

async function toggleFavorite(entry: HistoryEntry) {
  await api.historyToggleFavorite(entry.id);
  await refresh();
}

async function remove(entry: HistoryEntry) {
  await api.historyDelete(entry.id);
  await refresh();
}

async function rerun(entry: HistoryEntry) {
  const focused = panes.focused;
  if (!focused?.ptyId) {
    toasts.warning(t('snippet.noActivePane'));
    return;
  }
  await api.ptyWrite(focused.ptyId, new TextEncoder().encode(entry.command + '\r'));
  emit('close');
}

function copy(entry: HistoryEntry) {
  navigator.clipboard.writeText(entry.command).then(() => {
    toasts.success(t('common.copy') + ' ✓', 1500);
  });
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx.value = Math.min(results.value.length - 1, selectedIdx.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx.value = Math.max(0, selectedIdx.value - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selected.value) rerun(selected.value);
  } else if (e.key === 'Escape') {
    emit('close');
  }
}
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')" @keydown="onKey">
    <article class="panel">
      <header class="panel__header">
        <h2>{{ t('history.title') }}</h2>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>
      <div class="panel__bar">
        <input
          ref="inputEl"
          v-model="search"
          type="text"
          :placeholder="t('history.search')"
          autofocus
        />
        <select v-model="filter">
          <option value="all">{{ t('history.filter.all') }}</option>
          <option value="thisPane">{{ t('history.filter.thisPane') }}</option>
          <option value="favorites">{{ t('history.filter.favorites') }}</option>
        </select>
      </div>
      <div class="panel__count">{{ t('history.results', { count: results.length }) }}</div>

      <ul v-if="results.length > 0" class="results">
        <li
          v-for="(entry, idx) in results"
          :key="entry.id"
          :class="{ selected: idx === selectedIdx, fav: entry.isFavorite }"
          @click="selectedIdx = idx"
          @dblclick="rerun(entry)"
        >
          <div class="results__cmd">{{ entry.command }}</div>
          <div class="results__meta">
            <span v-if="entry.paneType">{{ entry.paneType }}</span>
            <span v-if="entry.exitCode !== null && entry.exitCode !== undefined" :class="{ bad: entry.exitCode !== 0 }">
              exit {{ entry.exitCode }}
            </span>
            <span class="ts">{{ entry.executedAt.replace('T', ' ').slice(0, 19) }}</span>
          </div>
          <div class="results__actions">
            <button type="button" :title="t('history.rerun')" @click.stop="rerun(entry)">▶</button>
            <button
              type="button"
              :title="entry.isFavorite ? t('history.unfavorite') : t('history.favorite')"
              :class="{ on: entry.isFavorite }"
              @click.stop="toggleFavorite(entry)"
            >★</button>
            <button type="button" :title="t('history.copy')" @click.stop="copy(entry)">⎘</button>
            <button type="button" :title="t('history.delete')" class="danger" @click.stop="remove(entry)">×</button>
          </div>
        </li>
      </ul>
      <div v-else class="empty">{{ t('history.empty') }}</div>
    </article>
  </dialog>
</template>

<style scoped>
.dialog {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  border: none;
  padding-top: 80px;
  z-index: 100;
}
.panel {
  background: var(--color-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--ui-radius, 8px);
  width: min(800px, 92vw);
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--color-fg);
}
.panel__header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.panel__header h2 { margin: 0; flex: 1; font-size: 14px; }
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 20px; line-height: 1; }
.panel__bar {
  display: flex;
  gap: 8px;
  padding: 12px 16px 8px;
}
.panel__bar input {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 10px;
  border-radius: 4px;
  font-family: var(--font-family);
  font-size: 13px;
}
.panel__bar input:focus { outline: none; border-color: var(--color-accent); }
.panel__bar select {
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 8px;
  border-radius: 4px;
}
.panel__count {
  padding: 0 16px 8px;
  font-size: 11px;
  opacity: 0.5;
}
.results {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
}
.results li {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-areas:
    'cmd actions'
    'meta actions';
  gap: 4px 12px;
  padding: 8px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.03);
  cursor: pointer;
}
.results li.selected { background: rgba(0, 180, 216, 0.08); }
.results li.fav .results__cmd::before { content: '★ '; color: var(--color-yellow); }
.results__cmd {
  grid-area: cmd;
  font-family: var(--font-family);
  font-size: 13px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.results__meta {
  grid-area: meta;
  display: flex;
  gap: 12px;
  font-size: 10px;
  opacity: 0.6;
}
.results__meta .bad { color: var(--color-red); opacity: 1; }
.results__meta .ts { font-family: var(--font-family); }
.results__actions {
  grid-area: actions;
  display: flex;
  gap: 4px;
  align-items: center;
}
.results__actions button {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--color-fg);
  width: 26px;
  height: 26px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}
.results__actions button:hover { background: rgba(255, 255, 255, 0.05); }
.results__actions button.on { color: var(--color-yellow); border-color: var(--color-yellow); }
.results__actions button.danger:hover { background: var(--color-red); border-color: var(--color-red); }
.empty {
  padding: 32px;
  text-align: center;
  opacity: 0.5;
  font-size: 13px;
}
</style>
