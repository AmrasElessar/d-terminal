// Trigger store — SQLite settings tablosunda JSON array olarak persist edilir.
// TerminalPane output handler her satırda `match()` çağırır.

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import { api } from '@/api/tauri';
import type { Trigger, TriggerMatch, TriggerScope, TriggerActionKind } from '@/types/trigger';
import { expandTemplate } from '@/types/trigger';
import { useToastsStore } from '@/stores/toasts';
import { useSnippetsStore } from '@/stores/snippets';
import { usePanesStore } from '@/stores/panes';
import { createLogger } from '@/utils/logger';

const STORAGE_KEY = 'triggers.list';
const log = createLogger('triggers');

export const useTriggersStore = defineStore('triggers', () => {
  const triggers = ref<Trigger[]>([]);
  const lastFiredAt = new Map<string, number>(); // triggerId → ms
  const loaded = ref(false);

  // Compiled regex cache — pattern/flags değişene kadar yeniden derleme yok
  const compiled = computed<Map<string, RegExp>>(() => {
    const m = new Map<string, RegExp>();
    for (const t of triggers.value) {
      if (!t.enabled || !t.pattern) continue;
      try {
        const flags = (t.flags.includes('g') ? t.flags : t.flags + 'g');
        m.set(t.id, new RegExp(t.pattern, flags));
      } catch (e) {
        log.warn('invalid trigger pattern', { id: t.id, error: String(e) });
      }
    }
    return m;
  });

  async function load() {
    try {
      const raw = await api.settingsGet(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) triggers.value = parsed;
      }
    } catch (e) {
      log.warn('triggers load failed', { error: String(e) });
    } finally {
      loaded.value = true;
    }
  }

  async function persist() {
    if (!loaded.value) return;
    try {
      await api.settingsSet(STORAGE_KEY, JSON.stringify(triggers.value));
    } catch (e) {
      log.warn('triggers persist failed', { error: String(e) });
    }
  }

  watch(triggers, () => persist(), { deep: true });

  function add(t: Omit<Trigger, 'id' | 'createdAt'>): Trigger {
    const fresh: Trigger = {
      ...t,
      id: uuid(),
      createdAt: new Date().toISOString(),
    };
    triggers.value.push(fresh);
    return fresh;
  }

  function remove(id: string) {
    triggers.value = triggers.value.filter((t) => t.id !== id);
    lastFiredAt.delete(id);
  }

  function update(id: string, patch: Partial<Trigger>) {
    const idx = triggers.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    triggers.value[idx] = { ...triggers.value[idx]!, ...patch };
  }

  function toggle(id: string) {
    const t = triggers.value.find((x) => x.id === id);
    if (t) t.enabled = !t.enabled;
  }

  /** Verilen scope (pane tipi) altında aktif trigger'ları döndür. */
  function applicable(scope: TriggerScope | string): Trigger[] {
    return triggers.value.filter(
      (t) => t.enabled && (t.scope === 'all' || t.scope === scope),
    );
  }

  /** Tek satırı tüm geçerli trigger'lara karşı test et + match'leri döndür.
   *  Yan etki olarak: cooldown takibi, action invoke. */
  function matchLine(line: string, paneId: string, paneScope: string): TriggerMatch[] {
    const out: TriggerMatch[] = [];
    if (!line || triggers.value.length === 0) return out;
    const now = Date.now();
    for (const t of applicable(paneScope)) {
      const re = compiled.value.get(t.id);
      if (!re) continue;
      // cooldown
      const last = lastFiredAt.get(t.id) ?? 0;
      if (t.cooldownMs > 0 && now - last < t.cooldownMs) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      let fired = false;
      while ((m = re.exec(line)) !== null) {
        const match: TriggerMatch = {
          trigger: t,
          text: m[0],
          groups: Array.from(m).slice(1).map((g) => g ?? ''),
          paneId,
        };
        out.push(match);
        invoke(t, m, paneId);
        fired = true;
        // Aynı satırda tek match yeter (rate limit) — break
        break;
      }
      if (fired) lastFiredAt.set(t.id, now);
    }
    return out;
  }

  function invoke(t: Trigger, m: RegExpExecArray, paneId: string) {
    const payload = t.action.payload ?? '';
    const expanded = expandTemplate(payload, m);
    switch (t.action.kind as TriggerActionKind) {
      case 'toast': {
        const toasts = useToastsStore();
        toasts.info(`⟦${t.name}⟧ ${expanded || m[0]}`, 3500);
        break;
      }
      case 'sendToAi': {
        const panes = usePanesStore();
        const prompt = expanded || `Trigger fired: ${t.name}\nMatch: ${m[0]}`;
        navigator.clipboard.writeText(prompt).catch(() => { /* ignore */ });
        // AI Chat pane aç (yoksa)
        if (!panes.allLeaves.some((l) => l.type === 'aiChat')) {
          panes.openPane('aiChat', 'AI Chat');
        }
        const toasts = useToastsStore();
        toasts.info(`⟦${t.name}⟧ → AI prompt panoya kopyalandı`, 2500);
        break;
      }
      case 'runSnippet': {
        const snippetId = Number(t.action.payload);
        if (!Number.isFinite(snippetId)) return;
        const snippets = useSnippetsStore();
        const snippet = snippets.items.find((s) => s.id === snippetId);
        if (!snippet) return;
        const panes = usePanesStore();
        const leaf = panes.getLeaf(paneId);
        if (!leaf?.ptyId) return;
        api.ptyWrite(leaf.ptyId, new TextEncoder().encode(snippet.command + '\r')).catch(() => {});
        break;
      }
      case 'capture': {
        log.info('trigger capture', { id: t.id, name: t.name, match: m[0], paneId });
        break;
      }
      case 'highlight': {
        // v2 — xterm decoration API ile satır highlight; şimdilik no-op
        break;
      }
    }
  }

  return {
    triggers,
    load,
    add,
    remove,
    update,
    toggle,
    matchLine,
    applicable,
  };
});
