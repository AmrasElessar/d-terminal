// LM Studio — yerel OpenAI-uyumlu runtime (default localhost:1234).
// Kullanıcı LM Studio'yu (https://lmstudio.ai) indirip kurar, model çeker,
// "Local Server" sekmesinden başlatır. D-Terminal otomatik bağlanır.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { fetchModels, streamChat } from './common';

export class LMStudioProvider implements AIProvider {
  readonly id = 'lmstudio' as const;
  readonly name = 'LM Studio';

  async isAvailable(): Promise<boolean> {
    // Yerel — key gerekmez. Servis canlılığı runtime'da denenir.
    return true;
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('lmstudio');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('lmstudio', messages, options);
  }
}
