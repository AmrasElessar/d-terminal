<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useAIStore } from '@/stores/ai';
import { useSnippetsStore } from '@/stores/snippets';
import { keybindings } from '@/keybindings/registry';
import PaneLayout from '@/components/layout/PaneLayout.vue';
import StatusBar from '@/components/ui/StatusBar.vue';
import NewPaneDialog from '@/components/ui/NewPaneDialog.vue';
import SettingsModal from '@/components/ui/SettingsModal.vue';
import HistoryModal from '@/components/ui/HistoryModal.vue';
import SessionModal from '@/components/ui/SessionModal.vue';
import SnippetModal from '@/components/ui/SnippetModal.vue';
import CommandPalette from '@/components/ui/CommandPalette.vue';
import ToastContainer from '@/components/ui/ToastContainer.vue';
import type { PaneType } from '@/types/pane';

const { t, locale } = useI18n();
const panes = usePanesStore();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const ai = useAIStore();
const snippets = useSnippetsStore();

const newPaneOpen = ref(false);
const settingsOpen = ref(false);
const historyOpen = ref(false);
const snippetsOpen = ref(false);
const paletteOpen = ref(false);
const sessionOpen = ref(false);
const sessionMode = ref<'save' | 'load'>('save');

function closeAllModals() {
  newPaneOpen.value = false;
  settingsOpen.value = false;
  historyOpen.value = false;
  snippetsOpen.value = false;
  paletteOpen.value = false;
  sessionOpen.value = false;
}

function openNewPane() { newPaneOpen.value = true; }
function openSettings() { closeAllModals(); settingsOpen.value = true; }
function openHistory() { closeAllModals(); historyOpen.value = true; }
function openSnippets() { closeAllModals(); snippetsOpen.value = true; }
function openPalette() { closeAllModals(); paletteOpen.value = true; }
function openSessionSave() { closeAllModals(); sessionMode.value = 'save'; sessionOpen.value = true; }
function openSessionLoad() { closeAllModals(); sessionMode.value = 'load'; sessionOpen.value = true; }

function createPane(type: PaneType) {
  panes.openPane(type, t(`pane.type.${type}`));
  newPaneOpen.value = false;
}

function closeFocused() {
  if (panes.tree.focusedId) panes.closePane(panes.tree.focusedId);
}

function splitH() {
  panes.splitFocused('horizontal', 'powershell', t('pane.type.powershell'));
}
function splitV() {
  panes.splitFocused('vertical', 'powershell', t('pane.type.powershell'));
}
function openAi() {
  panes.openPane('aiChat', t('pane.type.aiChat'));
}

function paletteNavigate(action: string) {
  paletteOpen.value = false;
  switch (action) {
    case 'settings': openSettings(); break;
    case 'history': openHistory(); break;
    case 'snippets': openSnippets(); break;
    case 'session-save': openSessionSave(); break;
    case 'session-load': openSessionLoad(); break;
  }
}

onMounted(async () => {
  await settings.load();
  locale.value = settings.state.language;
  await themeStore.load();
  themeStore.setActive(settings.state.themeName);
  await ai.refresh();
  await snippets.load();
  await panes.startListening();

  if (settings.state.startup === 'welcome') {
    panes.openPane('welcome', t('pane.type.welcome'));
  }

  keybindings.register('pane.new', openNewPane);
  keybindings.register('pane.close', closeFocused);
  keybindings.register('pane.splitHorizontal', splitH);
  keybindings.register('pane.splitVertical', splitV);
  keybindings.register('pane.focusNext', () => panes.focusNext());
  keybindings.register('pane.focusPrev', () => panes.focusPrev());
  keybindings.register('ai.openPane', openAi);
  keybindings.register('settings.open', openSettings);
  keybindings.register('history.search', openHistory);
  keybindings.register('commandPalette.open', openPalette);
  keybindings.register('session.save', openSessionSave);
  keybindings.register('session.load', openSessionLoad);
  keybindings.register('dfetch.run', () => panes.openPane('welcome', t('pane.type.welcome')));
  keybindings.attach();
});

watch(() => settings.state.themeName, (n) => themeStore.setActive(n));
watch(() => settings.state.language, (n) => { locale.value = n; });
</script>

<template>
  <main class="shell">
    <header class="shell__header">
      <div class="shell__brand">{{ t('app.title') }}</div>
      <nav class="shell__menu">
        <button type="button" @click="openNewPane">{{ t('pane.new') }}</button>
        <button type="button" @click="splitH">{{ t('pane.splitHorizontal') }}</button>
        <button type="button" @click="splitV">{{ t('pane.splitVertical') }}</button>
        <button type="button" @click="openAi">{{ t('pane.type.aiChat') }}</button>
        <button type="button" @click="openHistory">{{ t('history.title') }}</button>
        <button type="button" @click="openSnippets">{{ t('snippet.title') }}</button>
        <span class="spacer" />
        <button type="button" @click="openPalette">⌘ {{ t('commandPalette.placeholder') }}</button>
        <button type="button" @click="openSettings">{{ t('settings.title') }}</button>
      </nav>
    </header>
    <PaneLayout />
    <StatusBar />
    <NewPaneDialog :open="newPaneOpen" @close="newPaneOpen = false" @create="createPane" />
    <SettingsModal :open="settingsOpen" @close="settingsOpen = false" />
    <HistoryModal :open="historyOpen" @close="historyOpen = false" />
    <SnippetModal :open="snippetsOpen" @close="snippetsOpen = false" />
    <SessionModal :open="sessionOpen" :mode="sessionMode" @close="sessionOpen = false" />
    <CommandPalette :open="paletteOpen" @close="paletteOpen = false" @navigate="paletteNavigate" />
    <ToastContainer />
  </main>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-bg);
  color: var(--color-fg);
  font-family: var(--font-family);
}
.shell__header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 6px 12px;
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  flex-shrink: 0;
  user-select: none;
}
.shell__brand {
  font-weight: 700;
  font-size: 13px;
  background: var(--pane-title-gradient, linear-gradient(90deg, var(--color-accent), var(--color-accent2)));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.shell__menu {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
}
.shell__menu button {
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-fg);
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.8;
  font-family: inherit;
}
.shell__menu button:hover {
  background: rgba(255, 255, 255, 0.05);
  opacity: 1;
}
.shell__menu .spacer { flex: 1; }
</style>
