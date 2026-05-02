// Kullanıcı ayarları — SQLite settings tablosuyla senkron.

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { api } from '@/api/tauri';

export type StartupMode = 'welcome' | 'lastSession' | 'empty';

export interface SettingsState {
  language: 'tr' | 'en';
  themeName: string;
  fontFamily: string;
  fontSize: number;
  ligatures: boolean;
  opacity: number;
  blur: number;
  startup: StartupMode;
}

const DEFAULTS: SettingsState = {
  language: 'tr',
  themeName: 'D-Dark',
  fontFamily: 'JetBrains Mono',
  fontSize: 14,
  ligatures: true,
  opacity: 1.0,
  blur: 0,
  startup: 'welcome',
};

const KEY_PREFIX = 'ui.';

export const useSettingsStore = defineStore('settings', () => {
  const state = ref<SettingsState>({ ...DEFAULTS });
  const loaded = ref(false);

  async function load() {
    try {
      const all = await api.settingsAll();
      for (const k of Object.keys(state.value) as Array<keyof SettingsState>) {
        const raw = all[`${KEY_PREFIX}${k}`];
        if (raw !== undefined) {
          try {
            (state.value as Record<string, unknown>)[k] = JSON.parse(raw);
          } catch {
            // bozuk değer — defaults kalır
          }
        }
      }
    } finally {
      loaded.value = true;
    }
  }

  async function persist<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    state.value[key] = value;
    await api.settingsSet(`${KEY_PREFIX}${String(key)}`, JSON.stringify(value));
  }

  // Auto-persist watch — load tamamlandıktan sonra aktif
  watch(
    () => ({ ...state.value }),
    async (next, prev) => {
      if (!loaded.value) return;
      const changed = (Object.keys(next) as Array<keyof SettingsState>).filter(
        (k) => JSON.stringify(next[k]) !== JSON.stringify(prev?.[k]),
      );
      for (const k of changed) {
        await api.settingsSet(`${KEY_PREFIX}${String(k)}`, JSON.stringify(next[k]));
      }
    },
    { deep: true },
  );

  const isReady = computed(() => loaded.value);

  return { state, isReady, load, persist };
});
