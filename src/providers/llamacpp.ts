// llama.cpp / llama-server — düşük seviye yerel runtime (default localhost:8080).
// https://github.com/ggerganov/llama.cpp — Ollama, LM Studio, Jan'ın temeli.
// Kullanıcı `./llama-server -m model.gguf --port 8080 --host 0.0.0.0` ile çalıştırır.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { fetchModels, streamChat } from './common';

export class LlamaCppProvider implements AIProvider {
  readonly id = 'llamacpp' as const;
  readonly name = 'llama.cpp';

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async models(): Promise<AIModel[]> {
    return fetchModels('llamacpp');
  }

  chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    return streamChat('llamacpp', messages, options);
  }
}
