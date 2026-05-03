// Profile store. Built-in + kullanıcı profilleri. Kullanıcı tarafı SQLite settings'te
// JSON array olarak persist (`profiles.user`).

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import { api } from '@/api/tauri';
import {
  BUILTIN_PROFILES,
  type ShellProfile,
} from '@/types/profile';
import { createLogger } from '@/utils/logger';

const STORAGE_KEY = 'profiles.user';
const log = createLogger('profiles');

export const useProfilesStore = defineStore('profiles', () => {
  const userProfiles = ref<ShellProfile[]>([]);
  const loaded = ref(false);

  /** Built-in + kullanıcı — UI'da listeleme için tek liste. */
  const all = computed<ShellProfile[]>(() => [...BUILTIN_PROFILES, ...userProfiles.value]);

  function find(id: string): ShellProfile | null {
    return all.value.find((p) => p.id === id) ?? null;
  }

  /** PaneType bazlı varsayılan profil bul (TerminalPane fallback'i için). */
  function defaultFor(paneType: string): ShellProfile | null {
    return BUILTIN_PROFILES.find((p) => p.paneType === paneType) ?? null;
  }

  async function load() {
    try {
      const raw = await api.settingsGet(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          userProfiles.value = parsed.filter((p) => p && !p.builtin);
        }
      }
    } catch (e) {
      log.warn('profiles load failed', { error: String(e) });
    } finally {
      loaded.value = true;
    }
  }

  async function persist() {
    if (!loaded.value) return;
    try {
      await api.settingsSet(STORAGE_KEY, JSON.stringify(userProfiles.value));
    } catch (e) {
      log.warn('profiles persist failed', { error: String(e) });
    }
  }

  watch(userProfiles, () => persist(), { deep: true });

  function add(p: Omit<ShellProfile, 'id' | 'builtin'>): ShellProfile {
    const fresh: ShellProfile = { ...p, id: uuid(), builtin: false };
    userProfiles.value.push(fresh);
    return fresh;
  }

  function update(id: string, patch: Partial<ShellProfile>) {
    const idx = userProfiles.value.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const existing = userProfiles.value[idx]!;
    if (existing.builtin) return; // built-in koruma
    userProfiles.value[idx] = { ...existing, ...patch, builtin: false };
  }

  function remove(id: string) {
    userProfiles.value = userProfiles.value.filter((p) => p.id !== id || p.builtin);
  }

  function duplicate(id: string): ShellProfile | null {
    const src = find(id);
    if (!src) return null;
    return add({
      name: `${src.name} (copy)`,
      shell: src.shell,
      args: [...src.args],
      cwd: src.cwd,
      env: { ...(src.env ?? {}) },
      icon: src.icon,
      paneType: src.paneType,
      color: src.color,
    });
  }

  return { userProfiles, all, loaded, find, defaultFor, load, add, update, remove, duplicate };
});
