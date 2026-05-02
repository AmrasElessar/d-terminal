// Snippet store. Backend SQLite ile senkron, dinamik kısayolları
// keybinding registry'ye bağlar.

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '@/api/tauri';
import type { NewSnippet, Snippet } from '@/types/snippet';
import { keybindings } from '@/keybindings/registry';
import { usePanesStore } from '@/stores/panes';
import { useToastsStore } from '@/stores/toasts';

const SHORTCUT_PREFIX = 'snippet.dynamic.';

export const useSnippetsStore = defineStore('snippets', () => {
  const items = ref<Snippet[]>([]);

  async function load() {
    items.value = await api.snippetList();
    rebindShortcuts();
  }

  async function upsert(input: NewSnippet) {
    await api.snippetUpsert(input);
    await load();
  }

  async function remove(id: number) {
    await api.snippetDelete(id);
    await load();
  }

  function run(snippet: Snippet) {
    const panes = usePanesStore();
    const toasts = useToastsStore();
    const focused = panes.focused;
    if (!focused?.ptyId) {
      // Burada t() yok — store seviyesinde i18n erişimi karmaşık. UI tetikleyici
      // yerine store'dan toast atıyoruz; mesaj key'i caller tarafından geçilebilir
      // ama basit tutalım: snippet adıyla notify et.
      toasts.warning(`No active pane: ${snippet.name}`);
      return;
    }
    api.ptyWrite(focused.ptyId, new TextEncoder().encode(snippet.command + '\r')).catch((e) => {
      toasts.error(String(e));
    });
  }

  function rebindShortcuts() {
    // Mevcut dinamik kısayolları temizle
    for (const def of keybindings.getAll()) {
      if (def.id.startsWith(SHORTCUT_PREFIX)) {
        keybindings.unregister(def.id);
      }
    }
    for (const s of items.value) {
      if (!s.shortcut) continue;
      const id = `${SHORTCUT_PREFIX}${s.id}`;
      const conflict = keybindings.setCombo(id, s.shortcut);
      if (conflict) continue; // çakışma — sessiz atla, UI'da uyarı çıkar
      keybindings.register(id, () => run(s));
    }
  }

  return { items, load, upsert, remove, run };
});
