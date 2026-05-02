// Tema store — JSON dosyalarını yükler, aktif temayı CSS variable olarak uygular.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/tauri';
import type { Theme } from '@/types/theme';
import { applyTheme } from '@/themes/apply';

export const useThemeStore = defineStore('theme', () => {
  const themes = ref<Theme[]>([]);
  const activeName = ref<string>('D-Dark');
  const loaded = ref(false);

  const active = computed<Theme | null>(
    () => themes.value.find((t) => t.name === activeName.value) ?? themes.value[0] ?? null,
  );

  async function load() {
    const files = await api.themesList();
    const parsed: Theme[] = [];
    for (const f of files) {
      try {
        parsed.push(JSON.parse(f.content) as Theme);
      } catch (e) {
        console.warn('theme parse failed', f.name, e);
      }
    }
    themes.value = parsed;
    loaded.value = true;
    apply();
  }

  function setActive(name: string) {
    activeName.value = name;
    apply();
  }

  function apply() {
    if (active.value) applyTheme(active.value);
  }

  return { themes, activeName, active, loaded, load, setActive, apply };
});
