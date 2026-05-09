// Tema store — JSON dosyalarını yükler, aktif temayı CSS variable olarak uygular.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/tauri';
import type { Theme, ThemeColors } from '@/types/theme';
import { applyTheme } from '@/themes/apply';

/** Tema JSON şema doğrulaması — community theme paylaşımı (themes/COMMUNITY.md)
 *  + kullanıcı user/themes/ alt dizini. Bozuk şema (eksik renk, yanlış tip)
 *  CSS variable'ları kirletir, ANSI block'lar boş kalır. AJV/Zod yerine
 *  yalın type-guard — extra dependency yok (audit Theme T1). */
const REQUIRED_COLOR_KEYS: Array<keyof ThemeColors> = [
  'background', 'foreground', 'accent', 'accent2', 'cursor', 'selection',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
];

function isValidTheme(t: unknown): t is Theme {
  if (!t || typeof t !== 'object') return false;
  const x = t as Partial<Theme>;
  if (typeof x.name !== 'string' || x.name.length === 0) return false;
  if (typeof x.author !== 'string') return false;
  if (typeof x.version !== 'string') return false;
  if (!x.colors || typeof x.colors !== 'object') return false;
  for (const key of REQUIRED_COLOR_KEYS) {
    const v = (x.colors as unknown as Record<string, unknown>)[key];
    if (typeof v !== 'string' || v.length === 0) return false;
  }
  if (!x.font || typeof x.font !== 'object') return false;
  if (!x.ui || typeof x.ui !== 'object') return false;
  return true;
}

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
        const candidate = JSON.parse(f.content) as unknown;
        if (!isValidTheme(candidate)) {
          console.warn('theme schema invalid (missing/empty required field)', f.name);
          continue;
        }
        parsed.push(candidate);
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
