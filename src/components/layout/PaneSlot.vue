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

// --- Pane drag-drop yeniden konumlandırma ---
type DropSide = 'left' | 'right' | 'top' | 'bottom';
const dropSide = ref<DropSide | null>(null);
let dragEnterDepth = 0;

function isPaneDrag(e: DragEvent): boolean {
  return !!e.dataTransfer && e.dataTransfer.types.includes('application/x-pane-id');
}

/** Diagonal-bisected zone: |dx| > |dy| → sol/sağ, aksi halde üst/alt.
 *  Pane içinde imleç merkez (0.5, 0.5) referans alınır. */
function computeSide(e: DragEvent, el: HTMLElement): DropSide {
  const rect = el.getBoundingClientRect();
  const x = (e.clientX - rect.left) / Math.max(rect.width, 1);
  const y = (e.clientY - rect.top) / Math.max(rect.height, 1);
  const dx = x - 0.5;
  const dy = y - 0.5;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

function onDragEnter(e: DragEvent) {
  if (!isPaneDrag(e)) return;
  dragEnterDepth++;
}

function onDragOver(e: DragEvent) {
  if (!isPaneDrag(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  // Kaynak pane'in üstünde drop indicator gösterme — düşürse de no-op olur,
  // görsel kafa karışıklığı yaratır.
  if (panes.draggingPaneId === props.leaf.id) {
    dropSide.value = null;
    return;
  }
  dropSide.value = computeSide(e, e.currentTarget as HTMLElement);
}

function onDragLeave() {
  dragEnterDepth = Math.max(0, dragEnterDepth - 1);
  if (dragEnterDepth === 0) dropSide.value = null;
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const sourceId = e.dataTransfer?.getData('application/x-pane-id');
  const side = dropSide.value;
  dragEnterDepth = 0;
  dropSide.value = null;
  if (!sourceId || !side) return;
  panes.movePane(sourceId, props.leaf.id, side);
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
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <PaneTitleBar :leaf="leaf" :focused="isFocused" @close="close" />
    <div class="slot__body">
      <ErrorPane v-if="leaf.status === 'error'" :leaf="leaf" />
      <TerminalPane v-else-if="isTerminal" ref="terminalRef" :leaf="leaf" />
      <AIChatPane v-else-if="leaf.type === 'aiChat'" :leaf="leaf" />
      <LogStreamPane v-else-if="leaf.type === 'logStream'" :leaf="leaf" />
      <WelcomePane v-else-if="leaf.type === 'welcome'" />
    </div>
    <div
      v-if="dropSide"
      class="drop-indicator"
      :class="`drop-indicator--${dropSide}`"
      aria-hidden="true"
    />
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
  position: relative; /* drop-indicator absolute referansı */
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

/* Drop indicator: yarı saydam vurgu, ilgili kenarda yarısı dolu.
   pointer-events: none — drag/drop işleyişine müdahale etmez,
   dragleave/drop hâlâ slot kapsayıcısına gider. */
.drop-indicator {
  position: absolute;
  pointer-events: none;
  background: var(--color-accent);
  opacity: 0.18;
  border: 1px solid var(--color-accent);
  z-index: 5;
  transition: all 0.08s ease;
}
.drop-indicator--left   { left: 0;   top: 0;    width: 50%;  height: 100%; }
.drop-indicator--right  { right: 0;  top: 0;    width: 50%;  height: 100%; }
.drop-indicator--top    { left: 0;   top: 0;    width: 100%; height: 50%; }
.drop-indicator--bottom { left: 0;   bottom: 0; width: 100%; height: 50%; }
</style>
