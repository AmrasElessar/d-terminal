// Provider registry — id'den concrete instance döndürür.

import type { AIProvider, ProviderId } from '@/types/ai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';

export const ALL_PROVIDER_IDS: ProviderId[] = ['anthropic', 'gemini', 'openai', 'ollama'];

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
      instance = new OpenAIProvider();
      break;
    case 'gemini':
      instance = new GeminiProvider();
      break;
    case 'custom':
      // v1.0.5 ile gelecek
      instance = null;
      break;
  }
  if (instance) cache.set(id, instance);
  return instance;
}
