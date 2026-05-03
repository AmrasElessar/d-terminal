// Anthropic Claude provider — Rust ai_chat_stream'e delegate eder.
// API key Rust DPAPI vault'ta kalır, frontend'e hiçbir zaman ulaşmaz.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { api } from '@/api/tauri';
import { fetchModels, streamChat } from './common';

export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly name = 'Anthropic Claude';

  async isAvailable(): Promise<boolean> {
    return api.secretsHas('ai_provider', 'anthropic');
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('anthropic');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('anthropic', messages, options);
  }
}
