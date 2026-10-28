// TerminalSession yaşam döngüsü — spawn sırasında pane kapatılırsa PTY
// öldürülmeli, listener sızmamalı; detach/attach çıktıyı kaybetmemeli.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

type Handler = (e: { payload: unknown }) => void;
const { handlers, apiMock } = vi.hoisted(() => {
  const handlers: Handler[] = [];
  const apiMock = {
    ptySpawn: vi.fn(),
    ptyKill: vi.fn(() => Promise.resolve()),
    ptyWrite: vi.fn(() => Promise.resolve()),
    ptyResize: vi.fn(() => Promise.resolve()),
    historySearch: vi.fn(() => Promise.resolve([])),
    historyAdd: vi.fn(() => Promise.resolve(1)),
    gitDiffShortstat: vi.fn(() => Promise.resolve({ files: 0, added: 0, removed: 0, is_repo: false })),
    settingsGet: vi.fn(() => Promise.resolve(null)),
    settingsSet: vi.fn(() => Promise.resolve()),
    settingsAll: vi.fn(() => Promise.resolve({})),
  };
  return { handlers, apiMock };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_t: string, h: Handler) => {
    handlers.push(h);
    return () => {
      const i = handlers.indexOf(h);
      if (i >= 0) handlers.splice(i, 1);
    };
  }),
}));
vi.mock('@/api/tauri', () => ({ api: apiMock }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      throw new Error('no webgl in jsdom');
    }
  },
}));
vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: class {
    constructor() {
      throw new Error('no canvas in jsdom');
    }
  },
}));

import { usePanesStore } from '@/stores/panes';
import { useProfilesStore } from '@/stores/profiles';
import { getOrCreateTerminalSession } from './session';
import { getTerminalSession } from './registry';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('TerminalSession', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    handlers.length = 0;
    vi.clearAllMocks();
    document.body.innerHTML = '';
    // jsdom ResizeObserver yok
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
    window.matchMedia ??= ((q: string) => ({
      matches: false,
      media: q,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
  });

  it('spawn sürerken pane kapatılırsa PTY öldürülür ve listener kalkar', async () => {
    const panes = usePanesStore();
    const profiles = useProfilesStore();
    expect(profiles.defaultFor('powershell')).toBeTruthy();
    const leaf = panes.openPane('powershell', 'PS');
    const d = deferred<string>();
    apiMock.ptySpawn.mockReturnValueOnce(d.promise);

    const s = getOrCreateTerminalSession(leaf.id);
    const el = document.createElement('div');
    document.body.appendChild(el);
    s.attach(el);
    await tick();
    expect(apiMock.ptySpawn).toHaveBeenCalledTimes(1);

    await panes.closePane(leaf.id);
    expect(getTerminalSession(leaf.id)).toBeNull();
    d.resolve('pty-1');
    await tick();
    expect(apiMock.ptyKill).toHaveBeenCalledWith('pty-1');
    expect(handlers.length).toBe(0);
  });

  it('detach sırasında gelen çıktı kaybolmaz; aynı session yeniden bağlanır', async () => {
    const panes = usePanesStore();
    const leaf = panes.openPane('powershell', 'PS');
    apiMock.ptySpawn.mockResolvedValueOnce('pty-2');
    const s = getOrCreateTerminalSession(leaf.id);
    const el = document.createElement('div');
    document.body.appendChild(el);
    s.attach(el);
    await tick();
    await tick();
    expect(panes.getLeaf(leaf.id)?.ptyId).toBe('pty-2');

    s.detach();
    expect(el.childElementCount).toBe(0);
    // Gizliyken çıktı — listener hâlâ kayıtlı olmalı
    expect(handlers.length).toBe(1);

    const el2 = document.createElement('div');
    document.body.appendChild(el2);
    expect(getOrCreateTerminalSession(leaf.id)).toBe(s);
    s.attach(el2);
    expect(el2.childElementCount).toBe(1);
    // Yeniden spawn yok
    expect(apiMock.ptySpawn).toHaveBeenCalledTimes(1);
    await panes.closePane(leaf.id);
  });
});
