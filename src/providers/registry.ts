// Provider registry — id'den concrete instance döndürür.
//
// Lazy-load: 9 provider'ın hepsi eager import ediliyordu (~30-40 KB main
// bundle). Kullanıcı genelde 1-2 provider seçer, gerisi asla kullanılmaz.
// Şimdi her provider kendi chunk'ında dinamik import ediliyor — Vite tree
// shaking + chunk splitting ile main bundle hafifler. Bu fonksiyon `async`
// olduğu için tüm caller'lar zaten await ediyor (stores/ai.ts resolveProvider,
// AIChatPane.streamInto + send brainstorm loop).

import type { AIProvider, ProviderId } from '@/types/ai';

export const ALL_PROVIDER_IDS: ProviderId[] = [
  // Bulut
  'anthropic', 'gemini', 'openai',
  // Yerel runtime'lar
  'ollama', 'lmstudio', 'jan', 'llamacpp', 'foundry',
  // Esnek slot
  'custom',
];

const cache = new Map<ProviderId, AIProvider>();

const LOADERS: Record<ProviderId, () => Promise<AIProvider>> = {
  anthropic: () => import('./anthropic').then((m) => new m.AnthropicProvider()),
  openai:    () => import('./openai').then((m) => new m.OpenAIProvider()),
  gemini:    () => import('./gemini').then((m) => new m.GeminiProvider()),
  ollama:    () => import('./ollama').then((m) => new m.OllamaProvider()),
  lmstudio:  () => import('./lmstudio').then((m) => new m.LMStudioProvider()),
  jan:       () => import('./jan').then((m) => new m.JanProvider()),
  llamacpp:  () => import('./llamacpp').then((m) => new m.LlamaCppProvider()),
  foundry:   () => import('./foundry').then((m) => new m.FoundryProvider()),
  custom:    () => import('./custom').then((m) => new m.CustomProvider()),
};

export async function getProvider(id: ProviderId): Promise<AIProvider | null> {
  const cached = cache.get(id);
  if (cached) return cached;
  const loader = LOADERS[id];
  if (!loader) return null;
  const instance = await loader();
  cache.set(id, instance);
  return instance;
}
