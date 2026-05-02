<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSettingsStore } from '@/stores/settings';
import { useThemeStore } from '@/stores/theme';
import { useAIStore } from '@/stores/ai';
import { ALL_PROVIDER_IDS } from '@/providers/registry';
import type { ProviderId } from '@/types/ai';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();
const settings = useSettingsStore();
const themeStore = useThemeStore();
const ai = useAIStore();

type Tab = 'general' | 'appearance' | 'providers' | 'shortcuts';
const tab = ref<Tab>('general');

const newKey = ref<Record<ProviderId, string>>({} as Record<ProviderId, string>);

async function applyLanguage(lang: 'tr' | 'en') {
  settings.state.language = lang;
  locale.value = lang;
}

async function applyTheme(name: string) {
  settings.state.themeName = name;
  themeStore.setActive(name);
}

async function saveKey(id: ProviderId) {
  const key = newKey.value[id]?.trim();
  if (!key) return;
  await ai.setKey(id, key);
  newKey.value[id] = '';
}

async function deleteKey(id: ProviderId) {
  await ai.removeKey(id);
}

void props.open;
</script>

<template>
  <dialog v-if="open" class="dialog" open @click.self="emit('close')">
    <article class="dialog__panel">
      <header class="dialog__header">
        <h2>{{ t('settings.title') }}</h2>
        <button type="button" class="close" @click="emit('close')">×</button>
      </header>
      <nav class="tabs">
        <button
          v-for="key in ['general', 'appearance', 'providers', 'shortcuts'] as Tab[]"
          :key="key"
          type="button"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          {{ t(`settings.tabs.${key}`) }}
        </button>
      </nav>

      <section v-if="tab === 'general'" class="section">
        <label class="field">
          <span>{{ t('settings.general.language') }}</span>
          <select :value="settings.state.language" @change="applyLanguage(($event.target as HTMLSelectElement).value as 'tr' | 'en')">
            <option value="tr">Türkçe</option>
            <option value="en">English</option>
          </select>
          <small>{{ t('settings.general.languageHint') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.general.startup') }}</span>
          <select v-model="settings.state.startup">
            <option value="welcome">{{ t('settings.general.startupOptions.welcome') }}</option>
            <option value="lastSession">{{ t('settings.general.startupOptions.lastSession') }}</option>
            <option value="empty">{{ t('settings.general.startupOptions.empty') }}</option>
          </select>
        </label>
        <p class="note">{{ t('settings.general.telemetryHint') }}</p>
      </section>

      <section v-if="tab === 'appearance'" class="section">
        <label class="field">
          <span>{{ t('settings.appearance.theme') }}</span>
          <select :value="settings.state.themeName" @change="applyTheme(($event.target as HTMLSelectElement).value)">
            <option v-for="theme in themeStore.themes" :key="theme.name" :value="theme.name">{{ theme.name }}</option>
          </select>
          <small>{{ t('settings.appearance.themeHint') }}</small>
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.fontFamily') }}</span>
          <input v-model="settings.state.fontFamily" type="text" />
        </label>
        <label class="field">
          <span>{{ t('settings.appearance.fontSize') }}</span>
          <input v-model.number="settings.state.fontSize" type="number" min="8" max="32" />
        </label>
        <label class="field row">
          <input v-model="settings.state.ligatures" type="checkbox" />
          <span>{{ t('settings.appearance.ligatures') }}</span>
        </label>
      </section>

      <section v-if="tab === 'providers'" class="section">
        <h3>{{ t('settings.providers.title') }}</h3>
        <div v-for="id in ALL_PROVIDER_IDS" :key="id" class="provider">
          <div class="provider__header">
            <strong>{{ t(`ai.provider.${id}`) }}</strong>
            <span v-if="id === 'ollama'" class="badge">{{ t('settings.providers.keyStored').split(' ')[0] }}</span>
            <span v-else-if="ai.statuses[id]?.hasKey" class="badge ok">{{ ai.statuses[id]?.maskedKey }}</span>
            <span v-else class="badge">{{ t('settings.providers.keyNotSet') }}</span>
          </div>
          <div v-if="id !== 'ollama'" class="provider__row">
            <input
              v-model="newKey[id]"
              type="password"
              :placeholder="t('settings.providers.addKey')"
            />
            <button type="button" class="primary" @click="saveKey(id)">
              {{ t('common.save') }}
            </button>
            <button
              v-if="ai.statuses[id]?.hasKey"
              type="button"
              class="ghost"
              @click="deleteKey(id)"
            >
              {{ t('settings.providers.removeKey') }}
            </button>
          </div>
          <small>{{ t('settings.providers.keyStored') }}</small>
        </div>
      </section>

      <section v-if="tab === 'shortcuts'" class="section">
        <p class="note">{{ t('settings.shortcuts.title') }}</p>
        <p class="note">v1.0.5 — {{ t('common.loading') }}</p>
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
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  padding: 0;
  z-index: 100;
}
.dialog__panel {
  background: var(--color-bg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--ui-radius, 8px);
  width: min(720px, 92vw);
  max-height: 80vh;
  overflow-y: auto;
  color: var(--color-fg);
}
.dialog__header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.dialog__header h2 { margin: 0; font-size: 16px; flex: 1; }
.close { background: transparent; border: none; color: var(--color-fg); cursor: pointer; font-size: 22px; line-height: 1; }
.tabs {
  display: flex;
  gap: 4px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}
.tabs button {
  background: transparent;
  border: none;
  color: var(--color-fg);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.6;
}
.tabs button.active {
  background: rgba(255, 255, 255, 0.05);
  opacity: 1;
  color: var(--color-accent);
}
.section { padding: 20px; display: flex; flex-direction: column; gap: 16px; }
.field { display: flex; flex-direction: column; gap: 4px; }
.field.row { flex-direction: row; align-items: center; gap: 8px; }
.field span { font-size: 12px; opacity: 0.8; }
.field small { font-size: 11px; opacity: 0.5; }
.field input, .field select {
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  padding: 6px 8px;
  font-family: inherit;
}
.note { font-size: 12px; opacity: 0.6; margin: 0; }
.provider { padding: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 6px; }
.provider__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.badge {
  background: rgba(255, 255, 255, 0.06);
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  opacity: 0.8;
}
.badge.ok {
  background: rgba(0, 200, 0, 0.12);
  color: var(--color-green);
  font-family: var(--font-family);
}
.provider__row {
  display: flex;
  gap: 6px;
  margin-bottom: 6px;
}
.provider__row input {
  flex: 1;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-fg);
  padding: 6px 8px;
  border-radius: 4px;
  font-family: var(--font-family);
}
.primary {
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  padding: 6px 12px;
  border-radius: 4px;
  font-weight: 600;
  cursor: pointer;
}
.ghost {
  background: transparent;
  color: var(--color-fg);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
}
</style>
