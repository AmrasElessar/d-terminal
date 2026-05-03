// OpenAI provider — Chat Completions API (SSE streaming).

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { api } from '@/api/tauri';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const MODELS_URL = 'https://api.openai.com/v1/models';

const FALLBACK_MODELS: AIModel[] = [
  { id: 'gpt-4o',       label: 'GPT-4o',      contextWindow: 128_000, supportsStreaming: true },
  { id: 'gpt-4o-mini',  label: 'GPT-4o mini', contextWindow: 128_000, supportsStreaming: true },
  { id: 'o3',           label: 'o3',          contextWindow: 200_000, supportsStreaming: true },
  { id: 'o3-mini',      label: 'o3-mini',     contextWindow: 200_000, supportsStreaming: true },
];

export class OpenAIProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly name = 'OpenAI';

  async isAvailable(): Promise<boolean> {
    return api.secretsHas('ai_provider', 'openai');
  }

  async models(): Promise<AIModel[]> {
    const key = await api.aiKeyReveal('openai');
    if (!key) return FALLBACK_MODELS;
    try {
      const res = await fetch(MODELS_URL, { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) return FALLBACK_MODELS;
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const list = (data.data ?? [])
        .filter((m) => /^(gpt|o\d|chatgpt)/.test(m.id))
        .map((m) => ({ id: m.id, label: m.id, supportsStreaming: true }));
      return list.length > 0 ? list : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const key = await api.aiKeyReveal('openai');
    if (!key) throw new Error('noKey');

    const body = {
      model: options.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`apiFailed:${res.status}:${text.slice(0, 200)}`);
    }
    if (!res.body) throw new Error('apiFailed:no-body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const ev of events) {
        for (const line of ev.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]' || data === '') continue;
          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta.length > 0) {
              yield delta as string;
            }
          } catch {
            // bozuk frame
          }
        }
      }
    }
  }
}
