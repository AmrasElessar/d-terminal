// triggers store — regex match + cooldown + action dispatch.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const settingsGetMock = vi.fn();
const settingsSetMock = vi.fn();
const ptyWriteMock = vi.fn(() => Promise.resolve());
vi.mock('@/api/tauri', () => ({
  api: {
    settingsGet: (k: string) => settingsGetMock(k),
    settingsSet: (k: string, v: string) => settingsSetMock(k, v),
    ptyWrite: (...a: unknown[]) => ptyWriteMock(...(a as [])),
  },
}));

const toastsMock = { push: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() };
vi.mock('@/stores/toasts', () => ({ useToastsStore: () => toastsMock }));

vi.mock('@/stores/snippets', () => ({
  useSnippetsStore: () => ({
    items: [{ id: 1, name: 'snip', command: 'echo', shortcut: null }],
    run: vi.fn(),
  }),
}));

vi.mock('@/stores/panes', () => ({
  usePanesStore: () => ({
    getLeaf: vi.fn(() => ({ id: 'p1', ptyId: 'pty-1' })),
  }),
}));

vi.mock('@/i18n', () => ({
  i18n: { global: { t: (k: string) => k } },
}));

import { useTriggersStore } from './triggers';
import type { Trigger, TriggerScope } from '@/types/trigger';

function makeTrigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 't1',
    name: 'My Trigger',
    pattern: 'error',
    flags: 'i',
    scope: 'all' as TriggerScope,
    action: { kind: 'toast', payload: 'matched!' },
    enabled: true,
    cooldownMs: 1000,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('useTriggersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    settingsGetMock.mockReset();
    settingsSetMock.mockReset();
    toastsMock.push.mockReset();
  });

  it('Başlangıçta triggers boş', () => {
    const s = useTriggersStore();
    expect(s.triggers).toEqual([]);
  });

  it('load() boş settings → triggers []', async () => {
    settingsGetMock.mockResolvedValueOnce(null);
    const s = useTriggersStore();
    await s.load();
    expect(s.triggers).toEqual([]);
  });

  it('load() var olan trigger\'ları parse eder', async () => {
    settingsGetMock.mockResolvedValueOnce(JSON.stringify([makeTrigger()]));
    const s = useTriggersStore();
    await s.load();
    expect(s.triggers).toHaveLength(1);
    expect(s.triggers[0]?.name).toBe('My Trigger');
  });

  it('add() yeni trigger id + createdAt atar', () => {
    const s = useTriggersStore();
    const t = s.add({
      name: 'X',
      pattern: 'foo',
      flags: '',
      scope: 'all',
      action: { kind: 'toast', payload: 'm' },
      enabled: true,
      cooldownMs: 0,
    });
    expect(t.id).toBeTruthy();
    expect(t.createdAt).toBeTruthy();
    expect(s.triggers).toHaveLength(1);
  });

  it('remove(id) trigger çıkarır', () => {
    const s = useTriggersStore();
    const t = s.add({
      name: 'X',
      pattern: 'p',
      flags: '',
      scope: 'all',
      action: { kind: 'toast', payload: 'm' },
      enabled: true,
      cooldownMs: 0,
    });
    s.remove(t.id);
    expect(s.triggers).toEqual([]);
  });

  it('update(id, patch) trigger değiştirir', () => {
    const s = useTriggersStore();
    const t = s.add({
      name: 'X',
      pattern: 'p',
      flags: '',
      scope: 'all',
      action: { kind: 'toast', payload: 'm' },
      enabled: true,
      cooldownMs: 0,
    });
    s.update(t.id, { enabled: false, name: 'Renamed' });
    expect(s.triggers[0]?.enabled).toBe(false);
    expect(s.triggers[0]?.name).toBe('Renamed');
  });

  it('toggle(id) enabled flag çevirir', () => {
    const s = useTriggersStore();
    const t = s.add({
      name: 'X',
      pattern: 'p',
      flags: '',
      scope: 'all',
      action: { kind: 'toast', payload: 'm' },
      enabled: true,
      cooldownMs: 0,
    });
    s.toggle(t.id);
    expect(s.triggers[0]?.enabled).toBe(false);
    s.toggle(t.id);
    expect(s.triggers[0]?.enabled).toBe(true);
  });

  it('applicable(scope) yalniz enabled + scope eslesen trigger doner', () => {
    const s = useTriggersStore();
    s.triggers.push(
      makeTrigger({ id: 't-all', scope: 'all', enabled: true }),
      makeTrigger({ id: 't-disabled', scope: 'all', enabled: false }),
      makeTrigger({ id: 't-ps', scope: 'powershell', enabled: true }),
      makeTrigger({ id: 't-cmd', scope: 'cmd', enabled: true }),
    );
    const apps = s.applicable('powershell');
    const ids = apps.map((t) => t.id);
    expect(ids).toContain('t-all');
    expect(ids).not.toContain('t-disabled');
    expect(ids).toContain('t-ps');
    expect(ids).not.toContain('t-cmd');
  });

  it('applicable() scope eslestiginde scope-specific trigger dahil', () => {
    const s = useTriggersStore();
    s.triggers.push(makeTrigger({ id: 't-ps', scope: 'powershell', enabled: true }));
    const apps = s.applicable('powershell');
    expect(apps.some((t) => t.id === 't-ps')).toBe(true);
  });
});

describe('triggers — güvenlik', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    ptyWriteMock.mockClear();
    toastsMock.warning.mockClear();
    toastsMock.error.mockClear();
  });

  it('load() şemaya uymayan / bilinmeyen aksiyonlu kayıtları atar', async () => {
    settingsGetMock.mockResolvedValueOnce(
      JSON.stringify([makeTrigger(), { id: 'x', name: 'bad', pattern: 'a', action: { kind: 'rm' } }, 42]),
    );
    const s = useTriggersStore();
    await s.load();
    expect(s.triggers.map((t) => t.id)).toEqual(['t1']);
  });

  it('runSnippet açık izin olmadan komut çalıştırmaz', () => {
    const s = useTriggersStore();
    s.triggers.push(makeTrigger({ action: { kind: 'runSnippet', payload: '1' }, cooldownMs: 0 }));
    s.matchLine('error here', 'p1', 'powershell');
    expect(ptyWriteMock).not.toHaveBeenCalled();
    expect(toastsMock.warning).toHaveBeenCalled();
  });

  it('runSnippet izinliyken çalışır; asgari cooldown döngüyü keser', () => {
    const s = useTriggersStore();
    s.triggers.push(
      makeTrigger({ action: { kind: 'runSnippet', payload: '1' }, cooldownMs: 0, allowAutoRun: true }),
    );
    s.matchLine('error 1', 'p1', 'powershell');
    s.matchLine('error 2', 'p1', 'powershell');
    s.matchLine('error 3', 'p1', 'powershell');
    expect(ptyWriteMock).toHaveBeenCalledTimes(1);
  });
});
