<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useSnippetsStore } from '@/stores/snippets';
import { useToastsStore } from '@/stores/toasts';
import { api } from '@/api/tauri';
import type { PaneType } from '@/types/pane';
import { availableLocales, localeMeta } from '@/locales';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  /** Caller should react: 'history' | 'snippets' | 'settings' | 'session-save' | 'session-load' */
  navigate: [action: string];
}>();

const { t, locale } = useI18n();
const panes = usePanesStore();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const snippets = useSnippetsStore();
const toasts = useToastsStore();

interface Action {
  id: string;
  category: 'panes' | 'settings' | 'themes' | 'ai' | 'session' | 'snippets' | 'history';
  label: string;
  hint?: string;
  invoke: () => void | Promise<void>;
}

const search = ref('');
// Debounce edilmiş kopya — büyük action listesinde fuzzy skor + sort her tuşta
// koşmasın. 200ms bekle.
const debouncedSearch = ref('');
let searchTimer: number | undefined;
const selectedIdx = ref(0);
const inputEl = ref<HTMLInputElement>();

function paneOpen(type: PaneType, label: string) {
  panes.openPane(type, label);
  emit('close');
}

const actions = computed<Action[]>(() => {
  const list: Action[] = [
    { id: 'pane.new.powershell', category: 'panes', label: t('commandPalette.actions.newPanePowershell'), invoke: () => paneOpen('powershell', t('pane.type.powershell')) },
    { id: 'pane.new.cmd',        category: 'panes', label: t('commandPalette.actions.newPaneCmd'),        invoke: () => paneOpen('cmd', t('pane.type.cmd')) },
    { id: 'pane.new.ai',         category: 'panes', label: t('commandPalette.actions.newPaneAi'),         invoke: () => paneOpen('aiChat', t('pane.type.aiChat')) },
    { id: 'pane.new.welcome',    category: 'panes', label: t('commandPalette.actions.newPaneWelcome'),    invoke: () => paneOpen('welcome', t('pane.type.welcome')) },
    { id: 'pane.split.h',        category: 'panes', label: t('commandPalette.actions.splitHorizontal'),    invoke: () => { panes.splitFocused('horizontal', 'powershell', t('pane.type.powershell')); emit('close'); } },
    { id: 'pane.split.v',        category: 'panes', label: t('commandPalette.actions.splitVertical'),      invoke: () => { panes.splitFocused('vertical', 'powershell', t('pane.type.powershell')); emit('close'); } },
    { id: 'pane.close',          category: 'panes', label: t('commandPalette.actions.closePane'),          invoke: () => { if (panes.tree.focusedId) panes.closePane(panes.tree.focusedId); emit('close'); } },
    { id: 'pane.zoomIn',         category: 'panes', label: t('commandPalette.actions.zoomIn'),    invoke: () => { panes.adjustFocusedFontSize(+1); emit('close'); } },
    { id: 'pane.zoomOut',        category: 'panes', label: t('commandPalette.actions.zoomOut'),   invoke: () => { panes.adjustFocusedFontSize(-1); emit('close'); } },
    { id: 'pane.zoomReset',      category: 'panes', label: t('commandPalette.actions.zoomReset'), invoke: () => { panes.resetFocusedFontSize(); emit('close'); } },

    { id: 'settings.open',       category: 'settings', label: t('commandPalette.actions.openSettings'), invoke: () => emit('navigate', 'settings') },
    { id: 'history.open',        category: 'history',  label: t('commandPalette.actions.openHistory'),  invoke: () => emit('navigate', 'history') },
    { id: 'snippets.open',       category: 'snippets', label: t('commandPalette.actions.openSnippets'), invoke: () => emit('navigate', 'snippets') },
    { id: 'session.save',        category: 'session',  label: t('commandPalette.actions.saveSession'),  invoke: () => emit('navigate', 'session-save') },
    { id: 'session.load',        category: 'session',  label: t('commandPalette.actions.loadSession'),  invoke: () => emit('navigate', 'session-load') },

    {
      id: 'psreadline.import',
      category: 'history',
      label: t('commandPalette.actions.importPsreadline'),
      invoke: async () => {
        try {
          const res = await api.psreadlineImport();
          toasts.success(
            t('psreadline.summary', { imported: res.imported, skipped: res.skipped_duplicates }),
          );
        } catch (e) {
          toasts.error(String(e));
        }
        emit('close');
      },
    },
  ];

  for (const theme of themeStore.themes) {
    list.push({
      id: `theme.switch.${theme.name}`,
      category: 'themes',
      label: t('commandPalette.actions.switchTheme', { name: theme.name }),
      invoke: () => {
        settings.state.themeName = theme.name;
        themeStore.setActive(theme.name);
        emit('close');
      },
    });
  }

  for (const code of availableLocales) {
    const meta = localeMeta[code];
    const label = meta?.nativeName || meta?.language || code;
    list.push({
      id: `lang.switch.${code}`,
      category: 'settings',
      label: t('commandPalette.actions.switchLanguage', { name: label }),
      invoke: () => {
        settings.state.language = code;
        locale.value = code;
        emit('close');
      },
    });
  }

  for (const s of snippets.items) {
    list.push({
      id: `snippet.run.${s.id}`,
      category: 'snippets',
      label: `${t('snippet.run')}: ${s.name}`,
      hint: s.command,
      invoke: () => {
        snippets.run(s);
        emit('close');
      },
    });
  }

  return list;
});

