<script setup lang="ts">
// Terminal pane — ince görünüm katmanı. xterm örneği, PTY akışı, shell
// integration ve girdi işleme `TerminalSession` içinde yaşar (src/terminal/);
// pane görünmezken (arka plan tab, zoom modu) de çıktı işlenmeye devam eder.
// Bu komponent yalnızca session'ı DOM'a bağlar ve overlay UI'larını çizer.

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import '@xterm/xterm/css/xterm.css';
import type { ISearchOptions } from '@xterm/addon-search';
import type { LeafNode } from '@/types/pane';
import { useAgentWatchStore } from '@/stores/agentWatch';
import { getOrCreateTerminalSession } from '@/terminal/session';
import { useI18n } from 'vue-i18n';
import AgentWatchPanel from '@/components/ui/AgentWatchPanel.vue';

const props = defineProps<{ leaf: LeafNode }>();
const agentWatch = useAgentWatchStore();
const agentView = agentWatch.paneView(props.leaf.id);
const { t } = useI18n();

// PaneSlot `:key="leaf.id"` ile mount ettiği için leaf id bu örnek boyunca sabit.
const session = getOrCreateTerminalSession(props.leaf.id);
const suggestion = session.suggestion;
const scrollMode = session.scrollMode;
const searchResultCount = session.searchResults;

const container = ref<HTMLDivElement>();

// --- Search overlay state ---
const searchOpen = ref(false);
const searchQuery = ref('');
const searchInput = ref<HTMLInputElement>();
const searchCaseSensitive = ref(false);
const searchWholeWord = ref(false);
const searchRegex = ref(false);

const searchOptions = computed<ISearchOptions>(() => ({
  caseSensitive: searchCaseSensitive.value,
  wholeWord: searchWholeWord.value,
  regex: searchRegex.value,
  decorations: {
    matchBackground: '#FFB454',
    matchOverviewRuler: '#FFB454',
    activeMatchBackground: '#FF8C42',
    activeMatchColorOverviewRuler: '#FF8C42',
  },
}));

function openSearch() {
  searchOpen.value = true;
  nextTick(() => searchInput.value?.focus());
}
function closeSearch() {
  searchOpen.value = false;
  session.clearSearch();
}
function findNext() {
  session.findNext(searchQuery.value, searchOptions.value);
}
function findPrev() {
  session.findPrevious(searchQuery.value, searchOptions.value);
}
/** Tip-while-search debounce — büyük buffer'da her tuşta arama CPU yer. */
let searchDebounceTimer: number | undefined;
function findNextDebounced() {
  if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
  searchDebounceTimer = window.setTimeout(() => {
    searchDebounceTimer = undefined;
    findNext();
  }, 250);
}
function onSearchKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeSearch();
    return;
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) findPrev();
    else findNext();
  }
}

/** Agent Watch "Stop" — parent CLI'a SIGINT (\x03). Tek PTY var; bu, parent
 *  CLI'ın TÜM aktif subagent'larını durdurur (UI tooltip'inde yazılı). */
function onStopAgent() {
  session.sendSigint();
}

onMounted(() => {
  if (!container.value) return;
  session.ui.openSearch = openSearch;
  session.attach(container.value);
});

onBeforeUnmount(() => {
  if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
  if (session.ui.openSearch === openSearch) session.ui.openSearch = undefined;
  // Session'ı DOM'dan sök ama yaşat — PTY çıktısı işlenmeye devam eder.
  // Kalıcı kapanışta panes store `disposeTerminalSession` çağırır.
  session.detach();
});

defineExpose({
  openSearch,
  copyBuffer: () => session.copyBuffer(),
  clearTerminal: () => session.clearTerminal(),
  getSelection: () => session.getSelection(),
  paste: () => session.paste(),
});
</script>

<template>
  <div class="terminal-host" :class="{ 'scroll-mode': scrollMode }">
    <!-- Ana akış: terminal + opsiyonel Agent Watch sidebar.
         Sidebar açıldığında flex-1 terminal'i daraltır, fit addon resize ile uyum sağlar. -->
    <div class="terminal-host__row">
      <div ref="container" class="terminal" />
      <AgentWatchPanel
        v-if="agentView.visible"
        :pane-id="props.leaf.id"
        @close="agentWatch.setVisible(props.leaf.id, false)"
        @stop-agent="onStopAgent"
      />
    </div>

    <!-- Scrollback navigation mode (Ctrl+Shift+Space) -->
    <div v-if="scrollMode" class="scroll-mode-bar" aria-live="polite">
      <span class="scroll-mode-bar__label">{{ t('terminal.scrollMode.label') }}</span>
      <span class="scroll-mode-bar__hints">j/k · g/G · u/d · / · y · Esc</span>
    </div>

    <!-- Inline autocomplete chip — history'den prefix-match öneri. → ile kabul. -->
    <div v-if="suggestion" class="suggest-chip" :title="t('terminal.suggest.hint')">
      <span class="suggest-chip__arrow" aria-hidden="true">→</span>
      <code class="suggest-chip__text">{{ suggestion }}</code>
      <span class="suggest-chip__key" aria-hidden="true">→</span>
    </div>

    <!-- Search overlay (Ctrl+F) -->
    <div v-if="searchOpen" class="search-bar" role="search" @keydown.stop>
      <input
        ref="searchInput"
        v-model="searchQuery"
        type="text"
        class="search-bar__input"
        :placeholder="t('terminal.search.placeholder')"
        :aria-label="t('terminal.search.placeholder')"
        spellcheck="false"
        @keydown="onSearchKey"
        @input="findNextDebounced"
      />
      <span class="search-bar__count" aria-live="polite">
        <template v-if="searchResultCount && searchResultCount.resultCount > 0">
          {{ searchResultCount.resultIndex + 1 }} / {{ searchResultCount.resultCount }}
        </template>
        <template v-else-if="searchQuery">
          {{ t('terminal.search.noMatch') }}
        </template>
      </span>
      <button
        type="button"
        :class="{ active: searchCaseSensitive }"
        :title="t('terminal.search.caseSensitive')"
        :aria-label="t('terminal.search.caseSensitive')"
        :aria-pressed="searchCaseSensitive"
        @click="searchCaseSensitive = !searchCaseSensitive; findNext()"
      >
