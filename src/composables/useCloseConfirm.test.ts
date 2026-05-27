// useCloseConfirm — pane / tab kapatma onayı dispatch testi.
//
// Test stratejisi: confirmAsk (utils/dialog) mock, settings store gerçek
// (Pinia setActivePinia), tipik LeafNode + Tab fixture'ları üretip 4 dal
// (shift bypass, mode never, mode runningOnly idle, mode always running)
// dolaşılır. Mesaj formatlama da assert edilir — t() i18n key direkt key
// stringi olarak döner (createI18n test ortamına bağlanmadığından).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSettingsStore } from '@/stores/settings';
import type { LeafNode, Tab } from '@/types/pane';

// confirmAsk mock — istersek argümanlarını yakalayabiliriz; dönüş değerini
// her test set eder. Test'in saf composable davranışını ölçtüğüne emin olmak
// için modülü dinamik import etmiyoruz; düz mock ile devam.
const confirmAskMock = vi.fn();
vi.mock('@/utils/dialog', () => ({
  confirmAsk: (...args: unknown[]) => confirmAskMock(...args),
}));

// i18n minimal mock — `t('foo', params)` çağrısı `foo` + params JSON döner;
// test mesaj formatlamayı bizzat doğrular.
vi.mock('@/main', () => ({
  i18n: {
    global: {
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key}::${JSON.stringify(params)}` : key,
    },
  },
}));

function makeLeaf(overrides: Partial<LeafNode> = {}): LeafNode {
  return {
    kind: 'leaf',
    id: 'pane-1',
    type: 'powershell',
    title: 'PowerShell',
    status: 'idle',
    ...overrides,
  };
}

function makeTab(leaves: LeafNode[]): Tab {
  if (leaves.length === 0) {
    return { id: 't1', name: 'Tab 1', tree: { root: null, focusedId: null } };
  }
  if (leaves.length === 1) {
    return { id: 't1', name: 'Tab 1', tree: { root: leaves[0]!, focusedId: leaves[0]!.id } };
  }
  // İki leaf → minimal split tree
  return {
    id: 't1',
    name: 'Tab 1',
    tree: {
      root: {
        kind: 'split',
        id: 's1',
        direction: 'horizontal',
        ratio: 0.5,
        first: leaves[0]!,
        second: leaves[1]!,
      },
      focusedId: leaves[0]!.id,
    },
  };
}

describe('useCloseConfirm', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    confirmAskMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('confirmPaneClose', () => {
    it('Shift basılıysa confirmAsk hiç çağrılmaz ve true döner', async () => {
      const { confirmPaneClose } = await import('./useCloseConfirm');
      const leaf = makeLeaf({ status: 'running', ptyId: 'p1' });
      const event = new KeyboardEvent('keydown', { shiftKey: true });
      const result = await confirmPaneClose(leaf, event);
      expect(result).toBe(true);
      expect(confirmAskMock).not.toHaveBeenCalled();
    });

    it('mode=never → confirmAsk hiç çağrılmaz, true', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'never';
      const { confirmPaneClose } = await import('./useCloseConfirm');
      const leaf = makeLeaf({ status: 'running', ptyId: 'p1' });
      const result = await confirmPaneClose(leaf);
      expect(result).toBe(true);
      expect(confirmAskMock).not.toHaveBeenCalled();
    });

    it('mode=runningOnly + idle pane → confirmAsk çağrılmaz, true', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'runningOnly';
      const { confirmPaneClose } = await import('./useCloseConfirm');
      const leaf = makeLeaf({ status: 'idle' });
      const result = await confirmPaneClose(leaf);
      expect(result).toBe(true);
      expect(confirmAskMock).not.toHaveBeenCalled();
    });

    it('mode=runningOnly + running pane → confirmAsk çağrılır (running mesajı)', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'runningOnly';
      confirmAskMock.mockResolvedValueOnce(true);
      const { confirmPaneClose } = await import('./useCloseConfirm');
      const leaf = makeLeaf({ status: 'running', ptyId: 'p1', title: 'My Shell' });
      const result = await confirmPaneClose(leaf);
      expect(result).toBe(true);
      expect(confirmAskMock).toHaveBeenCalledTimes(1);
      const [msg, opts] = confirmAskMock.mock.calls[0]!;
      expect(msg).toContain('pane.closeRunningConfirm');
      expect(msg).toContain('My Shell');
      expect(opts).toEqual({ kind: 'warning' });
    });

    it('mode=always + idle pane → confirmAsk çağrılır (running olmayan mesaj)', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'always';
      confirmAskMock.mockResolvedValueOnce(true);
      const { confirmPaneClose } = await import('./useCloseConfirm');
      const leaf = makeLeaf({ status: 'idle' });
      const result = await confirmPaneClose(leaf);
      expect(result).toBe(true);
      const [msg] = confirmAskMock.mock.calls[0]!;
      expect(msg).toBe('pane.closeConfirm');
    });

    it('confirmAsk false dönerse kapatma reddedilir', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'always';
      confirmAskMock.mockResolvedValueOnce(false);
      const { confirmPaneClose } = await import('./useCloseConfirm');
      const leaf = makeLeaf({ status: 'idle' });
      const result = await confirmPaneClose(leaf);
      expect(result).toBe(false);
    });
  });

  describe('confirmTabClose', () => {
    it('Shift basılıysa true ve confirmAsk yok', async () => {
      const { confirmTabClose } = await import('./useCloseConfirm');
      const tab = makeTab([makeLeaf({ status: 'running', ptyId: 'p1' })]);
      const event = new MouseEvent('click', { shiftKey: true });
      const result = await confirmTabClose(tab, event);
      expect(result).toBe(true);
      expect(confirmAskMock).not.toHaveBeenCalled();
    });

    it('mode=never → true ve confirmAsk yok', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'never';
      const { confirmTabClose } = await import('./useCloseConfirm');
      const tab = makeTab([makeLeaf({ status: 'running', ptyId: 'p1' })]);
      const result = await confirmTabClose(tab);
      expect(result).toBe(true);
      expect(confirmAskMock).not.toHaveBeenCalled();
    });

    it('mode=runningOnly + tab\'da hiç running pane yok → confirmAsk yok, true', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'runningOnly';
      const { confirmTabClose } = await import('./useCloseConfirm');
      const tab = makeTab([
        makeLeaf({ id: 'l1', status: 'idle' }),
        makeLeaf({ id: 'l2', status: 'exited' }),
      ]);
      const result = await confirmTabClose(tab);
      expect(result).toBe(true);
      expect(confirmAskMock).not.toHaveBeenCalled();
    });

    it('mode=runningOnly + 2 running pane → mesajda count=2 olur', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'runningOnly';
      confirmAskMock.mockResolvedValueOnce(true);
      const { confirmTabClose } = await import('./useCloseConfirm');
      const tab = makeTab([
        makeLeaf({ id: 'l1', status: 'running', ptyId: 'p1' }),
        makeLeaf({ id: 'l2', status: 'running', ptyId: 'p2' }),
      ]);
      tab.name = 'WorkTab';
      const result = await confirmTabClose(tab);
      expect(result).toBe(true);
      const [msg] = confirmAskMock.mock.calls[0]!;
      expect(msg).toContain('tab.closeRunningConfirm');
      expect(msg).toContain('WorkTab');
      expect(msg).toContain('"count":2');
    });

    it('mode=always + 0 running → sade close mesajı', async () => {
      const settings = useSettingsStore();
      settings.state.confirmOnClose = 'always';
      confirmAskMock.mockResolvedValueOnce(true);
      const { confirmTabClose } = await import('./useCloseConfirm');
      const tab = makeTab([makeLeaf({ status: 'idle' })]);
      tab.name = 'IdleTab';
      const result = await confirmTabClose(tab);
      expect(result).toBe(true);
      const [msg] = confirmAskMock.mock.calls[0]!;
      expect(msg).toContain('tab.closeConfirm');
      expect(msg).toContain('IdleTab');
    });
  });
});
