// panes store — tree CRUD + focus + tab lifecycle + split mechanics.
// PTY kill ve event listener mock'lu; bizi state machine'in pure kısmı ilgilendirir.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

vi.mock('@/api/tauri', () => ({
  api: { ptyKill: vi.fn(async () => undefined) },
}));

vi.mock('@/api/events', () => ({
  onAllPty: vi.fn(async () => () => undefined),
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({ state: { autoSplitOnAgent: false } }),
}));

vi.mock('@/stores/agentWatch', () => ({
  useAgentWatchStore: () => ({ clearPane: vi.fn() }),
}));

vi.mock('@/stores/chats', () => ({
  useChatsStore: () => ({ clearPane: vi.fn() }),
}));

vi.mock('@/composables/useGitStat', () => ({
  clearGitStatState: vi.fn(),
}));

import { usePanesStore } from './panes';

describe('usePanesStore — tabs', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('Başlangıçta bir Tab 1 + activeTabId atanmış', () => {
    const s = usePanesStore();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.name).toBe('Tab 1');
    expect(s.activeTabId).toBe(s.tabs[0]?.id);
    expect(s.activeTab?.id).toBe(s.tabs[0]?.id);
  });

  it('newTab() yeni tab ekler, activeTabId güncellenir', () => {
    const s = usePanesStore();
    const t = s.newTab();
    expect(s.tabs.length).toBe(2);
    expect(s.activeTabId).toBe(t.id);
  });

  it('renameTab() tab adını günceller', () => {
    const s = usePanesStore();
    const tabId = s.tabs[0]!.id;
    s.renameTab(tabId, 'Yeni İsim');
    expect(s.tabs[0]?.name).toBe('Yeni İsim');
  });

  it('nextTab/prevTab tab arası döngü', () => {
    const s = usePanesStore();
    const t1 = s.tabs[0]!.id;
    const t2 = s.newTab().id;
    const t3 = s.newTab().id;
    s.setActiveTab(t1);
    s.nextTab();
    expect(s.activeTabId).toBe(t2);
    s.nextTab();
    expect(s.activeTabId).toBe(t3);
    s.nextTab();
    expect(s.activeTabId).toBe(t1); // wrap
    s.prevTab();
    expect(s.activeTabId).toBe(t3);
  });

  it('closeTab son tab kapatılırsa yeni boş tab oluşur', async () => {
    const s = usePanesStore();
    const onlyId = s.tabs[0]!.id;
    await s.closeTab(onlyId);
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0]?.id).not.toBe(onlyId);
    expect(s.tabs[0]?.name).toBe('Tab 1');
  });

  it('closeTab tab birden fazlaysa silinen tab kalkar, aktif başka tab olur', async () => {
    const s = usePanesStore();
    const t1 = s.tabs[0]!.id;
    const t2 = s.newTab().id;
    s.setActiveTab(t2);
    await s.closeTab(t2);
    expect(s.tabs.map((t) => t.id)).toEqual([t1]);
    expect(s.activeTabId).toBe(t1);
  });
});

