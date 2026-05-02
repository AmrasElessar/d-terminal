// AI provider yönetim store'u.
//
// Hangi provider'lar yapılandırılmış (key var), hangisi aktif, hangi modeller
// mevcut. Provider implementasyonları `@/providers/registry` üzerinden çözülür.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '@/api/tauri';
import type { ProviderId } from '@/types/ai';
import { getProvider, ALL_PROVIDER_IDS } from '@/providers/registry';

export interface ProviderStatus {
  id: ProviderId;
  hasKey: boolean;
  maskedKey: string | null;
}

export const useAIStore = defineStore('ai', () => {
  const statuses = ref<Record<ProviderId, ProviderStatus>>(
    Object.fromEntries(
      ALL_PROVIDER_IDS.map((id) => [id, { id, hasKey: false, maskedKey: null }]),
    ) as Record<ProviderId, ProviderStatus>,
  );
  const activeProvider = ref<ProviderId | null>(null);
  const activeModel = ref<string | null>(null);

  const isConfigured = computed(() =>
    Object.values(statuses.value).some((s) => s.hasKey || s.id === 'ollama'),
  );

  async function refresh() {
    for (const id of ALL_PROVIDER_IDS) {
      // Ollama key gerektirmez — local
      if (id === 'ollama') {
        statuses.value[id] = { id, hasKey: true, maskedKey: null };
        continue;
      }
      const masked = await api.aiKeyMasked(id);
      statuses.value[id] = { id, hasKey: masked !== null, maskedKey: masked };
    }
    if (!activeProvider.value) {
      const firstReady = ALL_PROVIDER_IDS.find((id) => statuses.value[id]?.hasKey);
      if (firstReady) activeProvider.value = firstReady;
    }
  }

  async function setKey(id: ProviderId, key: string) {
    await api.secretsStore('ai_provider', id, key);
    await refresh();
  }

  async function removeKey(id: ProviderId) {
    await api.secretsDelete('ai_provider', id);
    if (activeProvider.value === id) activeProvider.value = null;
    await refresh();
  }

  function setActiveProvider(id: ProviderId) {
    activeProvider.value = id;
    activeModel.value = null;
  }

  function setActiveModel(model: string) {
    activeModel.value = model;
  }

  async function resolveProvider() {
    if (!activeProvider.value) return null;
    return getProvider(activeProvider.value);
  }

  return {
    statuses,
    activeProvider,
    activeModel,
    isConfigured,
    refresh,
    setKey,
    removeKey,
    setActiveProvider,
    setActiveModel,
    resolveProvider,
  };
});
