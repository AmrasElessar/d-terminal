// Ollama provider — yerel sunucu (varsayılan localhost:11434).
// OpenAI-compat değil; native /api/chat endpoint'i, NDJSON streaming.

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';

const DEFAULT_ENDPOINT = 'http://localhost:11434';

interface OllamaModelTag {
  name: string;
  size?: number;
  modified_at?: string;
}

interface OllamaChatChunk {
  model?: string;
  message?: { role: string; content: string };
  done?: boolean;
}

export class OllamaProvider implements AIProvider {
  readonly id = 'ollama' as const;
  readonly name = 'Ollama';

  constructor(public endpoint: string = DEFAULT_ENDPOINT) {}

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async models(): Promise<AIModel[]> {
    try {
      const res = await fetch(`${this.endpoint}/api/tags`);
      if (!res.ok) return [];
      const json = (await res.json()) as { models?: OllamaModelTag[] };
      return (json.models ?? []).map((m) => ({
        id: m.name,
        label: m.name,
        supportsStreaming: true,
      }));
    } catch {
      return [];
    }
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const body = {
      model: options.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      options: options.temperature !== undefined ? { temperature: options.temperature } : undefined,
    };

    const response = await fetch(`${this.endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`apiFailed:${response.status}:${text.slice(0, 200)}`);
    }
    if (!response.body) throw new Error('apiFailed:no-body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed) as OllamaChatChunk;
          const content = chunk.message?.content;
          if (typeof content === 'string' && content.length > 0) {
            yield content;
          }
        } catch {
          // bozuk satır — geç
        }
      }
    }
  }
}
