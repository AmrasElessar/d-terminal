<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePanesStore } from '@/stores/panes';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useAIStore } from '@/stores/ai';
import { keybindings } from '@/keybindings/registry';
import PaneLayout from '@/components/layout/PaneLayout.vue';
import StatusBar from '@/components/ui/StatusBar.vue';
import NewPaneDialog from '@/components/ui/NewPaneDialog.vue';
import SettingsModal from '@/components/ui/SettingsModal.vue';
import type { PaneType } from '@/types/pane';

const { t, locale } = useI18n();
const panes = usePanesStore();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const ai = useAIStore();

const newPaneOpen = ref(false);
const settingsOpen = ref(false);

function openNewPane() {
  newPaneOpen.value = true;
}

function createPane(type: PaneType) {
  const title = t(`pane.type.${type}`);
  panes.openPane(type, title);
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
function openSettings() {
  settingsOpen.value = true;
}

onMounted(async () => {
  await settings.load();
  // Dil senkronu
  locale.value = settings.state.language;
  await themeStore.load();
  themeStore.setActive(settings.state.themeName);
  await ai.refresh();
  await panes.startListening();

  // Açılış davranışı
  if (settings.state.startup === 'welcome') {
    panes.openPane('welcome', t('pane.type.welcome'));
  }

  // Klavye kısayolları
  keybindings.register('pane.new', openNewPane);
  keybindings.register('pane.close', closeFocused);
  keybindings.register('pane.splitHorizontal', splitH);
  keybindings.register('pane.splitVertical', splitV);
  keybindings.register('pane.focusNext', () => panes.focusNext());
  keybindings.register('pane.focusPrev', () => panes.focusPrev());
  keybindings.register('ai.openPane', openAi);
  keybindings.register('settings.open', openSettings);
  keybindings.register('dfetch.run', () => panes.openPane('welcome', t('pane.type.welcome')));
  keybindings.attach();
});

// Tema/dil değişince persist
watch(
  () => settings.state.themeName,
  (n) => themeStore.setActive(n),
);
watch(
  () => settings.state.language,
  (n) => {
    locale.value = n;
  },
);
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
        <span class="spacer" />
        <button type="button" @click="openSettings">{{ t('settings.title') }}</button>
      </nav>
    </header>
    <PaneLayout />
    <StatusBar />
    <NewPaneDialog :open="newPaneOpen" @close="newPaneOpen = false" @create="createPane" />
    <SettingsModal :open="settingsOpen" @close="settingsOpen = false" />
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
}
.shell__menu button:hover {
  background: rgba(255, 255, 255, 0.05);
  opacity: 1;
}
.shell__menu .spacer { flex: 1; }
</style>
