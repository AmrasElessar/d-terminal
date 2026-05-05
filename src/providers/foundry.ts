// Microsoft Foundry Local — Windows-native yerel AI runtime (2025+).
// Default localhost:5273. Phi-3, Phi-4, Llama, Mistral gibi modelleri
// Windows'a optimize edilmiş şekilde çalıştırır (DirectML / NPU desteği).
// Tauri Windows uygulaması olarak D-Terminal için ideal yerel partner.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { fetchModels, streamChat } from './common';

export class FoundryProvider implements AIProvider {
  readonly id = 'foundry' as const;
  readonly name = 'Foundry Local';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('foundry');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('foundry', messages, options);
  }
}
