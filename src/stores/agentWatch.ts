// Agent Watch store — pane başına aktif/geçmiş agent'lar.
//
// TerminalPane OSC 9999 yakaladığında parseAgentEvent() ile tip-güvenli
// event'e çevirir, dispatch() ile bu store'a iter. Sidebar bu state'i okur.
//
// Output buffer agent başına trim'lenir (default 32KB). Eski progress'ler
// kaybolur ama agent metadata kalır — UI özellikle son haline odaklı.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { agentEffectiveCost, type AgentEvent, type AgentInfo, type AgentStatus } from '@/types/agent';
import { MODEL_PRICING } from '@/types/aiPricing';

const MAX_OUTPUT_BYTES = 32 * 1024;
const MAX_THINKING_BLOCKS = 12;
// String field per-event cap'leri — kötü niyetli (veya bug'lı) AI tool tek
// `progress.msg`/`thinking.text`/`await.prompt` ile bellek şişirmesin.
// `output` zaten append-edilirken cumulative cap (MAX_OUTPUT_BYTES) altında;
// burası tek-event input boyutu.
const MAX_NAME_LEN = 200;
const MAX_PROMPT_LEN = 500;
const MAX_THINKING_TEXT_LEN = 4 * 1024;
const MAX_ERROR_LEN = 1000;
const MAX_PROGRESS_MSG_LEN = 16 * 1024;
/** Pane başına tutulan agent sayısı üst sınırı — her biri benzersiz id'li
 *  sonsuz `start` akışı belleği şişirmesin. Aşılınca en eski bitmiş (yoksa en
 *  eski) agent atılır. */
export const MAX_AGENTS_PER_PANE = 64;
/** Kaynak pane başına otomatik açılan agentView split sayısı sınırı. */
const MAX_AUTO_SPLITS_PER_PANE = 4;

/** Cost tahmini için varsayılan model — sidebar dropdown bunu seçer.
 *  Pricing tablosundaki anahtarlardan biri. */
const DEFAULT_MODEL = 'claude-sonnet-4-6';

interface PaneAgents {
  /** Agent id → info. LIFO display sırası `order` ile korunur. */
  byId: Map<string, AgentInfo>;
  /** Eklenme sırası — UI listesi için. */
  order: string[];
  /** Sidebar görünür mü (per-pane toggle). */
  visible: boolean;
  /** Cost tahmini için kullanıcının seçtiği model. Provider event'lerinde
   *  explicit cost gelmiyorsa bu modelin pricing'i ile hesaplanır. */
  modelId: string;
  /** Bu pane için açılmış otomatik split sayısı (sınırlı). */
  autoSplits: number;
}

function evictIfNeeded(pane: PaneAgents) {
  while (pane.order.length > MAX_AGENTS_PER_PANE) {
    // order: en yeni başta → sondan (en eski) bitmiş olanı ara
    let victimIdx = -1;
    for (let i = pane.order.length - 1; i >= 0; i--) {
      const a = pane.byId.get(pane.order[i]!);
      if (!a || (a.status !== 'running' && a.status !== 'waiting')) {
        victimIdx = i;
        break;
      }
    }
    if (victimIdx < 0) victimIdx = pane.order.length - 1;
    const [victim] = pane.order.splice(victimIdx, 1);
    if (victim) pane.byId.delete(victim);
  }
}

