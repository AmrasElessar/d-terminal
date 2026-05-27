// snippets store — CRUD + run + keybinding rebind.
// Tüm dependency'ler mock'lu (api, keybindings, panes, toasts).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const snippetListMock = vi.fn();
const snippetUpsertMock = vi.fn();
const snippetDeleteMock = vi.fn();
const ptyWriteMock = vi.fn();

vi.mock('@/api/tauri', () => ({
  api: {
    snippetList: () => snippetListMock(),
    snippetUpsert: (s: unknown) => snippetUpsertMock(s),
    snippetDelete: (id: number) => snippetDeleteMock(id),
    ptyWrite: (id: string, data: Uint8Array) => ptyWriteMock(id, data),
  },
}));

vi.mock('@/keybindings/registry', () => ({
  keybindings: {
    getAll: vi.fn(() => []),
    unregister: vi.fn(),
    register: vi.fn(),
    setCombo: vi.fn(() => null),
  },
}));

const focusedRef = { value: null as null | { id: string; ptyId?: string } };
vi.mock('@/stores/panes', () => ({
  usePanesStore: () => ({
    get focused() { return focusedRef.value; },
  }),
}));

const toastsMock = { warning: vi.fn(), error: vi.fn() };
vi.mock('@/stores/toasts', () => ({
  useToastsStore: () => toastsMock,
}));

import { useSnippetsStore } from './snippets';

describe('useSnippetsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    snippetListMock.mockReset();
    snippetUpsertMock.mockReset();
    snippetDeleteMock.mockReset();
    ptyWriteMock.mockReset();
    toastsMock.warning.mockReset();
    toastsMock.error.mockReset();
    focusedRef.value = null;
  });

  it('Başlangıçta items boş', () => {
    const s = useSnippetsStore();
    expect(s.items).toEqual([]);
  });

  it('load() api.snippetList sonucunu items setine alır', async () => {
    snippetListMock.mockResolvedValueOnce([
      { id: 1, name: 'git status', command: 'git status', shortcut: null },
      { id: 2, name: 'cd home', command: 'cd ~', shortcut: 'Ctrl+H' },
    ]);
    const s = useSnippetsStore();
    await s.load();
    expect(s.items).toHaveLength(2);
    expect(s.items[0]?.name).toBe('git status');
  });

  it('upsert() api çağırır + reload yapar', async () => {
    snippetListMock.mockResolvedValueOnce([]);
    snippetUpsertMock.mockResolvedValueOnce(1);
    const s = useSnippetsStore();
    await s.upsert({ name: 'new', command: 'echo' });
    expect(snippetUpsertMock).toHaveBeenCalledWith({ name: 'new', command: 'echo' });
    expect(snippetListMock).toHaveBeenCalled();
  });

  it('remove() api çağırır + reload yapar', async () => {
    snippetListMock.mockResolvedValueOnce([]);
    snippetDeleteMock.mockResolvedValueOnce(undefined);
    const s = useSnippetsStore();
    await s.remove(42);
    expect(snippetDeleteMock).toHaveBeenCalledWith(42);
    expect(snippetListMock).toHaveBeenCalled();
  });

  it('run() focused pane yoksa toast warning, ptyWrite yok', () => {
    const s = useSnippetsStore();
    focusedRef.value = null;
    s.run({ id: 1, name: 'x', command: 'echo', description: null, shortcut: null });
    expect(toastsMock.warning).toHaveBeenCalled();
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });

  it('run() focused pane var ama ptyId yok → toast, ptyWrite yok', () => {
    const s = useSnippetsStore();
    focusedRef.value = { id: 'p1' }; // ptyId yok
    s.run({ id: 1, name: 'x', command: 'ls', description: null, shortcut: null });
    expect(toastsMock.warning).toHaveBeenCalled();
    expect(ptyWriteMock).not.toHaveBeenCalled();
  });

  it('run() ptyId var → ptyWrite command + \\r ile çağrılır', () => {
    const s = useSnippetsStore();
    focusedRef.value = { id: 'p1', ptyId: 'pty-1' };
    ptyWriteMock.mockResolvedValueOnce(undefined);
    s.run({ id: 1, name: 'x', command: 'whoami', description: null, shortcut: null });
    expect(ptyWriteMock).toHaveBeenCalled();
    const [pty, data] = ptyWriteMock.mock.calls[0]!;
    expect(pty).toBe('pty-1');
    const decoded = new TextDecoder().decode(data as Uint8Array);
    expect(decoded).toBe('whoami\r');
  });
});
