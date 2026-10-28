// Trigger store — SQLite settings tablosunda JSON array olarak persist edilir.
// TerminalPane output handler her satırda `match()` çağırır.

import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import { api } from '@/api/tauri';
import type { Trigger, TriggerMatch, TriggerScope, TriggerActionKind } from '@/types/trigger';
import {
  expandTemplate,
  sanitizeTrigger,
  RUN_SNIPPET_MAX_PER_MINUTE,
  RUN_SNIPPET_MIN_COOLDOWN_MS,
} from '@/types/trigger';
import { useAIStore } from '@/stores/ai';
import { frameTerminalOutput } from '@/composables/useAISuggestion';
import { useToastsStore } from '@/stores/toasts';
import { useSnippetsStore } from '@/stores/snippets';
import { usePanesStore } from '@/stores/panes';
import { createLogger } from '@/utils/logger';
import { i18n } from '@/i18n';

const STORAGE_KEY = 'triggers.list';
const log = createLogger('triggers');

export const useTriggersStore = defineStore('triggers', () => {
  const triggers = ref<Trigger[]>([]);
  const lastFiredAt = new Map<string, number>(); // triggerId → ms
  /** runSnippet çalıştırma zamanları (son 1 dk) — döngü koruması. */
  const runHistory = new Map<string, number[]>();
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
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          triggers.value = parsed
            .map(sanitizeTrigger)
            .filter((t): t is Trigger => t !== null);
        }
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
    runHistory.delete(id);
    // compiled regex cache computed → triggers.value değişince yeniden
    // hesaplanır, silinen id otomatik düşer. lastFiredAt manuel cleanup.
  }

  function update(id: string, patch: Partial<Trigger>) {
    const idx = triggers.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    triggers.value[idx] = { ...triggers.value[idx]!, ...patch };
  }

  function toggleOff(id: string) {
    const t = triggers.value.find((x) => x.id === id);
    if (t) t.enabled = false;
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
      // cooldown — runSnippet için zorunlu alt sınır (kendini tetikleme döngüsü)
      const last = lastFiredAt.get(t.id) ?? 0;
      const cooldown = t.action.kind === 'runSnippet'
        ? Math.max(t.cooldownMs, RUN_SNIPPET_MIN_COOLDOWN_MS)
        : t.cooldownMs;
      if (cooldown > 0 && now - last < cooldown) continue;
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
        const tFn = i18n.global.t;
        // Eşleşen metin terminal çıktısıdır — güvenilmez + secret içerebilir.
        const framed = frameTerminalOutput(expanded || m[0]);
        const prompt = tFn('triggers.action.aiPrompt', { name: t.name, output: framed.text });
        useAIStore().queuePrompt(prompt);
        // AI Chat pane'i KAYNAK pane'in tab'ında aç (aktif tab'da değil) ve
        // odağı çalma — kullanıcı başka yerde yazıyor olabilir.
        panes.ensureAiChatNear(paneId, tFn('pane.type.aiChat'));
        useToastsStore().info(tFn('triggers.action.aiQueued', { name: t.name }), 2500);
        break;
      }
      case 'runSnippet': {
        const tFn = i18n.global.t;
        const snippetId = Number(t.action.payload);
        if (!Number.isFinite(snippetId)) return;
        const snippets = useSnippetsStore();
        const snippet = snippets.items.find((s) => s.id === snippetId);
        if (!snippet) return;
        // Terminal çıktısıyla komut çalıştırma açık izin ister.
        if (!t.allowAutoRun) {
          useToastsStore().warning(tFn('triggers.action.autoRunBlocked', { name: t.name }), 4000);
          return;
        }
        // Döngü koruması: dakikada en fazla N çalıştırma, aşılırsa devre dışı
        const now = Date.now();
        const hist = (runHistory.get(t.id) ?? []).filter((ts) => now - ts < 60_000);
        if (hist.length >= RUN_SNIPPET_MAX_PER_MINUTE) {
          toggleOff(t.id);
          useToastsStore().error(tFn('triggers.action.autoRunDisabled', { name: t.name }), 6000);
          return;
        }
        hist.push(now);
        runHistory.set(t.id, hist);
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
