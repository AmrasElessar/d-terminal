// providers/registry — lazy load + cache.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./anthropic', () => ({
  AnthropicProvider: class {
    id = 'anthropic';
    name = 'Anthropic';
  },
}));
vi.mock('./openai', () => ({
  OpenAIProvider: class {
    id = 'openai';
    name = 'OpenAI';
  },
}));

describe('getProvider', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('ALL_PROVIDER_IDS 9 elementlik dizi', async () => {
    const { ALL_PROVIDER_IDS } = await import('./registry');
    expect(ALL_PROVIDER_IDS).toContain('anthropic');
    expect(ALL_PROVIDER_IDS).toContain('openai');
    expect(ALL_PROVIDER_IDS).toContain('gemini');
    expect(ALL_PROVIDER_IDS).toContain('ollama');
    expect(ALL_PROVIDER_IDS).toContain('custom');
    expect(ALL_PROVIDER_IDS.length).toBeGreaterThanOrEqual(9);
  });

  it('getProvider(anthropic) → instance döner', async () => {
    const { getProvider } = await import('./registry');
    const p = await getProvider('anthropic');
    expect(p).not.toBeNull();
    expect(p?.id).toBe('anthropic');
  });

  it('getProvider cache: ikinci çağrı aynı instance döner', async () => {
    const { getProvider } = await import('./registry');
    const a = await getProvider('anthropic');
    const b = await getProvider('anthropic');
    expect(a).toBe(b);
  });

  it('getProvider bilinmeyen id → null', async () => {
    const { getProvider } = await import('./registry');
    // @ts-expect-error: deliberate bad id
    const p = await getProvider('xxx');
    expect(p).toBeNull();
  });
});
