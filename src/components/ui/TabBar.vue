<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { listLeaves } from '@/types/pane';

const { t } = useI18n();
const panes = usePanesStore();

interface TabSummary {
  id: string;
  name: string;
  isActive: boolean;
  paneCount: number;
  hasError: boolean;
}

const tabSummaries = computed<TabSummary[]>(() =>
  panes.tabs.map((tab) => {
    const leaves = listLeaves(tab.tree.root);
    return {
      id: tab.id,
      name: tab.name,
      isActive: tab.id === panes.activeTabId,
      paneCount: leaves.length,
      hasError: leaves.some((l) => l.status === 'error'),
    };
  }),
);

function activate(id: string) {
  panes.setActiveTab(id);
}

function close(id: string, e: MouseEvent) {
  e.stopPropagation();
  panes.closeTab(id);
}

function newTab() {
  panes.newTab();
}

function rename(tab: TabSummary) {
  const name = window.prompt(t('tab.rename'), tab.name);
  if (name && name.trim()) {
    panes.renameTab(tab.id, name.trim());
  }
}
</script>

<template>
  <div class="tab-bar">
    <div class="tab-bar__list">
      <div
        v-for="tab in tabSummaries"
        :key="tab.id"
        class="tab"
        :class="{ active: tab.isActive, error: tab.hasError }"
        :title="`${tab.name} · ${tab.paneCount} pane`"
        @mousedown.left="activate(tab.id)"
        @dblclick="rename(tab)"
        @auxclick.middle.prevent="close(tab.id, $event)"
      >
        <span class="tab__indicator" />
        <span class="tab__name">{{ tab.name }}</span>
        <span class="tab__count">{{ tab.paneCount }}</span>
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
  background: rgba(0, 0, 0, 0.4);
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
  display: grid;
  grid-template-columns: 6px 1fr auto auto;
  gap: 6px;
  align-items: center;
  padding: 0 8px;
  min-width: 100px;
  max-width: 220px;
  border-right: 1px solid var(--color-line);
  cursor: pointer;
  color: var(--color-dim);
  background: transparent;
  transition: background 0.1s ease, color 0.1s ease;
}
.tab:hover {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-fg);
}
.tab.active {
  background: rgba(0, 180, 216, 0.1);
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
.tab__count {
  font-size: 9px;
  opacity: 0.5;
  background: rgba(255, 255, 255, 0.05);
  padding: 0 4px;
  border-radius: 2px;
}
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
  background: rgba(0, 180, 216, 0.08);
  color: var(--color-accent);
}
</style>
