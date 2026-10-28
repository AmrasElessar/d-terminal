// dfetch veri katmanı — Welcome pane'in sistem bilgisi + canlı stat polling'i.
// Animasyon (typewriter, Matrix rain) WelcomePane'de kalır; bu composable
// yalnızca veriyi ve polling yaşam döngüsünü yönetir.
//
// Unmount yarışları: `refresh()` / `pollLive()` await sırasında komponent
// unmount olursa sonuç yazılmaz ve polling yeniden kurulmaz. Uçuştaki bir
// `dfetch_live` (WMI) çağrısı bitmeden yenisi başlatılmaz.

import { getCurrentScope, onScopeDispose, ref, watch } from 'vue';
import { api } from '@/api/tauri';
import type { LiveStats, SystemInfo } from '@/types/events';
import { useSettingsStore } from '@/stores/settings';

/** 500ms altı hem CPU yer hem WMI battery latency'sini iter. */
const MIN_POLL_MS = 500;

export function useDfetch() {
  const settings = useSettingsStore();
  const info = ref<SystemInfo | null>(null);
  /** Canlı stats — CPU%, RAM (güncel), network throughput, battery. */
  const live = ref<LiveStats | null>(null);
  let timer: number | undefined;
  let polling = false;
  let inFlight = false;
  let disposed = false;

  async function refresh(): Promise<void> {
    const v = await api.dfetchGet();
    if (!disposed) info.value = v;
  }

  async function pollLive() {
    if (inFlight || disposed) return;
    inFlight = true;
    try {
      const v = await api.dfetchLive();
      if (!disposed) live.value = v;
    } catch {
      /* sessiz — bir tick atlayabiliriz */
    } finally {
      inFlight = false;
    }
  }

  function arm() {
    if (timer !== undefined || disposed) return;
    const interval = settings.state.dfetchPollIntervalMs;
    // 0 = polling kapalı (statik snapshot, batarya tasarrufu)
    if (interval <= 0) return;
    // İlk tick hemen — sysinfo Networks ilk refresh'te delta üretmez (baseline)
    void pollLive();
    timer = window.setInterval(pollLive, Math.max(MIN_POLL_MS, interval));
  }
  function disarm() {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  }

  function startLivePolling() {
    polling = true;
    arm();
  }
  function stopLivePolling() {
    polling = false;
    disarm();
  }

  // Settings'ten poll aralığı değişirse interval'ı yeniden kur (yalnızca
  // polling açıkken — unmount sonrası yeniden başlamasın).
  watch(
    () => settings.state.dfetchPollIntervalMs,
    () => {
      disarm();
      if (polling) arm();
    },
  );

  if (getCurrentScope()) {
    onScopeDispose(() => {
      disposed = true;
      stopLivePolling();
    });
  }

  return { info, live, refresh, startLivePolling, stopLivePolling };
}
