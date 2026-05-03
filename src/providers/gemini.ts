// Google Gemini provider — OpenAI-compatible endpoint kullanır:
// https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
// (native Gemini API yerine OpenAI-compat proxy — auth `Bearer <api-key>`).

import type { AIModel, AIProvider, ChatMessage, ChatOptions } from '@/types/ai';
import { api } from '@/api/tauri';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/models';

const FALLBACK_MODELS: AIModel[] = [
  { id: 'gemini-2.5-pro',    label: 'Gemini 2.5 Pro',          contextWindow: 2_000_000, supportsStreaming: true },
  { id: 'gemini-2.5-flash',  label: 'Gemini 2.5 Flash',        contextWindow: 1_000_000, supportsStreaming: true },
  { id: 'gemini-2.0-flash',  label: 'Gemini 2.0 Flash',        contextWindow: 1_000_000, supportsStreaming: true },
  { id: 'gemini-1.5-pro',    label: 'Gemini 1.5 Pro',          contextWindow: 2_000_000, supportsStreaming: true },
  { id: 'gemini-1.5-flash',  label: 'Gemini 1.5 Flash',        contextWindow: 1_000_000, supportsStreaming: true },
];

export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly name = 'Google Gemini';

  async isAvailable(): Promise<boolean> {
    return api.secretsHas('ai_provider', 'gemini');
  }

  async models(): Promise<AIModel[]> {
    const key = await api.aiKeyReveal('gemini');
    if (!key) return FALLBACK_MODELS;
    try {
      const res = await fetch(MODELS_URL, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!res.ok) return FALLBACK_MODELS;
      const data = (await res.json()) as { data?: Array<{ id: string }> };
      const list = (data.data ?? [])
        .map((m) => m.id.replace(/^models\//, ''))
        .filter((id) => id.startsWith('gemini-'))
        .map((id) => ({ id, label: id, supportsStreaming: true }));
      return list.length > 0 ? list : FALLBACK_MODELS;
    } catch {
      return FALLBACK_MODELS;
    }
  }

  async *chat(messages: ChatMessage[], options: ChatOptions): AsyncIterable<string> {
    const key = await api.aiKeyReveal('gemini');
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

    // OpenAI-compat SSE: `data: {...}\n\n`
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
            // bozuk frame — geç
          }
        }
      }
    }
  }
}
