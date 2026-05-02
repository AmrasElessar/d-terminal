// Provider registry — id'den concrete instance döndürür.

import type { AIProvider, ProviderId } from '@/types/ai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';

export const ALL_PROVIDER_IDS: ProviderId[] = ['anthropic', 'ollama', 'openai', 'gemini'];

const cache = new Map<ProviderId, AIProvider>();

export function getProvider(id: ProviderId): AIProvider | null {
  if (cache.has(id)) return cache.get(id)!;
  let instance: AIProvider | null = null;
  switch (id) {
    case 'anthropic':
      instance = new AnthropicProvider();
      break;
    case 'ollama':
      instance = new OllamaProvider();
      break;
    case 'openai':
    case 'gemini':
    case 'custom':
      // v1.0.5 ile gelecek
      instance = null;
      break;
  }
  if (instance) cache.set(id, instance);
  return instance;
}
