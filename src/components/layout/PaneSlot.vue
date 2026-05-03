<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import type { LeafNode } from '@/types/pane';
import { usePanesStore } from '@/stores/panes';
import { useContextMenu, type MenuEntry } from '@/composables/useContextMenu';
import { useModals } from '@/composables/useModals';
import { useToastsStore } from '@/stores/toasts';
import { api } from '@/api/tauri';
import PaneTitleBar from '@/components/ui/PaneTitleBar.vue';
import TerminalPane from '@/components/panes/TerminalPane.vue';
import AIChatPane from '@/components/panes/AIChatPane.vue';
import WelcomePane from '@/components/panes/WelcomePane.vue';
import LogStreamPane from '@/components/panes/LogStreamPane.vue';
import ErrorPane from '@/components/panes/ErrorPane.vue';

const props = defineProps<{ leaf: LeafNode }>();
const panes = usePanesStore();
const { t } = useI18n();
const ctx = useContextMenu();
const modals = useModals();
const toasts = useToastsStore();

/** TerminalPane'in expose ettiği metodlara erişim — getSelection (WebGL safe),
 *  clearTerminal (scrollback dahil), openSearch, copyBuffer. */
interface TerminalPaneExpose {
  openSearch: () => void;
  copyBuffer: () => void;
  clearTerminal: () => void;
  getSelection: () => string;
}
const terminalRef = ref<TerminalPaneExpose | null>(null);

const isFocused = computed(() => panes.tree.focusedId === props.leaf.id);

function focus() {
  panes.focus(props.leaf.id);
}

function close() {
  panes.closePane(props.leaf.id);
}

const isTerminal = computed(() =>
  ['powershell', 'cmd', 'wsl'].includes(props.leaf.type),
);

async function copySelection() {
  // xterm native getSelection — WebGL renderer'da window.getSelection() boş
  // dönebilir (canvas/webgl DOM'da metin tutmaz). Terminal pane ise ref ile
  // çağır, AI/welcome pane'lerde fallback DOM seçimi.
  let text = terminalRef.value?.getSelection() ?? '';
  if (!text) text = window.getSelection()?.toString() ?? '';
  if (!text) {
    toasts.warning(t('common.copy') + ': —');
    return;
  }
  await navigator.clipboard.writeText(text);
  toasts.success(t('common.copy') + ' ✓', 1200);
}

async function pasteIntoTerminal() {
  if (!props.leaf.ptyId) return;
  const text = await navigator.clipboard.readText();
  if (!text) return;
  await api.ptyWrite(props.leaf.ptyId, new TextEncoder().encode(text));
}

function clearTerminal() {
  // xterm native clear: hem görünür ekran hem scrollback. Form feed (\x0c)
  // PowerShell/CMD'ye sadece "ekranı temizle" diyordu, scrollback geride
  // kalıyordu. Native API tam temizlik sağlar.
  if (terminalRef.value) {
    terminalRef.value.clearTerminal();
    return;
  }
  // Terminal pane mount değilse fallback (örn. henüz spawn olmamış)
  if (props.leaf.ptyId) {
    api.ptyWrite(props.leaf.ptyId, new TextEncoder().encode('\x0c'));
  }
}

function buildMenu(): MenuEntry[] {
  const items: MenuEntry[] = [];

  // Terminal-only items
  if (isTerminal.value && props.leaf.status === 'running') {
    items.push(
      { id: 'copy',  label: t('pane.actions.copy'),  icon: '⎘', shortcut: 'Ctrl+Shift+C', onClick: copySelection },
      { id: 'paste', label: t('pane.actions.paste'), icon: '⎗', shortcut: 'Ctrl+Shift+V', onClick: pasteIntoTerminal },
      { id: 'clear', label: t('pane.actions.clear'), icon: '⌫', shortcut: 'Ctrl+L',       onClick: clearTerminal },
      { kind: 'separator' },
    );
  }

  // AI pane items
  if (props.leaf.type === 'aiChat') {
    items.push(
      { id: 'copy', label: t('pane.actions.copy'), icon: '⎘', shortcut: 'Ctrl+Shift+C', onClick: copySelection },
      { kind: 'separator' },
    );
  }

  // Common pane items
  items.push(
    { id: 'splitH', label: t('pane.splitHorizontal'), icon: '┃', shortcut: 'Ctrl+Shift+\\', onClick: () => {
      panes.splitFocused('horizontal', 'powershell', t('pane.type.powershell'));
    }},
    { id: 'splitV', label: t('pane.splitVertical'),   icon: '━', shortcut: 'Ctrl+Shift+-', onClick: () => {
      panes.splitFocused('vertical', 'powershell', t('pane.type.powershell'));
    }},
    { id: 'newPane', label: t('pane.new'), icon: '＋', shortcut: 'Ctrl+Shift+T', onClick: () => {
      // Tip seçim diyaloğunu aç — kullanıcı PowerShell/CMD/AI'dan birini seçer
      modals.open('newPane');
    }},
    { id: 'newTab', label: t('tab.new'), icon: '⊞', shortcut: 'Ctrl+T', onClick: () => {
      panes.newTab();
    }},
    { kind: 'separator' },
    { id: 'close', label: t('pane.close'), icon: '×', shortcut: 'Ctrl+Shift+W', danger: true, onClick: close },
  );

  return items;
}

function onContextMenu(e: MouseEvent) {
  focus();
  ctx.show(e, buildMenu());
}
</script>

<template>
  <div
    class="slot"
    :class="{ focused: isFocused, error: leaf.status === 'error' }"
    @mousedown="focus"
    @contextmenu.prevent="onContextMenu"
  >
    <PaneTitleBar :leaf="leaf" :focused="isFocused" @close="close" />
    <div class="slot__body">
      <ErrorPane v-if="leaf.status === 'error'" :leaf="leaf" />
      <TerminalPane v-else-if="isTerminal" ref="terminalRef" :leaf="leaf" />
      <AIChatPane v-else-if="leaf.type === 'aiChat'" :leaf="leaf" />
      <LogStreamPane v-else-if="leaf.type === 'logStream'" :leaf="leaf" />
      <WelcomePane v-else-if="leaf.type === 'welcome'" />
    </div>
  </div>
</template>

<style scoped>
.slot {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid transparent;
  transition: border-color 0.12s ease;
  /* Şeffaflık için transparent — pane içindeki TerminalPane / AIChatPane
     kendi bg'sini render eder (terminal koyu, AI panel açık). */
  background: transparent;
}
.slot.focused {
  border-color: var(--color-accent);
}
.slot.error {
  border-color: var(--color-red);
}
.slot__body {
  flex: 1;
  display: flex;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
