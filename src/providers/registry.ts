// Provider registry — id'den concrete instance döndürür.

import type { AIProvider, ProviderId } from '@/types/ai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';
import { OpenAIProvider } from './openai';
import { GeminiProvider } from './gemini';
import { LMStudioProvider } from './lmstudio';
import { JanProvider } from './jan';
import { LlamaCppProvider } from './llamacpp';
import { FoundryProvider } from './foundry';
import { CustomProvider } from './custom';

export const ALL_PROVIDER_IDS: ProviderId[] = [
  // Bulut
  'anthropic', 'gemini', 'openai',
  // Yerel runtime'lar
  'ollama', 'lmstudio', 'jan', 'llamacpp', 'foundry',
  // Esnek slot
  'custom',
];

const cache = new Map<ProviderId, AIProvider>();

export function getProvider(id: ProviderId): AIProvider | null {
  if (cache.has(id)) return cache.get(id)!;
  let instance: AIProvider | null = null;
  switch (id) {
    case 'anthropic': instance = new AnthropicProvider(); break;
    case 'openai':    instance = new OpenAIProvider();    break;
    case 'gemini':    instance = new GeminiProvider();    break;
    case 'ollama':    instance = new OllamaProvider();    break;
    case 'lmstudio':  instance = new LMStudioProvider();  break;
    case 'jan':       instance = new JanProvider();       break;
    case 'llamacpp':  instance = new LlamaCppProvider();  break;
    case 'foundry':   instance = new FoundryProvider();   break;
    case 'custom':    instance = new CustomProvider();    break;
  }
  if (instance) cache.set(id, instance);
  return instance;
}
