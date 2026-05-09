// Pane tree store — tab'lar üzerinde organize.
// Her tab bağımsız bir PaneTree'ye sahip; mevcut split sistemi tab içinde
// aynen çalışır. Sidecar event'leri tüm tab'lardaki leaf'lerde aranır.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { v4 as uuid } from 'uuid';
import { api } from '@/api/tauri';
import { onAllPty } from '@/api/events';
import {
  type LeafNode,
  type PaneNode,
  type PaneTree,
  type PaneType,
  type SplitDirection,
  type SplitNode,
  type Tab,
  findLeaf,
  listLeaves,
  PANE_FONT_MIN,
  PANE_FONT_MAX,
} from '@/types/pane';
import { useSettingsStore } from '@/stores/settings';
import { useAgentWatchStore } from '@/stores/agentWatch';
import { useChatsStore } from '@/stores/chats';

function newLeaf(type: PaneType, title: string, profileId?: string): LeafNode {
  return {
    kind: 'leaf',
    id: uuid(),
    type,
    title,
    profileId,
    status: 'idle',
  };
}

function emptyTree(): PaneTree {
  return { root: null, focusedId: null };
}

function newTab(name: string): Tab {
  return { id: uuid(), name, tree: emptyTree() };
}

function replaceNode(
  root: PaneNode | null,
  targetId: string,
  replacer: (n: PaneNode) => PaneNode,
): PaneNode | null {
  if (!root) return null;
  if (root.id === targetId) return replacer(root);
  if (root.kind === 'split') {
    return {
      ...root,
      first: replaceNode(root.first, targetId, replacer)!,
      second: replaceNode(root.second, targetId, replacer)!,
    };
  }
  return root;
}

function removeLeaf(root: PaneNode | null, targetId: string): PaneNode | null {
  if (!root) return null;
  if (root.kind === 'leaf') return root.id === targetId ? null : root;
  const newFirst = removeLeaf(root.first, targetId);
  const newSecond = removeLeaf(root.second, targetId);
  if (!newFirst) return newSecond;
  if (!newSecond) return newFirst;
  return { ...root, first: newFirst, second: newSecond };
}