function fuzzyScore(text: string, q: string): number {
  if (!q) return 1;
  const lower = text.toLowerCase();
  const ql = q.toLowerCase();
  if (lower.includes(ql)) return 10 - lower.indexOf(ql) / 100;
  // simple subsequence match
  let qi = 0;
  for (let i = 0; i < lower.length && qi < ql.length; i += 1) {
    if (lower[i] === ql[qi]) qi += 1;
  }
  return qi === ql.length ? 1 : 0;
}

const filtered = computed(() => {
  const q = debouncedSearch.value.trim();
  return actions.value
    .map((a) => ({ a, score: fuzzyScore(a.label, q) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.a)
    .slice(0, 50);
});

watch(search, (val) => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    searchTimer = undefined;
    debouncedSearch.value = val;
  }, 200);
});

watch(filtered, () => {
  selectedIdx.value = 0;
});

watch(
  () => props.open,
  async (open) => {
    if (open) {
      search.value = '';
      debouncedSearch.value = '';
      if (searchTimer !== undefined) {
        window.clearTimeout(searchTimer);
        searchTimer = undefined;
      }
      selectedIdx.value = 0;
      await snippets.load();
      await nextTick();
      inputEl.value?.focus();
    }
  },
);

onBeforeUnmount(() => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer);
});

function onKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIdx.value = Math.min(filtered.value.length - 1, selectedIdx.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIdx.value = Math.max(0, selectedIdx.value - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = filtered.value[selectedIdx.value];
    if (target) target.invoke();
  } else if (e.key === 'Escape') {
    emit('close');
  }
}

onMounted(() => snippets.load());
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')" @keydown="onKey">
    <article class="palette">
      <input
        ref="inputEl"
        v-model="search"
        type="text"
        :placeholder="t('commandPalette.placeholder')"
        autofocus
      />
      <ul v-if="filtered.length > 0" class="results">
        <li
          v-for="(a, idx) in filtered"
          :key="a.id"
          :class="{ selected: idx === selectedIdx }"
          @click="a.invoke()"
          @mouseenter="selectedIdx = idx"
        >
          <span class="cat">{{ t(`commandPalette.categories.${a.category}`) }}</span>
          <span class="label">{{ a.label }}</span>
          <code v-if="a.hint" class="hint">{{ a.hint }}</code>
        </li>
      </ul>
      <div v-else class="empty">{{ t('commandPalette.noResults') }}</div>
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
  align-items: flex-start;
  justify-content: center;
  border: none;
  padding: 0;
  padding-top: 80px;
  z-index: 100;
}
.palette {
  background: var(--color-bg);
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: var(--ui-radius, 8px);
  width: min(640px, 92vw);
  max-height: 60vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  color: var(--color-fg);
  box-shadow: 0 20px 60px var(--color-overlay-dark);
}
.palette input {
  background: transparent;
  border: none;
  border-bottom: 1px solid color-mix(in srgb, var(--color-fg) 8%, transparent);
  color: var(--color-fg);
  padding: 14px 18px;
  font-size: 14px;
  font-family: var(--font-family);
}
.palette input:focus { outline: none; }
.results { list-style: none; padding: 0; margin: 0; overflow-y: auto; }
.results li {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 12px;
  align-items: center;
  padding: 8px 18px;
  cursor: pointer;
  font-size: 13px;
}
.results li.selected { background: var(--color-accent-soft); }
.cat {
  background: color-mix(in srgb, var(--color-fg) 5%, transparent);
  color: var(--color-accent);
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}
.label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hint {
  font-family: var(--font-family);
  font-size: 11px;
  opacity: 0.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}
.empty { padding: 24px; text-align: center; opacity: 0.5; font-size: 13px; }
</style>
