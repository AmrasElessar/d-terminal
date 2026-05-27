// AI store — provider status, key management, pending prompt queue.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const aiKeyMaskedMock = vi.fn();
const secretsStoreMock = vi.fn();
const secretsDeleteMock = vi.fn();
vi.mock('@/api/tauri', () => ({
  api: {
    aiKeyMasked: (id: string) => aiKeyMaskedMock(id),
    secretsStore: (scope: string, name: string, value: string) =>
      secretsStoreMock(scope, name, value),
    secretsDelete: (scope: string, name: string) => secretsDeleteMock(scope, name),
  },
}));

vi.mock('@/providers/registry', () => ({
  ALL_PROVIDER_IDS: ['anthropic', 'openai', 'gemini', 'ollama', 'lmstudio', 'custom'],
  getProvider: vi.fn(async (id: string) => ({ id, name: id })),
}));

// PROVIDER_CATEGORY mock — local/custom/cloud ayrımı
vi.mock('@/types/ai', () => ({
  PROVIDER_CATEGORY: {
    anthropic: 'cloud',
    openai: 'cloud',
    gemini: 'cloud',
    ollama: 'local',
    lmstudio: 'local',
    custom: 'custom',
  },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: () => ({
    state: { aiCustomEndpoint: '' },
  }),
}));

import { useAIStore } from './ai';

describe('useAIStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    aiKeyMaskedMock.mockReset();
    secretsStoreMock.mockReset();
    secretsDeleteMock.mockReset();
  });

  it('Başlangıçta tüm provider hasKey=false', () => {
    const s = useAIStore();
    expect(s.statuses.openai?.hasKey).toBe(false);
    expect(s.activeProvider).toBeNull();
  });

  it('isConfigured: tüm provider hasKey=false → false', () => {
    const s = useAIStore();
    expect(s.isConfigured).toBe(false);
  });

  it('refresh() local provider hasKey=true atar (key gerekmez)', async () => {
    aiKeyMaskedMock.mockResolvedValue(null);
    const s = useAIStore();
    await s.refresh();
    expect(s.statuses.ollama?.hasKey).toBe(true);
    expect(s.statuses.lmstudio?.hasKey).toBe(true);
  });

  it('refresh() cloud provider masked key varsa hasKey=true', async () => {
    aiKeyMaskedMock.mockImplementation(async (id: string) =>
      id === 'openai' ? 'sk-***1234' : null,
    );
    const s = useAIStore();
    await s.refresh();
    expect(s.statuses.openai?.hasKey).toBe(true);
    expect(s.statuses.openai?.maskedKey).toBe('sk-***1234');
    expect(s.statuses.anthropic?.hasKey).toBe(false);
  });

  it('refresh() activeProvider yoksa ilk hazır provider seçilir', async () => {
    aiKeyMaskedMock.mockImplementation(async (id: string) =>
      id === 'openai' ? 'sk-1' : null,
    );
    const s = useAIStore();
    await s.refresh();
    // ALL_PROVIDER_IDS sırası: anthropic, openai, gemini, ollama...
    // anthropic key yok, openai var → openai (cloud cat) seçilebilir
    // ama local provider ollama da hasKey=true. İlk hazır = anthropic değil → openai (anthropic key yok)
    // anthropic→openai (hasKey)→... veya ollama → her ikisi de hasKey
    // İlk = anthropic değil (false), openai (true) → openai seçilir
    expect(s.activeProvider).toBe('openai');
  });

  it('setKey() secretsStore çağırır + refresh tetikler', async () => {
    aiKeyMaskedMock.mockResolvedValue('sk-***xxxx');
    const s = useAIStore();
    await s.setKey('openai', 'sk-real-key');
    expect(secretsStoreMock).toHaveBeenCalledWith('ai_provider', 'openai', 'sk-real-key');
    expect(s.statuses.openai?.hasKey).toBe(true);
  });

  it('removeKey() secretsDelete çağırır + activeProvider eşitse temizler', async () => {
    aiKeyMaskedMock.mockResolvedValue(null);
    const s = useAIStore();
    s.activeProvider = 'openai';
    await s.removeKey('openai');
    expect(secretsDeleteMock).toHaveBeenCalledWith('ai_provider', 'openai');
    // openai null'a inmiş + refresh sonrası firstReady (local olabilir) yeniden seçer
    expect(s.activeProvider).not.toBe('openai');
  });

  it('setActiveProvider activeModel temizler', () => {
    const s = useAIStore();
    s.activeModel = 'gpt-4o';
    s.setActiveProvider('anthropic');
    expect(s.activeProvider).toBe('anthropic');
    expect(s.activeModel).toBeNull();
  });

  it('queuePrompt + consumePrompt round-trip; consume sonrası null', () => {
    const s = useAIStore();
    expect(s.consumePrompt()).toBeNull();
    s.queuePrompt('analiz et');
    expect(s.pendingPrompt).toBe('analiz et');
    expect(s.consumePrompt()).toBe('analiz et');
    expect(s.consumePrompt()).toBeNull();
  });

  it('resolveProvider activeProvider null ise null döner', async () => {
    const s = useAIStore();
    expect(await s.resolveProvider()).toBeNull();
  });

  it('resolveProvider activeProvider varsa registry\'den getProvider çağırır', async () => {
    const s = useAIStore();
    s.activeProvider = 'anthropic';
    const p = await s.resolveProvider();
    expect(p).not.toBeNull();
  });
});
