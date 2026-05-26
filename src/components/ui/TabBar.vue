<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { listLeaves } from '@/types/pane';
import { gitStatRef } from '@/composables/useGitStat';
import { confirmTabClose } from '@/composables/useCloseConfirm';

const { t } = useI18n();
const panes = usePanesStore();

interface TabSummary {
  id: string;
  name: string;
  isActive: boolean;
  paneCount: number;
  hasError: boolean;
  /** Tab'daki tüm terminal pane'lerin git diff toplamı. `repos` 0 ise chip
   *  görünmez (git takibi olan pane yok). Reactive — her leaf'in gitStatRef'i
   *  poller tarafından güncellendikçe bu computed da yenilenir. */
  gitTotal: { added: number; removed: number; repos: number };
}

const tabSummaries = computed<TabSummary[]>(() =>
  panes.tabs.map((tab) => {
    const leaves = listLeaves(tab.tree.root);
    let added = 0;
    let removed = 0;
    let repos = 0;
    for (const l of leaves) {
      const s = gitStatRef(l.id).value;
      if (s.is_repo) {
        repos += 1;
        added += s.added;
        removed += s.removed;
      }
    }
    return {
      id: tab.id,
      name: tab.name,
      isActive: tab.id === panes.activeTabId,
      paneCount: leaves.length,
      hasError: leaves.some((l) => l.status === 'error'),
      gitTotal: { added, removed, repos },
    };
  }),
);

// Inline rename state — modal/prompt yerine yerinde input.
const editingId = ref<string | null>(null);
const editingValue = ref('');
const inputRefs = ref<Record<string, HTMLInputElement | undefined>>({});

function activate(id: string) {
  if (editingId.value === id) return; // edit halindeyken tıklamak save tetiklemesin
  panes.setActiveTab(id);
}

/** Tab kapatma — Settings.confirmOnClose moduna göre onay alır. Tab içinde
 *  N running pane varsa kullanıcıya hatırlatır (Shift basılıysa bypass). */
async function close(id: string, e: MouseEvent) {
  e.stopPropagation();
  const tab = panes.tabs.find((t) => t.id === id);
  if (!tab) return;
  const ok = await confirmTabClose(tab, e);
  if (!ok) return;
  panes.closeTab(id);
}

function newTab() {
  panes.newTab();
}

async function startRename(tab: TabSummary) {
  editingId.value = tab.id;
  editingValue.value = tab.name;
  await nextTick();
  const el = inputRefs.value[tab.id];
  el?.focus();
  el?.select();
}

function commitRename() {
  if (!editingId.value) return;
  const name = editingValue.value.trim();
  if (name) panes.renameTab(editingId.value, name);
  editingId.value = null;
}

function cancelRename() {
  editingId.value = null;
}
</script>

<template>
  <div class="tab-bar">
    <div class="tab-bar__list">
      <div
        v-for="tab in tabSummaries"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.isActive, error: tab.hasError, editing: editingId === tab.id }"
        :title="`${tab.name} · ${tab.paneCount} pane`"
        @mousedown.left="activate(tab.id)"
        @dblclick="startRename(tab)"
        @auxclick.middle.prevent="close(tab.id, $event)"
      >
        <span class="tab__indicator" />
        <input
          v-if="editingId === tab.id"
          :ref="(el) => { inputRefs[tab.id] = el as HTMLInputElement | undefined; }"
          v-model="editingValue"
          class="tab__rename"
          type="text"
          spellcheck="false"
          maxlength="40"
          @keydown.enter.prevent="commitRename"
          @keydown.escape.prevent="cancelRename"
          @blur="commitRename"
          @mousedown.stop
          @dblclick.stop
        />
        <span v-else class="tab__name">{{ tab.name }}</span>
        <span
          v-if="tab.gitTotal.repos > 0"
          class="tab__git"
          :title="t('git.tabDiffHint', { repos: tab.gitTotal.repos, panes: tab.paneCount })"
        >
          <span v-if="tab.gitTotal.added > 0" class="tab__git-add">+{{ tab.gitTotal.added }}</span>
          <span v-if="tab.gitTotal.removed > 0" class="tab__git-rem">-{{ tab.gitTotal.removed }}</span>
          <span v-if="tab.gitTotal.added === 0 && tab.gitTotal.removed === 0" class="tab__git-clean">✓</span>
        </span>
        <span
          class="tab__count"
          :title="t('tab.paneCountHint', { count: tab.paneCount })"
          :aria-label="t('tab.paneCountHint', { count: tab.paneCount })"
        >{{ tab.paneCount }}</span>
        <button
          type="button"
          class="tab__close"
          :title="t('tab.close')"
          :aria-label="t('tab.close')"
          @click="close(tab.id, $event)"
        >