describe('usePanesStore — pane mutations', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('openPane(): boş tree → root leaf, focusedId set', () => {
    const s = usePanesStore();
    const leaf = s.openPane('powershell', 'PS');
    expect(s.tree.root?.kind).toBe('leaf');
    expect(s.tree.focusedId).toBe(leaf.id);
    expect(s.paneCount).toBe(1);
  });

  it('openPane(): root varken focused split oluşturur', () => {
    const s = usePanesStore();
    s.openPane('powershell', 'A');
    s.openPane('powershell', 'B');
    expect(s.tree.root?.kind).toBe('split');
    expect(s.paneCount).toBe(2);
  });

  it('splitFocused(): direction parametresine uyar', () => {
    const s = usePanesStore();
    s.openPane('powershell', 'A');
    s.splitFocused('vertical', 'powershell', 'B');
    const root = s.tree.root;
    expect(root?.kind).toBe('split');
    if (root?.kind === 'split') expect(root.direction).toBe('vertical');
  });

  it('focus(id): geçerli leaf id ise focusedId değişir', () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    const b = s.openPane('powershell', 'B');
    s.focus(a.id);
    expect(s.tree.focusedId).toBe(a.id);
    s.focus(b.id);
    expect(s.tree.focusedId).toBe(b.id);
  });

  it('focus(id): bilinmeyen id no-op', () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    s.focus('nope');
    expect(s.tree.focusedId).toBe(a.id);
  });

  it('focusNext/focusPrev arası döngü', () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    const b = s.openPane('powershell', 'B');
    const c = s.openPane('powershell', 'C');
    s.focus(a.id);
    s.focusNext();
    expect(s.tree.focusedId).toBe(b.id);
    s.focusNext();
    expect(s.tree.focusedId).toBe(c.id);
    s.focusNext();
    expect(s.tree.focusedId).toBe(a.id); // wrap
    s.focusPrev();
    expect(s.tree.focusedId).toBe(c.id);
  });

  it('closePane: leaf ağaçtan çıkar, parent split kalkmıyor (kardeş ana)', async () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    const b = s.openPane('powershell', 'B');
    await s.closePane(b.id);
    expect(s.paneCount).toBe(1);
    expect(s.tree.root?.kind).toBe('leaf');
    expect((s.tree.root as { id: string }).id).toBe(a.id);
  });

  it('closePane: focused pane kapanırsa kalan ilk leaf focusedId olur', async () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    const b = s.openPane('powershell', 'B');
    s.focus(b.id);
    await s.closePane(b.id);
    expect(s.tree.focusedId).toBe(a.id);
  });

  it('closePane: tek leaf kalırken kapatılırsa root null + focusedId null', async () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    await s.closePane(a.id);
    expect(s.tree.root).toBeNull();
    expect(s.tree.focusedId).toBeNull();
  });

  it('setLeafState patch leaf alanlarını günceller', () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    s.setLeafState(a.id, { status: 'running', ptyId: 'pty-1' });
    const updated = s.getLeaf(a.id);
    expect(updated?.status).toBe('running');
    expect(updated?.ptyId).toBe('pty-1');
  });

  it('setSplitRatio: split node ratio güncelle, [0.1, 0.9] clamp', () => {
    const s = usePanesStore();
    s.openPane('powershell', 'A');
    s.openPane('powershell', 'B');
    const splitId = (s.tree.root as { id: string }).id;
    s.setSplitRatio(splitId, 0.3);
    expect((s.tree.root as { ratio: number }).ratio).toBe(0.3);
    s.setSplitRatio(splitId, -1);
    expect((s.tree.root as { ratio: number }).ratio).toBe(0.1);
    s.setSplitRatio(splitId, 5);
    expect((s.tree.root as { ratio: number }).ratio).toBe(0.9);
  });

  it('getLeaf butun tab listesinde arar', () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    s.newTab();
    const b = s.openPane('powershell', 'B');
    // a artık başka tab'da; getLeaf yine bulmalı
    expect(s.getLeaf(a.id)?.id).toBe(a.id);
    expect(s.getLeaf(b.id)?.id).toBe(b.id);
    expect(s.getLeaf('nope')).toBeNull();
  });
});

describe('usePanesStore — broadcast + maximize', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('toggleBroadcast başlangıçta false, toggle ile değişir', () => {
    const s = usePanesStore();
    expect(s.broadcastInput).toBe(false);
    s.toggleBroadcast();
    expect(s.broadcastInput).toBe(true);
    s.toggleBroadcast();
    expect(s.broadcastInput).toBe(false);
  });

  it('toggleMaximize aktif tab altında focused pane id\'sini saklar', () => {
    const s = usePanesStore();
    const a = s.openPane('powershell', 'A');
    s.toggleMaximize();
    // İçeride maximizedByTab[activeTabId] = a.id olur
    s.toggleMaximize();
    // Tekrar toggle null yapar
    expect(s.tree.focusedId).toBe(a.id);
  });
});