export const usePanesStore = defineStore('panes', () => {
  const tabs = ref<Tab[]>([newTab('Tab 1')]);
  const activeTabId = ref<string>(tabs.value[0]!.id);
  const sidecarAlive = ref(true);
  /** Broadcast input — true ise aktif tab içindeki TÜM terminal pane'lerine
   *  paralel stdin yazılır (tmux benzeri synchronize-panes). */
  const broadcastInput = ref(false);
  /** Zoom (tmux z, Warp ⌘⇧↵): aktif pane geçici tam ekran.
   *  Tab başına ayrı state; kapanan pane otomatik restore. */
  const maximizedByTab = ref<Record<string, string | null>>({});
  /** Drag halindeki pane id — drop indicator'ın kaynak pane'in üstünde
   *  görünmesini engellemek için. PaneTitleBar dragstart'ta set, dragend'de
   *  temizler. */
  const draggingPaneId = ref<string | null>(null);

  // --- queries ---

  const activeTab = computed<Tab | null>(
    () => tabs.value.find((t) => t.id === activeTabId.value) ?? null,
  );
  const tree = computed<PaneTree>(() => activeTab.value?.tree ?? emptyTree());
  const focused = computed<LeafNode | null>(() => {
    const t = activeTab.value;
    if (!t || !t.tree.focusedId) return null;
    return findLeaf(t.tree.root, t.tree.focusedId);
  });
  const allLeaves = computed<LeafNode[]>(() => listLeaves(tree.value.root));
  const paneCount = computed(() => allLeaves.value.length);
  const totalPaneCount = computed(() =>
    tabs.value.reduce((sum, t) => sum + listLeaves(t.tree.root).length, 0),
  );

  function getLeaf(id: string): LeafNode | null {
    // Tüm tab'larda ara — context menu/event'ler için
    for (const t of tabs.value) {
      const found = findLeaf(t.tree.root, id);
      if (found) return found;
    }
    return null;
  }

  function findTabOfLeaf(leafId: string): Tab | null {
    return tabs.value.find((t) => findLeaf(t.tree.root, leafId) !== null) ?? null;
  }

  // --- tab mutations ---

  function newTabAction(name?: string): Tab {
    const tab = newTab(name ?? `Tab ${tabs.value.length + 1}`);
    tabs.value.push(tab);
    activeTabId.value = tab.id;
    return tab;
  }

  function setActiveTab(id: string) {
    if (tabs.value.some((t) => t.id === id)) activeTabId.value = id;
  }

  function nextTab() {
    const idx = tabs.value.findIndex((t) => t.id === activeTabId.value);
    const next = tabs.value[(idx + 1) % tabs.value.length];
    if (next) activeTabId.value = next.id;
  }

  function prevTab() {
    const idx = tabs.value.findIndex((t) => t.id === activeTabId.value);
    const prev = tabs.value[(idx - 1 + tabs.value.length) % tabs.value.length];
    if (prev) activeTabId.value = prev.id;
  }

  /** Bir pane id'si için per-pane lifecycle state'i temizler:
   *  - paneBufferCache (xterm serialize snapshot) — ~1.5 MB/pane leak önler
   *  - agentWatch state — agent geçmişi RAM'de yaşamasın
   *  Bu yardımcı closeTab + loadWorkspace + closePane'in ortak cleanup'ını
   *  tek yerden uygular. */
  function cleanupPaneState(leafId: string) {
    // xterm serialize snapshot cache (~1.5 MB/pane) — leak önle
    const cache = (globalThis as unknown as { __dtermPaneBuffer?: Map<string, string> })
      .__dtermPaneBuffer;
    cache?.delete(leafId);
    // agent watch state (PaneAgents map'inde tutulan agent geçmişi)
    try {
      useAgentWatchStore().clearPane(leafId);
    } catch {
      /* store henüz initialize değil olabilir; sessiz geç */
    }
    // AI chat geçmişi (per-pane mesaj listesi)
    try {
      useChatsStore().clearPane(leafId);
    } catch {
      /* a.g. */
    }
  }

  async function closeTab(id: string) {
    const idx = tabs.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tab = tabs.value[idx]!;
    // Tab'daki tüm pane'lerin PTY'sini kill et + state'lerini temizle
    for (const leaf of listLeaves(tab.tree.root)) {
      if (leaf.ptyId) {
        try {
          await api.ptyKill(leaf.ptyId);
        } catch {
          /* zaten ölmüş olabilir */
        }
      }
      cleanupPaneState(leaf.id);
    }
    tabs.value.splice(idx, 1);
    if (tabs.value.length === 0) {
      // Son tab kapanırsa yeni boş tab aç (uygulama tab'sız kalmasın)
      const fresh = newTab('Tab 1');
      tabs.value.push(fresh);
      activeTabId.value = fresh.id;
    } else if (activeTabId.value === id) {
      const next = tabs.value[idx] ?? tabs.value[idx - 1] ?? tabs.value[0]!;
      activeTabId.value = next.id;
    }
  }

  function renameTab(id: string, name: string) {
    const tab = tabs.value.find((t) => t.id === id);
    if (tab) tab.name = name;
  }

  // --- pane mutations (active tab'a yönlendirilir) ---

  function withActiveTree(mut: (t: PaneTree) => void) {
    const tab = activeTab.value;
    if (!tab) return;
    mut(tab.tree);
  }

  function focus(id: string) {
    withActiveTree((t) => {
      if (findLeaf(t.root, id)) t.focusedId = id;
    });
  }

  function focusNext() {
    const leaves = allLeaves.value;
    if (leaves.length === 0) return;
    withActiveTree((t) => {
      const idx = leaves.findIndex((l) => l.id === t.focusedId);
      const next = leaves[(idx + 1) % leaves.length];
      if (next) t.focusedId = next.id;
    });
  }

  function focusPrev() {
    const leaves = allLeaves.value;
    if (leaves.length === 0) return;
    withActiveTree((t) => {
      const idx = leaves.findIndex((l) => l.id === t.focusedId);
      const prev = leaves[(idx - 1 + leaves.length) % leaves.length];
      if (prev) t.focusedId = prev.id;
    });
  }

  function openPane(type: PaneType, title: string, profileId?: string): LeafNode {
    const leaf = newLeaf(type, title, profileId);
    withActiveTree((t) => {
      if (!t.root) {
        t.root = leaf;
      } else if (t.focusedId) {
        t.root = replaceNode(t.root, t.focusedId, (focused) => ({
          kind: 'split',
          id: uuid(),
          direction: 'horizontal',
          ratio: 0.5,
          first: focused,
          second: leaf,
        }));
      } else {
        t.root = {
          kind: 'split',
          id: uuid(),
          direction: 'horizontal',
          ratio: 0.5,
          first: t.root,
          second: leaf,
        } satisfies SplitNode;
      }
      t.focusedId = leaf.id;
    });
    return leaf;
  }

  function splitFocused(direction: SplitDirection, type: PaneType, title: string, profileId?: string) {
    const tab = activeTab.value;
    if (!tab) return;
    const focusedId = tab.tree.focusedId;
    if (!focusedId) {
      openPane(type, title, profileId);
      return;
    }
    const leaf = newLeaf(type, title, profileId);
    tab.tree.root = replaceNode(tab.tree.root, focusedId, (focused) => ({
      kind: 'split',
      id: uuid(),
      direction,
      ratio: 0.5,
      first: focused,
      second: leaf,
    }));
    tab.tree.focusedId = leaf.id;
  }

  /** Agent başlangıcında otomatik split — kaynak pane'in yanında bir
   *  agentView leaf'i açar. Direction: yatay (sağ tarafa kayar).
   *  Bu pane PTY almaz, agentWatch store'unda ilgili agent'ın output'unu
   *  canlı render eder. Aynı agentId için zaten pane varsa noop. */
  function splitForAgent(sourcePaneId: string, agentId: string, agentName: string): string | null {
    // Aynı agent için zaten açık pane varsa tekrar açma
    for (const tab of tabs.value) {
      const exists = listLeaves(tab.tree.root).find(
        (l) => l.type === 'agentView' && l.agentId === agentId,
      );
      if (exists) return exists.id;
    }
    // Kaynak pane'in olduğu tab'ı bul
    const tab = tabs.value.find((tb) => !!findLeaf(tb.tree.root, sourcePaneId));
    if (!tab) return null;
    const leaf: LeafNode = {
      ...newLeaf('agentView', agentName),
      agentSourcePaneId: sourcePaneId,
      agentId,
      status: 'running',
    };
    tab.tree.root = replaceNode(tab.tree.root, sourcePaneId, (focused) => ({
      kind: 'split',
      id: uuid(),
      direction: 'horizontal',
      ratio: 0.6,
      first: focused,
      second: leaf,
    }));
    // Odak kaynak pane'de kalsın — agent panel sadece izleme için
    return leaf.id;
  }

  async function closePane(id: string) {
    const tab = findTabOfLeaf(id);
    if (!tab) return;
    const leaf = findLeaf(tab.tree.root, id);
    if (leaf?.ptyId) {
      try {
        await api.ptyKill(leaf.ptyId);
      } catch {
        /* zaten ölmüş olabilir */
      }
    }
    tab.tree.root = removeLeaf(tab.tree.root, id);
    if (tab.tree.focusedId === id) {
      const remaining = listLeaves(tab.tree.root);
      tab.tree.focusedId = remaining[0]?.id ?? null;
    }
    // Maximize edilmiş pane kapandıysa zoom modunu çöz
    if (maximizedByTab.value[tab.id] === id) {
      maximizedByTab.value = { ...maximizedByTab.value, [tab.id]: null };
    }
    // Per-pane lifecycle state'lerini temizle (xterm cache + agent + chat)
    cleanupPaneState(id);
  }

  function setLeafState(id: string, patch: Partial<LeafNode>) {
    const tab = findTabOfLeaf(id);
    if (!tab) return;
    tab.tree.root = replaceNode(tab.tree.root, id, (n) => {
      if (n.kind !== 'leaf') return n;
      return { ...n, ...patch };
    });
  }

  function setSplitRatio(id: string, ratio: number) {
    // Hangi tab içindeki split — tüm tab'larda ara
    for (const tab of tabs.value) {
      tab.tree.root = replaceNode(tab.tree.root, id, (n) => {
        if (n.kind !== 'split') return n;
        return { ...n, ratio: Math.max(0.1, Math.min(0.9, ratio)) };
      });
    }
  }

  /** Drag-drop ile pane yeniden konumlandırma. `source` leaf'ı ağaçtan
   *  sökülür, `target` leaf'ın belirtilen kenarına yeni split olarak
   *  yerleştirilir. Aynı tab içinde çalışır (tab'lar arası taşıma v1+).
   *  Source ve target aynıysa, ya da source target'ın kendisi ise no-op. */
  /** Workspace yükleme — mevcut tabs'i tamamen değiştirir. PTY kill yapmaz
   *  (status: 'idle' leaf'ler ilk render'da spawn olur). */
  async function loadWorkspace(newTabs: Tab[], targetActiveTabId: string | null) {
    if (newTabs.length === 0) return;
    // Mevcut açık PTY'leri sessizce kill et + per-pane state'i temizle —
    // yeni workspace fresh başlar; eski leaf id'ler globalThis cache'inde
    // yaşamasın.
    for (const tab of tabs.value) {
      for (const leaf of listLeaves(tab.tree.root)) {
        if (leaf.ptyId) {
          try { await api.ptyKill(leaf.ptyId); } catch { /* zaten ölmüş */ }
        }
        cleanupPaneState(leaf.id);
      }
    }
    tabs.value = newTabs;
    activeTabId.value =
      targetActiveTabId && newTabs.some((t) => t.id === targetActiveTabId)
        ? targetActiveTabId
        : newTabs[0]!.id;
    maximizedByTab.value = {};
  }

  function movePane(sourceLeafId: string, targetLeafId: string, side: 'left' | 'right' | 'top' | 'bottom') {
    if (sourceLeafId === targetLeafId) return;
    const tab = findTabOfLeaf(sourceLeafId);
    if (!tab) return;
    const targetTab = findTabOfLeaf(targetLeafId);
    if (!targetTab || targetTab.id !== tab.id) return; // cross-tab move v1+
    const sourceLeaf = findLeaf(tab.tree.root, sourceLeafId);
    if (!sourceLeaf) return;

    const afterRemove = removeLeaf(tab.tree.root, sourceLeafId);
    if (!afterRemove) return; // tab boş kaldı (target da source'tan tek kardeş ise olmamalı)

    const direction: SplitDirection =
      side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
    const sourceFirst = side === 'left' || side === 'top';

    tab.tree.root = replaceNode(afterRemove, targetLeafId, (target) => ({
      kind: 'split',
      id: uuid(),
      direction,
      ratio: 0.5,
      first: sourceFirst ? sourceLeaf : target,
      second: sourceFirst ? target : sourceLeaf,
    }));
    tab.tree.focusedId = sourceLeafId;
    // Maximize aktif ise layout değişti — restore et
    if (maximizedByTab.value[tab.id]) {
      maximizedByTab.value = { ...maximizedByTab.value, [tab.id]: null };
    }
  }

  // --- backend events ---

  let unlisteners: Array<() => void> = [];

  async function startListening() {
    if (unlisteners.length > 0) return;
    const list = await onAllPty((evt) => {
      switch (evt.kind) {
        case 'sidecar_up':
          sidecarAlive.value = true;
          break;
        case 'sidecar_down':
          sidecarAlive.value = false;
          for (const tab of tabs.value) {
            for (const leaf of listLeaves(tab.tree.root)) {
              if (leaf.ptyId) {
                setLeafState(leaf.id, { status: 'error', errorMessage: evt.reason });
              }
            }
          }
          break;
        case 'exit': {
          for (const tab of tabs.value) {
            const target = listLeaves(tab.tree.root).find((l) => l.ptyId === evt.pane_id);
            if (target) {
              setLeafState(target.id, { status: 'exited', exitCode: evt.exit_code });
              break;
            }
          }
          break;
        }
        case 'error': {
          if (!evt.pane_id) return;
          for (const tab of tabs.value) {
            const target = listLeaves(tab.tree.root).find((l) => l.ptyId === evt.pane_id);
            if (target) {
              setLeafState(target.id, { status: 'error', errorMessage: evt.message });
              break;
            }
          }
          break;
        }
        // 'stdout' event'i terminal komponenti tarafından doğrudan listen edilir
      }
    });
    unlisteners = list;
  }

  function stopListening() {
    for (const fn of unlisteners) fn();
    unlisteners = [];
  }

  function toggleBroadcast() {
    broadcastInput.value = !broadcastInput.value;
    // Sessiz toggle yerine kullanıcıya görsel geribildirim — durumun
    // farkına varmadan komut göndermek istemiyoruz.
    void notifyBroadcastToggle(broadcastInput.value);
  }

  async function notifyBroadcastToggle(on: boolean) {
    try {
      const [{ useToastsStore }, { i18n }] = await Promise.all([
        import('@/stores/toasts'),
        import('@/main'),
      ]);
      const toasts = useToastsStore();
      const t = i18n.global.t.bind(i18n.global);
      if (on) {
        const targets = allLeaves.value.filter((l) => l.ptyId && l.status === 'running').length;
        toasts.warning(t('statusBar.broadcastEnabledToast', { count: targets }), 2500);
      } else {
        toasts.info(t('statusBar.broadcastDisabledToast'), 1800);
      }
    } catch {
      /* yutuldu — toast göstermek mümkün değilse de toggle çalışmalı */
    }
  }

  // --- maximize / zoom ---

  const maximizedId = computed<string | null>(
    () => maximizedByTab.value[activeTabId.value] ?? null,
  );
  const maximizedLeaf = computed<LeafNode | null>(() => {
    const id = maximizedId.value;
    if (!id) return null;
    return findLeaf(activeTab.value?.tree.root ?? null, id);
  });

  function toggleMaximize() {
    const tabId = activeTabId.value;
    const focusedId = activeTab.value?.tree.focusedId;
    const current = maximizedByTab.value[tabId] ?? null;
    if (current) {
      // restore
      maximizedByTab.value = { ...maximizedByTab.value, [tabId]: null };
      return;
    }
    if (!focusedId) return;
    // Yalnızca split varsa anlamlı (tek leaf zaten tam ekran)
    if (allLeaves.value.length <= 1) return;
    maximizedByTab.value = { ...maximizedByTab.value, [tabId]: focusedId };
  }

  function clearMaximize(tabId?: string) {
    const id = tabId ?? activeTabId.value;
    if (maximizedByTab.value[id]) {
      maximizedByTab.value = { ...maximizedByTab.value, [id]: null };
    }
  }

  // --- Pane font zoom ---
  // Effective fontSize = settings.fontSize + leaf.fontSizeOffset (clamp [8, 32]).
  // delta=+1 zoom in, delta=-1 zoom out, delta=0 sayılırsa yine clamp uygular.
  function adjustFontSize(leafId: string, delta: number) {
    const leaf = getLeaf(leafId);
    if (!leaf) return;
    const settings = useSettingsStore();
    const base = settings.state.fontSize;
    const currentOffset = leaf.fontSizeOffset ?? 0;
    const desired = base + currentOffset + delta;
    const clamped = Math.max(PANE_FONT_MIN, Math.min(PANE_FONT_MAX, desired));
    const newOffset = clamped - base;
    const tab = findTabOfLeaf(leafId);
    if (!tab) return;
    tab.tree.root = replaceNode(tab.tree.root, leafId, (n) =>
      n.kind === 'leaf' ? { ...n, fontSizeOffset: newOffset } : n,
    );
  }

  function resetFontSize(leafId: string) {
    const leaf = getLeaf(leafId);
    if (!leaf) return;
    const tab = findTabOfLeaf(leafId);
    if (!tab) return;
    tab.tree.root = replaceNode(tab.tree.root, leafId, (n) =>
      n.kind === 'leaf' ? { ...n, fontSizeOffset: 0 } : n,
    );
  }

  function adjustFocusedFontSize(delta: number) {
    const id = activeTab.value?.tree.focusedId;
    if (id) adjustFontSize(id, delta);
  }
  function resetFocusedFontSize() {
    const id = activeTab.value?.tree.focusedId;
    if (id) resetFontSize(id);
  }

  return {
    tabs,
    activeTabId,
    activeTab,
    tree,
    sidecarAlive,
    broadcastInput,
    toggleBroadcast,
    focused,
    allLeaves,
    paneCount,
    totalPaneCount,
    getLeaf,
    focus,
    focusNext,
    focusPrev,
    openPane,
    splitFocused,
    splitForAgent,
    closePane,
    setLeafState,
    setSplitRatio,
    movePane,
    loadWorkspace,
    draggingPaneId,
    startListening,
    stopListening,
    // tab actions
    newTab: newTabAction,
    setActiveTab,
    nextTab,
    prevTab,
    closeTab,
    renameTab,
    // maximize / zoom
    maximizedId,
    maximizedLeaf,
    toggleMaximize,
    clearMaximize,
    // pane font zoom
    adjustFontSize,
    resetFontSize,
    adjustFocusedFontSize,
    resetFocusedFontSize,
  };
});