×
</button>
      </div>
    </div>
    <button
      type="button"
      class="tab-bar__new"
      :title="t('tab.new')"
      :aria-label="t('tab.new')"
      @click="newTab"
    >
+
</button>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0 4px;
  background: var(--color-overlay-light);
  border-bottom: 1px solid var(--color-line);
  font-size: 10px;
  user-select: none;
  flex-shrink: 0;
  height: 22px;
  font-family: var(--font-family);
}
.tab-bar__list {
  display: flex;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.tab-bar__list::-webkit-scrollbar { display: none; }
.tab {
  display: flex;
  gap: 6px;
  align-items: center;
  padding: 0 8px;
  min-width: 100px;
  max-width: 260px;
  border-right: 1px solid var(--color-line);
  cursor: pointer;
  color: var(--color-dim);
  background: transparent;
  transition: background 0.1s ease, color 0.1s ease;
}
.tab__name {
  flex: 1;
  min-width: 0;
}
.tab:hover {
  background: color-mix(in srgb, var(--color-fg) 3%, transparent);
  color: var(--color-fg);
}
.tab.active {
  background: var(--color-accent-soft-12);
  color: var(--color-accent);
  border-bottom: 1px solid var(--color-accent);
}
.tab.error {
  color: var(--color-red);
}
.tab__indicator {
  width: 6px;
  height: 6px;
  border-radius: 0;
  background: var(--color-dim);
  opacity: 0.6;
}
.tab.active .tab__indicator {
  background: var(--color-accent);
  opacity: 1;
  box-shadow: 0 0 6px var(--color-accent);
}
.tab.error .tab__indicator {
  background: var(--color-red);
  opacity: 0.9;
}
.tab__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 10px;
}
.tab.editing {
  background: var(--color-accent-soft-15);
}
.tab__rename {
  background: var(--color-bg);
  color: var(--color-fg);
  border: 1px solid var(--color-accent);
  border-radius: 2px;
  font-family: inherit;
  font-size: 10px;
  padding: 0 4px;
  margin: 1px 0;
  outline: none;
  min-width: 0;
  width: 100%;
  height: 16px;
}
.tab__count {
  font-size: 9px;
  opacity: 0.5;
  background: color-mix(in srgb, var(--color-fg) 5%, transparent);
  padding: 0 4px;
  border-radius: 2px;
  cursor: help;
  flex-shrink: 0;
}
/* Tab git toplamı — pane'lerin +/- aggregate'i. PaneTitleBar chip'iyle aynı
   palet (yeşil eklenmiş / kırmızı silinmiş / dim ✓ temiz). */
.tab__git {
  display: inline-flex;
  gap: 4px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
  border: 1px solid color-mix(in srgb, var(--color-fg) 10%, transparent);
  border-radius: 2px;
  cursor: help;
  flex-shrink: 0;
}
.tab__git-add   { color: var(--color-green); }
.tab__git-rem   { color: var(--color-red); }
.tab__git-clean { color: var(--color-dim); opacity: 0.7; }
.tab__close {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0 4px;
  border-radius: 0;
  opacity: 0.6;
}
.tab__close:hover {
  background: var(--color-red);
  color: var(--color-bg);
  opacity: 1;
}
.tab-bar__new {
  background: transparent;
  border: none;
  color: var(--color-dim);
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 10px;
  border-left: 1px solid var(--color-line);
}
.tab-bar__new:hover {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}
</style>
