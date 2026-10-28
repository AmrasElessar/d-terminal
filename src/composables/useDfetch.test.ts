import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    dfetchGet: vi.fn(),
    dfetchLive: vi.fn(() => Promise.resolve({ cpu_percent: 1 })),
    settingsAll: vi.fn(() => Promise.resolve({})),
    settingsSet: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock('@/api/tauri', () => ({ api: apiMock }));

import { useDfetch } from './useDfetch';
import { useSettingsStore } from '@/stores/settings';

describe('useDfetch', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  it('scope dispose sonrası polling durur ve geç gelen sonuç yazılmaz', async () => {
    let resolveGet!: (v: unknown) => void;
    apiMock.dfetchGet.mockReturnValueOnce(new Promise((r) => (resolveGet = r)));
    const scope = effectScope();
    const d = scope.run(() => useDfetch())!;
    const p = d.refresh();
    d.startLivePolling();
    scope.stop();
    resolveGet({ os: 'x' });
    await p;
    expect(d.info.value).toBeNull();
    const calls = apiMock.dfetchLive.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apiMock.dfetchLive.mock.calls.length).toBe(calls);
  });

  it('aralık değişince yalnızca polling açıksa yeniden kurulur', async () => {
    const scope = effectScope();
    const d = scope.run(() => useDfetch())!;
    const settings = useSettingsStore();
    settings.state.dfetchPollIntervalMs = 1000;
    await nextTick();
    await vi.advanceTimersByTimeAsync(5000);
    expect(apiMock.dfetchLive).not.toHaveBeenCalled();
    d.startLivePolling();
    await vi.advanceTimersByTimeAsync(2100);
    expect(apiMock.dfetchLive.mock.calls.length).toBeGreaterThanOrEqual(2);
    scope.stop();
  });
});