Aa
</button>
      <button
        type="button"
        :class="{ active: searchWholeWord }"
        :title="t('terminal.search.wholeWord')"
        :aria-label="t('terminal.search.wholeWord')"
        :aria-pressed="searchWholeWord"
        @click="searchWholeWord = !searchWholeWord; findNext()"
      >
ab|
</button>
      <button
        type="button"
        :class="{ active: searchRegex }"
        :title="t('terminal.search.regex')"
        :aria-label="t('terminal.search.regex')"
        :aria-pressed="searchRegex"
        @click="searchRegex = !searchRegex; findNext()"
      >
.*
</button>
      <button type="button" :title="t('terminal.search.prev')" :aria-label="t('terminal.search.prev')" @click="findPrev">↑</button>
      <button type="button" :title="t('terminal.search.next')" :aria-label="t('terminal.search.next')" @click="findNext">↓</button>
      <button type="button" class="close" :title="t('common.close')" :aria-label="t('common.close')" @click="closeSearch">×</button>
    </div>
  </div>
</template>

<style scoped>
.terminal-host {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
/* Yatay düzen: solda xterm, sağda opsiyonel Agent Watch sidebar */
.terminal-host__row {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
}
.terminal {
  flex: 1;
  min-width: 0;
  min-height: 0;
  /* Transparent — xterm kendi tema bg'sini render eder; alttan window vibrancy görünür */
  background: transparent;
  padding: 4px;
}
:deep(.xterm) {
  height: 100%;
}
:deep(.xterm-viewport) {
  background-color: transparent !important;
}
:deep(.xterm-screen) {
  background-color: transparent !important;
}

/* --- Search overlay --- */
.search-bar {
  position: absolute;
  top: 6px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: rgba(10, 14, 26, 0.95);
  border: 1px solid var(--color-accent);
  border-radius: 4px;
  box-shadow: 0 4px 14px var(--color-overlay-medium);
  font-family: var(--font-family);
  font-size: 11px;
  color: var(--color-fg);
  z-index: 30;
  backdrop-filter: blur(8px);
}
.search-bar__input {
  background: var(--color-overlay-light);
  border: 1px solid var(--color-line);
  color: var(--color-fg);
  padding: 3px 8px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 11px;
  width: 220px;
  outline: none;
}
.search-bar__input:focus {
  border-color: var(--color-accent);
}
.search-bar__count {
  font-size: 10px;
  color: var(--color-dim);
  min-width: 50px;
  text-align: center;
}
.search-bar button {
  background: transparent;
  border: 1px solid var(--color-line);
  color: var(--color-dim);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 2px;
  font-family: inherit;
  font-size: 11px;
  line-height: 1;
}
.search-bar button:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.search-bar button.active {
  background: var(--color-accent);
  color: var(--color-bg);
  border-color: var(--color-accent);
}
.search-bar .close:hover {
  color: var(--color-red);
  border-color: var(--color-red);
}

/* Inline autocomplete chip — alt-sağda sticky, terminal cursor'una müdahale yok */
.terminal-host.scroll-mode {
  outline: 1px solid var(--color-yellow);
  outline-offset: -1px;
}
.scroll-mode-bar {
  position: absolute;
  top: 4px;
  right: 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  background: rgba(0, 0, 0, 0.85);
  border: 1px solid var(--color-yellow);
  border-radius: 3px;
  font-size: 9px;
  font-family: var(--font-family);
  z-index: 12;
  pointer-events: none;
}
.scroll-mode-bar__label {
  color: var(--color-yellow);
  font-weight: 700;
  letter-spacing: 0.05em;
}
.scroll-mode-bar__hints {
  color: var(--color-dim);
}
.suggest-chip {
  position: absolute;
  bottom: 6px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px 3px 6px;
  background: rgba(10, 14, 26, 0.85);
  border: 1px solid var(--color-line);
  border-left: 2px solid var(--color-accent);
  border-radius: 3px;
  font-family: var(--font-family);
  font-size: 10px;
  color: var(--color-dim);
  pointer-events: none;
  z-index: 25;
  max-width: 60%;
  backdrop-filter: blur(6px);
}
.suggest-chip__arrow {
  color: var(--color-accent);
  font-weight: 700;
}
.suggest-chip__text {
  color: var(--color-fg);
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
}
.suggest-chip__key {
  color: var(--color-accent);
  background: var(--color-accent-soft-15);
  padding: 0 4px;
  border-radius: 2px;
  font-size: 9px;
}
</style>
