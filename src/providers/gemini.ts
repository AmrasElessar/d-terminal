// Google Gemini provider — Rust ai_chat_stream'e delegate eder.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { api } from '@/api/tauri';
import { fetchModels, streamChat } from './common';

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';

  async isAvailable(): Promise<boolean> {
    return api.secretsHas('ai_provider', 'gemini');
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('gemini');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('gemini', messages, options);
  }
}
