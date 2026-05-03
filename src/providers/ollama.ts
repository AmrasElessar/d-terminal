// Ollama provider — Rust ai_chat_stream'e delegate eder.
// Yerel sunucu (localhost:11434), key gerektirmez.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { fetchModels, streamChat } from './common';

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama' as const;
  readonly name = 'Ollama';

  async isAvailable(): Promise<boolean> {
    // Modeller boş gelmiyorsa erişilebilir kabul et.
    const ms = await this.models();
    return ms.length > 0;
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('ollama');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('ollama', messages, options);
  }
}
