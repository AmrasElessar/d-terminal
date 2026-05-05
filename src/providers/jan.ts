// Jan — açık kaynak yerel AI uygulaması (default localhost:1337).
// https://jan.ai — Ollama benzeri ama GUI öncelikli, açık kaynak.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { fetchModels, streamChat } from './common';

export class JanProvider implements AIProvider {
  readonly id = 'jan' as const;
  readonly name = 'Jan';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('jan');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('jan', messages, options);
  }
}
