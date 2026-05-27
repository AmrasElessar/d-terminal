// agentWatch store — smoke test: dispatch + paneView + clear.
// paneView() reactive Ref<PaneView> döner — `.value.agents` üzerinden okunur.

import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useAgentWatchStore } from './agentWatch';

describe('useAgentWatchStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('Yeni pane: paneView agents boş + hasAny false', () => {
    const s = useAgentWatchStore();
    const view = s.paneView('p1').value;
    expect(view.agents).toEqual([]);
    expect(view.hasAny).toBe(false);
  });

  it('dispatch start → paneView agents bir eleman içerir', () => {
    const s = useAgentWatchStore();
    s.dispatch('p1', { k: 'start', id: 'a1', name: 'Agent 1' });
    const view = s.paneView('p1').value;
    expect(view.agents).toHaveLength(1);
    expect(view.agents[0]?.id).toBe('a1');
    expect(view.agents[0]?.status).toBe('running');
  });

  it('İki start LIFO sırayla: ikinci önce', () => {
    const s = useAgentWatchStore();
    s.dispatch('p1', { k: 'start', id: 'a1', name: 'A' });
    s.dispatch('p1', { k: 'start', id: 'a2', name: 'B' });
    const view = s.paneView('p1').value;
    expect(view.agents[0]?.id).toBe('a2');
    expect(view.agents[1]?.id).toBe('a1');
  });

  it('clearPane sonrası agents boş', () => {
    const s = useAgentWatchStore();
    s.dispatch('p1', { k: 'start', id: 'a1', name: 'A' });
    s.clearPane('p1');
    const view = s.paneView('p1').value;
    expect(view.agents).toEqual([]);
  });

  it('setModel modelId güncelle, default DEFAULT_MODEL', () => {
    const s = useAgentWatchStore();
    const before = s.paneView('p1').value.modelId;
    expect(before).toBeTruthy();
    s.setModel('p1', 'claude-opus-4-7');
    expect(s.paneView('p1').value.modelId).toBe('claude-opus-4-7');
  });

  it('toggleVisible visible flag çevirir', () => {
    const s = useAgentWatchStore();
    expect(s.paneView('p1').value.visible).toBe(false);
    s.toggleVisible('p1');
    expect(s.paneView('p1').value.visible).toBe(true);
    s.toggleVisible('p1');
    expect(s.paneView('p1').value.visible).toBe(false);
  });

  it('setVisible explicit boolean atar', () => {
    const s = useAgentWatchStore();
    s.setVisible('p1', true);
    expect(s.paneView('p1').value.visible).toBe(true);
    s.setVisible('p1', false);
    expect(s.paneView('p1').value.visible).toBe(false);
  });

  it('Farklı pane id\'leri bağımsız state tutar', () => {
    const s = useAgentWatchStore();
    s.dispatch('pA', { k: 'start', id: 'a1', name: 'X' });
    s.dispatch('pB', { k: 'start', id: 'b1', name: 'Y' });
    expect(s.paneView('pA').value.agents).toHaveLength(1);
    expect(s.paneView('pB').value.agents).toHaveLength(1);
    expect(s.paneView('pA').value.agents[0]?.id).toBe('a1');
    expect(s.paneView('pB').value.agents[0]?.id).toBe('b1');
  });
});
