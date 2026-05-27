// profiles store — built-in + user CRUD + persistence.
// api.settingsGet/Set mock — gerçek SQLite invoke etmez.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const store: Record<string, string | null> = {};
vi.mock('@/api/tauri', () => ({
  api: {
    settingsGet: vi.fn(async (key: string) => store[key] ?? null),
    settingsSet: vi.fn(async (key: string, val: string) => {
      store[key] = val;
    }),
  },
}));

import { useProfilesStore } from './profiles';
import { BUILTIN_PROFILES } from '@/types/profile';

describe('useProfilesStore', () => {
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    setActivePinia(createPinia());
  });

  it('Başlangıçta user profile yok ama all built-in döner', () => {
    const s = useProfilesStore();
    expect(s.userProfiles).toEqual([]);
    expect(s.all.length).toBe(BUILTIN_PROFILES.length);
  });

  it('load() boş settings → loaded=true, userProfiles boş', async () => {
    const s = useProfilesStore();
    await s.load();
    expect(s.loaded).toBe(true);
    expect(s.userProfiles).toEqual([]);
  });

  it('load() var olan user profiles → restore', async () => {
    store['profiles.user'] = JSON.stringify([
      { id: 'u1', name: 'SSH', shell: 'ssh', args: ['host'], paneType: 'powershell', builtin: false },
    ]);
    const s = useProfilesStore();
    await s.load();
    expect(s.userProfiles).toHaveLength(1);
    expect(s.userProfiles[0]?.name).toBe('SSH');
  });

  it('load() builtin=true items reddedilir (sanitization)', async () => {
    store['profiles.user'] = JSON.stringify([
      { id: 'fake-builtin', name: 'Fake', shell: 'x', args: [], paneType: 'powershell', builtin: true },
      { id: 'real', name: 'Real', shell: 'y', args: [], paneType: 'powershell', builtin: false },
    ]);
    const s = useProfilesStore();
    await s.load();
    expect(s.userProfiles).toHaveLength(1);
    expect(s.userProfiles[0]?.id).toBe('real');
  });

  it('add() yeni user profile ekler, id atar, builtin=false', () => {
    const s = useProfilesStore();
    const created = s.add({
      name: 'My Pwsh',
      shell: 'pwsh',
      args: ['-NoLogo'],
      paneType: 'powershell',
      icon: '🖥',
    });
    expect(created.id).toBeTruthy();
    expect(created.builtin).toBe(false);
    expect(s.userProfiles).toContainEqual(created);
  });

  it('find() built-in + user profiles arasında arama yapar', () => {
    const s = useProfilesStore();
    const created = s.add({ name: 'X', shell: 'x', args: [], paneType: 'powershell', icon: '🖥' });
    expect(s.find(created.id)?.name).toBe('X');
    expect(s.find(BUILTIN_PROFILES[0]!.id)?.id).toBe(BUILTIN_PROFILES[0]!.id);
    expect(s.find('nonexistent')).toBeNull();
  });

  it('defaultFor() paneType bazında built-in profile döner', () => {
    const s = useProfilesStore();
    const def = s.defaultFor('powershell');
    expect(def).not.toBeNull();
    expect(def?.paneType).toBe('powershell');
  });

  it('update() user profile patch uygular', async () => {
    const s = useProfilesStore();
    await s.load(); // loaded=true → watch persist çalışır
    const created = s.add({ name: 'A', shell: 'sh', args: [], paneType: 'powershell', icon: '🖥' });
    s.update(created.id, { name: 'A2' });
    expect(s.find(created.id)?.name).toBe('A2');
  });

  it('update() built-in profile patch eder ETMEZ', async () => {
    const s = useProfilesStore();
    await s.load();
    const builtinId = BUILTIN_PROFILES[0]!.id;
    // Built-in update no-op (userProfiles içinde olmadığı için zaten)
    s.update(builtinId, { name: 'Hacked' });
    expect(s.find(builtinId)?.name).toBe(BUILTIN_PROFILES[0]!.name);
  });

  it('remove() user profile siler, built-in dokunulmaz', async () => {
    const s = useProfilesStore();
    await s.load();
    const created = s.add({ name: 'Del', shell: 'x', args: [], paneType: 'powershell', icon: '🖥' });
    s.remove(created.id);
    expect(s.find(created.id)).toBeNull();
  });

  it('duplicate() var olan profile yeni id ile kopyalar', async () => {
    const s = useProfilesStore();
    await s.load();
    const a = s.add({ name: 'Orig', shell: 'sh', args: ['-i'], paneType: 'powershell', icon: '🖥' });
    const copy = s.duplicate(a.id)!;
    expect(copy.id).not.toBe(a.id);
    expect(copy.name).toContain('copy');
    expect(copy.shell).toBe('sh');
    expect(copy.args).toEqual(['-i']);
  });

  it('duplicate() bilinmeyen id → null', () => {
    const s = useProfilesStore();
    expect(s.duplicate('nope')).toBeNull();
  });
});
