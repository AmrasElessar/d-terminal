// OpenAI provider — Rust ai_chat_stream'e delegate eder.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { api } from '@/api/tauri';
import { fetchModels, streamChat } from './common';

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';

  async isAvailable(): Promise<boolean> {
    return api.secretsHas('ai_provider', 'openai');
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('openai');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('openai', messages, options);
  }
}
