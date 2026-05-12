// Settings store rollback regression — v0.9.6 `suppressConsoles` watch'unda
// `api.processSetSuppressConsoles` fail olursa state geri döner. v0.9.8'de
// bu race senaryosuna explicit test eklendi (audit agent #5 gap).

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';

vi.mock('@/api/tauri', () => ({
  api: {
    settingsAll: vi.fn().mockResolvedValue({}),
    settingsSet: vi.fn().mockResolvedValue(undefined),
    processSetSuppressConsoles: vi.fn(),
  },
}));

import { useSettingsStore } from '@/stores/settings';
import { api } from '@/api/tauri';

const flushPromises = () => new Promise((r) => setTimeout(r, 0));

describe('settings store — suppressConsoles ↔ ProcessJail sync', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Rollback senaryoları intentional `console.warn` çağırır ("rolling back: ...");
    // test output'unu temiz tutmak için suppress et. Assertion'lar mock'la yapılır.
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('backend invoke OK → state değişikliği kalıcı', async () => {
    const store = useSettingsStore();
    await store.load();
    (api.processSetSuppressConsoles as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    expect(store.state.suppressConsoles).toBe(true); // default
    store.state.suppressConsoles = false;
    await nextTick();
    await flushPromises();

    expect(api.processSetSuppressConsoles).toHaveBeenCalledWith(false);
    expect(store.state.suppressConsoles).toBe(false);
  });

  it('backend invoke FAIL → state otomatik rollback (DB/jail tutarsızlığı yok)', async () => {
    const store = useSettingsStore();
    await store.load();
    (api.processSetSuppressConsoles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('processSetSuppressConsoles boom'),
    );

    expect(store.state.suppressConsoles).toBe(true); // default
    store.state.suppressConsoles = false;
    await nextTick();
    await flushPromises();
    await flushPromises(); // microtask chain: error → syncing flag → rollback

    expect(api.processSetSuppressConsoles).toHaveBeenCalledWith(false);
    expect(store.state.suppressConsoles, 'state geri true olmalı (rollback)').toBe(true);
  });

  it('rollback sonrası tekrar toggle çalışır (syncing flag temizleniyor)', async () => {
    const store = useSettingsStore();
    await store.load();

    // İlk deneme: fail → rollback
    (api.processSetSuppressConsoles as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('first fail'),
    );
    store.state.suppressConsoles = false;
    await nextTick();
    await flushPromises();
    await flushPromises();
    expect(store.state.suppressConsoles).toBe(true); // rolled back

    // İkinci deneme: bu sefer başarılı olsun
    (api.processSetSuppressConsoles as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    store.state.suppressConsoles = false;
    await nextTick();
    await flushPromises();

    expect(api.processSetSuppressConsoles).toHaveBeenLastCalledWith(false);
    expect(store.state.suppressConsoles, 'syncing temizlenmiş, ikinci toggle geçer').toBe(false);
  });
});