export const useAgentWatchStore = defineStore('agentWatch', () => {
  const panes = ref<Map<string, PaneAgents>>(new Map());

  function getPane(paneId: string): PaneAgents {
    let p = panes.value.get(paneId);
    if (!p) {
      p = { byId: new Map(), order: [], visible: false, modelId: DEFAULT_MODEL, autoSplits: 0 };
      panes.value.set(paneId, p);
    }
    return p;
  }

  function setModel(paneId: string, modelId: string) {
    getPane(paneId).modelId = modelId;
  }

  function dispatch(paneId: string, ev: AgentEvent) {
    const pane = getPane(paneId);
    switch (ev.k) {
      case 'start': {
        const isNew = !pane.byId.has(ev.id);
        const info: AgentInfo = {
          id: ev.id,
          name: trimTo(ev.name || ev.id, MAX_NAME_LEN),
          parent: ev.parent,
          status: 'running',
          startedAt: Date.now(),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          output: '',
          thinking: [],
        };
        // Aynı id ile gelen yeni start = reset (re-run).
        pane.byId.set(ev.id, info);
        const idx = pane.order.indexOf(ev.id);
        if (idx < 0) pane.order.unshift(ev.id);
        evictIfNeeded(pane);
        // Otomatik split — settings.autoSplitOnAgent ON ve bu yeni bir agent'sa
        // (re-run değil) kaynak pane'in yanında bir agentView pane'i aç.
        // Lazy import ile circular dep riskini engelle (panes ↔ agentWatch).
        if (isNew && pane.autoSplits < MAX_AUTO_SPLITS_PER_PANE) {
          pane.autoSplits += 1;
          void autoSplitIfEnabled(paneId, ev.id, info.name);
        }
        // Pane'de hiç agent görünmemişse sidebar'ı otomatik aç — kullanıcı
        // ilk agent gelmeden bunu görmeyebilir, agent gelince haberdar et.
        if (!pane.visible) pane.visible = true;
        break;
      }
      case 'progress': {
        const a = pane.byId.get(ev.id);
        if (!a) return;
        // Tek msg parçası MAX_PROGRESS_MSG_LEN'i aşamaz (DoS guard); sonra
        // birikmiş buffer da MAX_OUTPUT_BYTES'a göre tail-trim.
        const chunk = trimTo(ev.msg, MAX_PROGRESS_MSG_LEN);
        a.output = trimTo(a.output + chunk, MAX_OUTPUT_BYTES);
        break;
      }
      case 'tokens': {
        const a = pane.byId.get(ev.id);
        if (!a) return;
        if (typeof ev.in === 'number') a.inputTokens = ev.in;
        if (typeof ev.out === 'number') a.outputTokens = ev.out;
        if (typeof ev.cost === 'number') a.costUsd = ev.cost;
        // Provider explicit cost yaymadıysa sidebar'da seçili model üstünden
        // hesaplanır — bunu UI tarafında yapacağız (computed), store'da
        // costUsd 0 olarak kalır ki "explicit gelmedi" sinyali korunsun.
        break;
      }
      case 'await': {
        const a = pane.byId.get(ev.id);
        if (!a) return;
        a.status = 'waiting';
        if (ev.prompt) a.awaitPrompt = trimTo(ev.prompt, MAX_PROMPT_LEN);
        break;
      }
      case 'thinking': {
        const a = pane.byId.get(ev.id);
        if (!a) return;
        a.thinking.push(trimTo(ev.text, MAX_THINKING_TEXT_LEN));
        if (a.thinking.length > MAX_THINKING_BLOCKS) {
          a.thinking.splice(0, a.thinking.length - MAX_THINKING_BLOCKS);
        }
        break;
      }
      case 'end': {
        const a = pane.byId.get(ev.id);
        if (!a) return;
        a.status = mapEndStatus(ev.status);
        a.endedAt = Date.now();
        a.awaitPrompt = undefined;
        if (ev.error) a.error = trimTo(ev.error, MAX_ERROR_LEN);
        break;
      }
    }
  }

  function setVisible(paneId: string, v: boolean) {
    getPane(paneId).visible = v;
  }
  function toggleVisible(paneId: string) {
    const p = getPane(paneId);
    p.visible = !p.visible;
  }

  function clearPane(paneId: string) {
    panes.value.delete(paneId);
    // Memoize cache'lerini de temizle ki ölü pane id'leri ref tutmasın.
    paneViewCache.delete(paneId);
    paneSummaryCache.delete(paneId);
  }

  /** Pane için reactive view — sidebar bunu okur.
   *  Cost: provider event'te explicit gelmediyse (costUsd === 0 ve token > 0)
   *  seçili modelin pricing'i üstünden hesaplanır (effectiveCost).
   *
   *  Memoize: Daha önce her çağrıda yeni `computed` instance üretiliyordu
   *  (TerminalPane + PaneTitleBar + AgentWatchPanel ayrı çağırınca 60 FPS ×
   *  pane sayısı kadar allocation). Şimdi cache'liyoruz; pane silininceye
   *  kadar aynı computed paylaşılır. */
  type PaneView = ReturnType<typeof buildPaneView>;
  type PaneSummary = ReturnType<typeof buildPaneSummary>;
  const paneViewCache = new Map<string, PaneView>();
  const paneSummaryCache = new Map<string, PaneSummary>();

  function buildPaneView(paneId: string) {
    return computed(() => {
      const p = panes.value.get(paneId);
      if (!p) {
        return {
          agents: [] as Array<AgentInfo & { effectiveCost: number | null }>,
          visible: false,
          hasAny: false,
          modelId: DEFAULT_MODEL,
        };
      }
      const price = MODEL_PRICING[p.modelId];
      const agents = p.order
        .map((id) => p.byId.get(id))
        .filter((a): a is AgentInfo => !!a)
        .map((a) => ({ ...a, effectiveCost: agentEffectiveCost(a, price) }));
      return {
        agents,
        visible: p.visible,
        hasAny: agents.length > 0,
        modelId: p.modelId,
      };
    });
  }
  function paneView(paneId: string): PaneView {
    let c = paneViewCache.get(paneId);
    if (c) return c;
    c = buildPaneView(paneId);
    paneViewCache.set(paneId, c);
    return c;
  }

  /** Tüm pane'lerin toplamı — global statusbar için.
   *  costUsd: agent explicit göndermediyse o pane'in seçili modelinden
   *  hesaplanır. Bilinmeyen model → o agent'ın katkısı `null` → toplam null. */
  const globalSummary = computed(() => {
    let totalTokens = 0;
    let totalCost: number | null = 0;
    let running = 0;
    let waiting = 0;
    let total = 0;
    for (const p of panes.value.values()) {
      const price = MODEL_PRICING[p.modelId];
      for (const a of p.byId.values()) {
        total += 1;
        if (a.status === 'running') running += 1;
        else if (a.status === 'waiting') waiting += 1;
        totalTokens += a.inputTokens + a.outputTokens;
        if (totalCost !== null) {
          const c = agentEffectiveCost(a, price);
          if (c === null) totalCost = null;
          else totalCost += c;
        }
      }
    }
    return { totalTokens, totalCost, running, waiting, total };
  });

  /** Tek pane için kompakt özet — title bar inline counter için.
   *  paneView'in subset'i ama daha hafif (full agent array dönmüyor).
   *  paneView ile aynı memoize stratejisi. */
  function buildPaneSummary(paneId: string) {
    return computed(() => {
      const p = panes.value.get(paneId);
      if (!p || p.byId.size === 0) {
        return { totalTokens: 0, totalCost: null as number | null, count: 0 };
      }
      const price = MODEL_PRICING[p.modelId];
      let totalTokens = 0;
      let totalCost: number | null = 0;
      for (const a of p.byId.values()) {
        totalTokens += a.inputTokens + a.outputTokens;
        if (totalCost !== null) {
          const c = agentEffectiveCost(a, price);
          if (c === null) totalCost = null;
          else totalCost += c;
        }
      }
      return { totalTokens, totalCost, count: p.byId.size };
    });
  }
  function paneSummary(paneId: string): PaneSummary {
    let c = paneSummaryCache.get(paneId);
    if (c) return c;
    c = buildPaneSummary(paneId);
    paneSummaryCache.set(paneId, c);
    return c;
  }

  return {
    dispatch,
    setVisible,
    toggleVisible,
    setModel,
    clearPane,
    paneView,
    paneSummary,
    globalSummary,
  };
});

function trimTo(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(s.length - max);
}

function mapEndStatus(s: 'ok' | 'error' | 'aborted'): AgentStatus {
  return s === 'ok' ? 'done' : s;
}

/** Tüm bilinen model id'leri — sidebar dropdown için. */
export function knownModelIds(): string[] {
  return Object.keys(MODEL_PRICING);
}

/** Settings ON ise kaynak pane'in yanında agent için yeni bir agentView pane
 *  açar. Pinia store-içi lazy import ile circular dep'ten kaçınır. */
async function autoSplitIfEnabled(sourcePaneId: string, agentId: string, agentName: string) {
  try {
    const [{ useSettingsStore }, { usePanesStore }] = await Promise.all([
      import('@/stores/settings'),
      import('@/stores/panes'),
    ]);
    const settings = useSettingsStore();
    if (!settings.state.autoSplitOnAgent) return;
    const panes = usePanesStore();
    panes.splitForAgent(sourcePaneId, agentId, agentName);
  } catch {
    /* sessiz — split başarısız olsa da sidebar yine çalışır */
  }
}
